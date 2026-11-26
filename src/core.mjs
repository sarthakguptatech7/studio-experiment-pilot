// Copyright (c) 2026 Sarthak Gupta / ZwightX AI Labs. MIT licensed.
const encoder = new TextEncoder();

export class PilotError extends Error {
  constructor(message, status = 400, details = undefined) { super(message); this.name = 'PilotError'; this.status = status; this.details = details; }
}
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
export async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(typeof value === 'string' ? value : canonical(value)));
  return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join('');
}
const plain = (value, fallback, max = 500) => {
  const out = typeof value === 'string' ? value.trim() : fallback;
  if (!out || out.length > max) throw new PilotError(`Text must contain 1–${max} characters.`);
  return out;
};
export function planFields(plan) {
  return {
    id: plan.id, title: plan.title, brief: plan.brief, hypothesis: plan.hypothesis,
    flagName: plan.flagName, metric: plan.metric, control: plan.control, treatment: plan.treatment,
    split: plan.split, minPerVariant: plan.minPerVariant, minConversions: plan.minConversions,
    probabilityThreshold: plan.probabilityThreshold, provenance: plan.provenance,
    revision: plan.revision, createdAt: plan.createdAt, scope: plan.scope
  };
}
export async function createPlan(input = {}, {agent = false} = {}) {
  const id = 'exp_' + crypto.randomUUID().replaceAll('-', '').slice(0, 16);
  const brief = plain(input.brief, 'Test whether a specific outcome headline helps people choose to continue on an owned content preview page.', 2000);
  const control = plain(input.control, 'A better way to make content.', 180);
  const treatment = plain(input.treatment, 'From one idea to a ready-to-review content draft.', 180);
  if (control === treatment) throw new PilotError('Control and treatment must be different.');
  const plan = {
    id, title: plain(input.title, 'Make the first click count', 120), brief,
    hypothesis: plain(input.hypothesis, 'An outcome-specific headline increases the share of unique visitors who click Continue compared with a generic headline. Layout, CTA, audience allocation and page timing stay fixed.', 1000),
    flagName: 'studio_hook_' + id.slice(4, 12), metric: 'continue_clicked', control, treatment,
    split: 50, minPerVariant: 50, minConversions: 5, probabilityThreshold: 0.95,
    provenance: agent ? 'agent' : 'template', revision: 1, scope: 'development',
    status: 'draft', createdAt: new Date().toISOString()
  };
  plan.hash = await digest(planFields(plan));
  return plan;
}
export async function validatePlan(plan, expectedHash) {
  if (!plan || typeof plan !== 'object') throw new PilotError('A saved plan is required.');
  if (!/^exp_[a-f0-9]{16}$/.test(plan.id || '')) throw new PilotError('Invalid plan identifier.');
  if (!/^studio_hook_[a-f0-9]{8}$/.test(plan.flagName || '')) throw new PilotError('Only scoped Studio experiment flags are allowed.');
  for (const field of ['title','brief','hypothesis','control','treatment']) plain(plan[field], '', field === 'brief' ? 2000 : field === 'hypothesis' ? 1000 : 180);
  if (plan.metric !== 'continue_clicked' || plan.split !== 50 || plan.scope !== 'development' || plan.minPerVariant !== 50 || plan.minConversions !== 5 || plan.probabilityThreshold !== .95 || plan.revision !== 1) throw new PilotError('The experiment safety policy has changed. Create and review a new plan.');
  if (!['agent','template'].includes(plan.provenance) || !Number.isFinite(Date.parse(plan.createdAt)) || plan.control === plan.treatment) throw new PilotError('The plan is invalid.');
  const actual = await digest(planFields(plan));
  if (actual !== plan.hash || (expectedHash !== undefined && expectedHash !== actual)) throw new PilotError('This plan changed after review. Review the current revision before approving.', 409);
  return {...planFields(plan), hash: actual, status: plan.status || 'draft'};
}
export function rng(seed) {
  let state = 2166136261;
  for (const c of String(seed)) state = Math.imul(state ^ c.charCodeAt(0), 16777619) >>> 0;
  return () => { state += 0x6D2B79F5; let t = Math.imul(state ^ state >>> 15, 1 | state); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function normal(rand) { return Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-12))) * Math.cos(2 * Math.PI * rand()); }
