import readline from 'node:readline';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createPlan,validatePlan,decide} from '../src/core.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const stringField=(maxLength=2000)=>({type:'string',minLength:1,maxLength});
const tools=[
 {name:'propose_experiment',description:'Save a bounded Studio headline experiment proposed by the connected coding agent. Supply the actual hypothesis and copy. This does not approve or change Flagsmith. The human reviews and launches in the local UI.',inputSchema:{type:'object',properties:{title:stringField(120),brief:stringField(),hypothesis:stringField(1000),control:stringField(180),treatment:stringField(180)},required:['title','brief','hypothesis','control','treatment'],additionalProperties:false}},
 {name:'inspect_proposal',description:'Read the latest local proposal and the exact change set for human review. No credentials or private Studio memory are returned.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
 {name:'assess_evidence',description:'Apply evidence checks to a saved plan and supplied aggregate counts. This is advisory; it cannot authorize a rollout or attest that supplied data is genuine.',inputSchema:{type:'object',properties:{plan:{type:'object'},evidence:{type:'object'}},required:['plan','evidence'],additionalProperties:false}},
 {name:'workflow_boundaries',description:'Return supported actions and the mandatory review boundary.',inputSchema:{type:'object',properties:{},additionalProperties:false}}
];
const textResult=value=>({content:[{type:'text',text:JSON.stringify(value,null,2)}]});
async function call(name,args={}){
 if(name==='propose_experiment'){
   for(const field of ['title','brief','hypothesis','control','treatment'])if(typeof args[field]!=='string'||!args[field].trim())throw new Error(`The coding agent must supply ${field}.`);
   const plan=await createPlan(args,{agent:true});
   const data=path.join(root,'data');await fs.mkdir(data,{recursive:true,mode:0o700});
   await fs.writeFile(path.join(data,'agent-proposal.json'),JSON.stringify(plan,null,2)+'\n',{mode:0o600});
   return textResult({plan,next:'Open the local review interface and import data/agent-proposal.json. A reviewer must inspect and approve the exact proposal before Flagsmith changes.',mutatedFlagsmith:false});
 }
 if(name==='inspect_proposal')return textResult(JSON.parse(await fs.readFile(path.join(root,'data','agent-proposal.json'),'utf8')));
 if(name==='assess_evidence'){await validatePlan(args.plan);return textResult({...decide(args.plan,args.evidence),advisoryOnly:true,evidenceAuthenticityVerified:false});}
 if(name==='workflow_boundaries')return textResult({agentCan:['propose','inspect','assess'],reviewerMust:['approve launch','approve development rollout','approve rollback'],productionChanges:false,templatePlanningIsAI:false,externalAgentRequired:true,privateStudioMemoryImported:false});
 throw new Error('Unknown tool.');
}
const lines=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
for await(const line of lines){
 if(!line.trim())continue;
 let request;
 try{request=JSON.parse(line);if(request.id===undefined)continue;
 let result;
 if(request.method==='initialize')result={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'studio-experiment-pilot',version:'0.1.0'}};
 else if(request.method==='ping')result={};
 else if(request.method==='tools/list')result={tools};
 else if(request.method==='tools/call')result=await call(request.params?.name,request.params?.arguments);
 else throw new Error('Method not found.');
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result})+'\n');
 }catch(error){if(request?.id!==undefined)process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,error:{code:-32603,message:error.message}})+'\n');}
}
