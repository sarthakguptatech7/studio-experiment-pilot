import {PilotError,createPlan,validatePlan,simulate,decide,digest,signReceipt,verifyReceipt,auditEvent} from './core.mjs';
import {FlagsmithAdapter} from './flagsmith.mjs';
import {MemoryApprovalStore} from './approval-store.mjs';
const processStore=new MemoryApprovalStore();

const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const liveConfig=env=>({baseUrl:env.FLAGSMITH_API_URL||'https://api.flagsmith.com',apiKey:env.FLAGSMITH_API_KEY,environmentKey:env.FLAGSMITH_ENVIRONMENT_KEY,projectId:env.FLAGSMITH_PROJECT_ID});
const configured=env=>Boolean(env.FLAGSMITH_API_KEY&&env.FLAGSMITH_ENVIRONMENT_KEY&&env.FLAGSMITH_PROJECT_ID);
export async function handleApi(request,env={},context={}) {
  const url=new URL(request.url),route=url.pathname;
  const mode=env.PILOT_MODE==='live'?'live':'rehearsal';
  const secret=env.PILOT_SIGNING_SECRET;
  const approvalStore=context.approvalStore||processStore;
  let body,reservedPlanId;
  try {
    if(request.method==='OPTIONS') return response({error:'Cross-origin access is not supported.'},403);
    if(request.method==='GET' && route==='/api/status') {
      let flagsmithConnected=false,connectionError;
      if(mode==='live'&&configured(env)) {
        try { await new FlagsmithAdapter(liveConfig(env)).connection(); flagsmithConnected=true; }
        catch { connectionError='Flagsmith connection could not be verified. Check server configuration.'; }
      }
      return response({mode,flagsmithConnected,agentMode:'External coding agent via MCP',message:mode==='rehearsal'?'Rehearsal uses labelled synthetic data. No Flagsmith account is connected to this hosted preview.':flagsmithConnected?'Connected to the configured Flagsmith development environment.':connectionError||'Live mode needs Flagsmith server-side configuration.',liveCapabilities:flagsmithConnected?['create-experiment','read-results','development-rollout','rollback']:[]});
    }
    if(request.method==='GET' && route==='/api/connection') return response({mode,configured:configured(env),managementKeysInBrowser:false,instructions:'Run the source locally, configure a dedicated Flagsmith development environment in .env, and use PILOT_MODE=live. Management keys remain on the server.',required:['FLAGSMITH_API_URL','FLAGSMITH_API_KEY','FLAGSMITH_ENVIRONMENT_KEY','FLAGSMITH_PROJECT_ID'],agent:'Run node scripts/mcp.mjs from an MCP-capable coding client. The agent can propose and inspect; review approval is deliberately not exposed as an MCP tool.'});
    if(request.method!=='POST') return response({error:'Not found'},404);
    const origin=request.headers.get('origin');
    if(origin && origin!==url.origin && origin!==env.PILOT_PUBLIC_ORIGIN) throw new PilotError('Cross-origin writes are rejected.',403);
    if(request.headers.get('content-type')?.split(';')[0] !== 'application/json') throw new PilotError('Use application/json.',415);
    const raw=await request.text();
    if(raw.length>64000) throw new PilotError('Request is too large.',413);
    try {body=JSON.parse(raw);} catch {throw new PilotError('Invalid JSON.');}
    if(!body || typeof body!=='object' || Array.isArray(body)) throw new PilotError('A JSON object is required.');
    if(route==='/api/plan') return response(await createPlan(body,{agent:body.provenance==='agent'}));
    const plan=await validatePlan(body.plan,body.expectedHash);
    if(route==='/api/decide') return response({...decide(plan,body.evidence),advisoryOnly:true,evidenceAuthenticityVerified:false});
    if(route==='/api/approve') {
      if(body.action!=='launch'||body.approvedBy!=='human'||!body.expectedHash) throw new PilotError('Review and explicitly approve the launch.',403);
      if(mode==='live'&&!configured(env)) throw new PilotError('Flagsmith credentials are not configured. No live action was attempted.',503);
      if(!secret||secret.length<32) throw new PilotError('Server approval signing is unavailable. No change was attempted.',503);
      await approvalStore.beginLaunch(plan,mode);reservedPlanId=plan.id;
      const resources=mode==='live'?await new FlagsmithAdapter(liveConfig(env)).createExperiment(plan):null;
      const receipt=await signReceipt({action:'launch',planId:plan.id,planHash:plan.hash,scope:'development',mode,resources},secret);
      const audit=[auditEvent('launch_approved',plan,'Reviewed the exact flag, copy, metric and allocation.',mode),auditEvent('experiment_started',plan,mode==='live'?'Flagsmith created and started the experiment.':'Started a local rehearsal. No external resource was changed.',mode)];
      await context.record?.({plan,receipt,audit});
      await approvalStore.complete(plan.id,receipt);reservedPlanId=undefined;
      return response({plan:{...plan,status:'running'},receipt,audit});
    }
    const receipt=await verifyReceipt(body.receipt,plan,secret,route==='/api/rollback'?['rollout']:['launch']);
    if(receipt.mode!==mode) throw new PilotError('Approval belongs to a different connection mode.',409);
    await approvalStore.ensureCurrent(plan.id,receipt.receiptId);
    if(route==='/api/simulate') {
      let result;
      if(mode==='live'){
        if(!context.liveEvidence)throw new PilotError('This server has no live traffic runner. Use the local SDK runner.',503);
        const evidence=await context.liveEvidence(plan,receipt.resources,body.scenario);
        result={evidence,decision:decide(plan,evidence)};
      }else result=simulate(plan,body.scenario);
      result.evidence.attestation=await signReceipt({action:'evidence',planId:plan.id,planHash:plan.hash,scope:'development',mode,evidenceHash:await digest(result.evidence)},secret);
      const audit=[auditEvent(mode==='live'?'flagsmith_evidence_received':'synthetic_evidence_generated',plan,mode==='live'?'Read actual Flagsmith analysis from synthetic SDK traffic. This is not real audience evidence.':`Ran the ${body.scenario||'clear'} rehearsal scenario; this is not real audience evidence.`,mode)];
      await context.record?.({plan,evidence:result.evidence,audit});
      return response({...result,audit});
    }
    if(route==='/api/results') {
      if(mode!=='live') throw new PilotError('Flagsmith results require a live connection.',409);
      const adapter=new FlagsmithAdapter(liveConfig(env));
      const rawResults=await adapter.results(receipt.resources.experimentId);
      return response({source:'flagsmith',rawResults,experimentId:receipt.resources.experimentId,message:'Results are returned directly from Flagsmith. Review the platform metrics before a development rollout.'});
    }
    if(route==='/api/rollout') {
      if(body.approvedBy!=='human'||body.scope!=='development'||!body.expectedHash) throw new PilotError('Explicit development rollout approval is required.',403);
      const {attestation,...evidence}=body.evidence||{};
      await verifyReceipt(attestation,plan,secret,['evidence']);
      if(attestation.evidenceHash!==await digest(evidence)) throw new PilotError('Evidence changed after it was computed.',409);
      if(attestation.mode!==mode || evidence.planHash!==plan.hash)throw new PilotError('Evidence belongs to another connection mode or plan.',409);
      if(mode==='live'&&evidence.source!=='flagsmith')throw new PilotError('Local rehearsal evidence cannot authorize a live change.',403);
      const decision=decide(plan,evidence);
      if(!decision.eligible) throw new PilotError('The evidence gates do not permit a rollout.',409,decision.reasons);
      await approvalStore.beginTransition(plan.id,receipt.receiptId,'rollout');reservedPlanId=plan.id;
      const applied=mode==='live'?await new FlagsmithAdapter(liveConfig(env)).rollout({winner:'treatment'},receipt.resources.snapshot):null;
      const next=await signReceipt({action:'rollout',planId:plan.id,planHash:plan.hash,scope:'development',mode,resources:receipt.resources,previousReceiptId:receipt.receiptId,previousValue:'control',value:'treatment'},secret);
      const audit=[auditEvent('rollout_approved',plan,'Reviewer approved a development-only rollout.',mode),auditEvent('development_rollout',plan,mode==='live'?`Flagsmith completed experiment ${applied.experimentId} and applied treatment.`:'Rehearsal treatment is now at 100%. No external flag was changed.',mode)];
      await context.record?.({plan,receipt:next,audit});
      await approvalStore.complete(plan.id,next);reservedPlanId=undefined;
      return response({receipt:next,audit,message:mode==='live'?'Flagsmith development rollout completed. The rollback snapshot is ready.':'Development rehearsal now serves treatment. The rollback snapshot is ready.'});
    }
    if(route==='/api/rollback') {
      if(body.approvedBy!=='human'||!body.expectedHash) throw new PilotError('Explicit rollback approval is required.',403);
      await approvalStore.beginTransition(plan.id,receipt.receiptId,'rollback');reservedPlanId=plan.id;
      if(mode==='live')await new FlagsmithAdapter(liveConfig(env)).rollback(receipt.resources.snapshot);
      const next=await signReceipt({action:mode==='live'?'completed':'launch',planId:plan.id,planHash:plan.hash,scope:'development',mode,restoredValue:'control'},secret);
      const audit=[auditEvent('rollback_approved',plan,'Reviewer approved restoring the prior value.',mode),auditEvent('rollback_completed',plan,mode==='live'?'Flagsmith restored and verified the captured control state.':'Rehearsal restored control.',mode)];
      await context.record?.({plan,receipt:next,audit});
      await approvalStore.complete(plan.id,next);reservedPlanId=undefined;
      return response({receipt:next,audit,message:'Control restored. The audit is preserved.'});
    }
    return response({error:'Not found'},404);
  } catch(error) {
    const safe=error instanceof PilotError;
    // Integration errors are summarized; external payloads can contain secrets.
    const message=safe?error.message:'The Flagsmith operation failed. No success is assumed. Inspect the local server integration log or adapter error code.';
    const status=safe?error.status:(Number.isInteger(error.status)&&error.status>=400&&error.status<600?error.status:502);
    if(reservedPlanId)await approvalStore.fail(reservedPlanId,'The operation needs review. Do not repeat a live change without inspecting Flagsmith.').catch(()=>{});
    await context.record?.({error:message,at:new Date().toISOString(),route});
    const partial=error.partial?Object.fromEntries(['featureId','variantId','metricId','experimentId'].filter(k=>Number.isInteger(error.partial[k])).map(k=>[k,error.partial[k]])):undefined;
    return response({error:message,...(safe&&error.details?{details:error.details}:{}),...(partial?{partialResources:partial,requiresReview:true}:{})},status);
  }
}