function gamma(shape, rand) {
  if (shape < 1) return gamma(shape + 1, rand) * Math.pow(Math.max(rand(), 1e-12), 1 / shape);
  const d = shape - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (let tries = 0; tries < 10000; tries++) { const x = normal(rand); let v = 1 + c * x; if (v <= 0) continue; v = v*v*v; const u = rand(); if (u < 1-.0331*x*x*x*x || Math.log(u) < .5*x*x + d*(1-v+Math.log(v))) return d*v; }
  throw new PilotError('Unable to compute the rehearsal estimate.');
}
function beta(a,b,rand) { const x=gamma(a,rand),y=gamma(b,rand); return x/(x+y); }
export function probabilityTreatmentWins(control, treatment, seed='pilot') {
  const rand=rng(seed); let wins=0; const draws=12000;
  for(let i=0;i<draws;i++) if(beta(treatment.conversions+1,treatment.visitors-treatment.conversions+1,rand)>beta(control.conversions+1,control.visitors-control.conversions+1,rand)) wins++;
  return wins/draws;
}
function erfc(x) { const z=Math.abs(x),t=1/(1+.5*z); const out=t*Math.exp(-z*z-1.26551223+t*(1.00002368+t*(.37409196+t*(.09678418+t*(-.18628806+t*(.27886807+t*(-1.13520398+t*(1.48851587+t*(-.82215223+t*.17087277))))))))); return x>=0?out:2-out; }
export function ratioP(a,b) { return a+b>0 ? Math.min(1,erfc(Math.abs(a-b)/Math.sqrt(2*(a+b)))) : 1; }
export function validateEvidence(evidence) {
  if(!evidence || !['synthetic','flagsmith'].includes(evidence.source) || !Array.isArray(evidence.variants) || evidence.variants.length!==2) throw new PilotError('Evidence must identify two variants and its source.');
  const variants=['control','treatment'].map(key=>{
    const item=evidence.variants.find(x=>x.key===key);
    if(!item || !Number.isSafeInteger(item.visitors) || !Number.isSafeInteger(item.conversions) || item.visitors<0 || item.conversions<0 || item.conversions>item.visitors || item.visitors>100000000) throw new PilotError('Evidence counts are invalid.');
    return {...item,rate:item.visitors?item.conversions/item.visitors:0};
  });
  if(!Number.isFinite(evidence.probability) || evidence.probability<0 || evidence.probability>1) throw new PilotError('Evidence needs a valid probability estimate.');
  return {...evidence,variants,sampleRatioP:ratioP(variants[0].visitors,variants[1].visitors)};
}
export function decide(plan, rawEvidence) {
  const evidence=validateEvidence(rawEvidence), [control,treatment]=evidence.variants;
  const synthetic=evidence.source==='synthetic'||evidence.audience!=='observed';
  const checks=[
    {label:'Enough visitors',passed:evidence.variants.every(x=>x.visitors>=plan.minPerVariant),detail:`At least ${plan.minPerVariant} unique visitors per variant.`},
    {label:'Enough conversions',passed:evidence.variants.every(x=>x.conversions>=plan.minConversions),detail:`At least ${plan.minConversions} conversions per variant.`},
    {label:'Balanced allocation',passed:evidence.sampleRatioP>=.001,detail:`Sample-ratio check p=${evidence.sampleRatioP.toPrecision(3)}; stop below 0.001.`},
    {label:'Evidence threshold',passed:evidence.probability>=plan.probabilityThreshold && treatment.rate>control.rate,detail:'Treatment needs at least 95% probability of beating control.'},
    {label:'Audience provenance',passed:!synthetic,detail:synthetic?'Synthetic or unverified audience: no claim about real audience performance.':'Observed audience data; assess collection provenance before interpreting audience impact.'}
  ];
  if(evidence.source==='flagsmith'){
    const validInterval=Number.isFinite(evidence.interval?.low)&&evidence.interval.low>0;
    const hasWarehouseRatio=Number.isFinite(evidence.warehouseSampleRatioP);
    const validWarehouseRatio=hasWarehouseRatio?evidence.warehouseSampleRatioP>=.001:evidence.warehouseSampleRatioP===null&&evidence.sampleRatioP>=.001;
    checks.splice(4,0,{label:'Platform uncertainty',passed:validInterval&&validWarehouseRatio,detail:hasWarehouseRatio?'Flagsmith must report a positive lower lift interval and a valid allocation check.':'Flagsmith SRM is unavailable. A local chi-square check uses the actual warehouse counts against the approved 50/50 split; the platform lift interval must still be positive.'});
  }
  const valid=checks.filter(x=>x.label!=='Audience provenance').every(x=>x.passed), mismatch=!checks[2].passed;
  const status=mismatch?'blocked':valid?(synthetic?'rehearsal_winner':'ready'):'collecting';
  const reasons=checks.filter(x=>!x.passed).map(x=>x.detail);
  if(valid && synthetic) reasons.push('A development demonstration can show rollout and rollback. Production promotion remains locked.');
  if(valid && !synthetic) reasons.push('Review the actual collection method, practical effect and guardrails before any rollout. This tool only supports development.');
  return {status,eligible:valid,productionEligible:false,scope:'development',probability:evidence.probability,winningVariant:valid?'treatment':null,
    recommendation:mismatch?'Investigate allocation':valid?(synthetic?'Rehearse treatment rollout':'Review development rollout'):'Keep collecting',reasons,checks};
}
export function simulate(plan,scenario='clear') {
  const scenarios={clear:[[400,100],[400,164]],inconclusive:[[60,15],[60,16]],mismatch:[[560,140],[240,99]]};
  if(!scenarios[scenario]) throw new PilotError('Unknown rehearsal scenario.');
  const pair=scenarios[scenario];
  const variants=pair.map(([visitors,conversions],i)=>({key:i?'treatment':'control',label:i?plan.treatment:plan.control,visitors,conversions,rate:conversions/visitors}));
  const evidence={source:'synthetic',audience:'synthetic',scenario,generatedAt:new Date().toISOString(),planId:plan.id,planHash:plan.hash,variants,
    probability:probabilityTreatmentWins(variants[0],variants[1],scenario),probabilityMethod:'Local Beta-binomial rehearsal estimate',sampleRatioP:ratioP(pair[0][0],pair[1][0]),totalVisitors:pair[0][0]+pair[1][0],events:pair[0][1]+pair[1][1],
    notes:['Deterministic synthetic scenario; no real visitors were measured.','Uniform Beta(1,1) prior; 12,000 deterministic Monte Carlo draws. This is not Flagsmith analysis.','A/B assignment is only meaningful on an owned, controlled surface. This does not predict organic social reach.']};
  return {evidence,decision:decide(plan,evidence)};
}
export async function signReceipt(payload, secret) {
  if(!secret || secret.length<32) throw new PilotError('Server signing key is unavailable.',503);
  const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const body={...payload,receiptId:crypto.randomUUID(),issuedAt:new Date().toISOString()};
  const signature=await crypto.subtle.sign('HMAC',key,encoder.encode(canonical(body)));
  return {...body,signature:[...new Uint8Array(signature)].map(x=>x.toString(16).padStart(2,'0')).join('')};
}
export async function verifyReceipt(receipt, plan, secret, actions=['launch']) {
  if(!receipt || typeof receipt.signature!=='string' || !/^[a-f0-9]{64}$/.test(receipt.signature)) throw new PilotError('A valid approval receipt is required.',403);
  const {signature,...body}=receipt;
  const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  const bytes=new Uint8Array(signature.match(/../g).map(x=>parseInt(x,16)));
  const valid=await crypto.subtle.verify('HMAC',key,bytes,encoder.encode(canonical(body)));
  if(!valid || receipt.planHash!==plan.hash || receipt.planId!==plan.id || !actions.includes(receipt.action) || receipt.scope!=='development') throw new PilotError('Approval does not match this plan or action.',403);
  if(Date.now()-Date.parse(receipt.issuedAt)>24*60*60*1000) throw new PilotError('Approval expired. Review the plan again.',409);
  return receipt;
}
export function auditEvent(action,plan,detail,mode='rehearsal') { return {id:crypto.randomUUID(),at:new Date().toISOString(),action,planId:plan.id,planHash:plan.hash,actor:action.includes('approved')?'reviewer via browser':'experiment-pilot',mode,detail}; }
