import {FlagsmithAdapter} from '../src/flagsmith.mjs';
import {PilotError,ratioP} from '../src/core.mjs';
import {runTraffic} from './traffic.mjs';
export function makeLiveEvidence({env,record=async()=>{},trafficRunner=runTraffic,adapterFactory=config=>new FlagsmithAdapter(config)}){
  const runs=new Map();
  return async(plan,resources,scenario)=>{
    if(!['clear','inconclusive'].includes(scenario))throw new PilotError('Live allocation is controlled by Flagsmith. Choose clear or inconclusive.',400);
    const adapter=adapterFactory({baseUrl:env.FLAGSMITH_API_URL,apiKey:env.FLAGSMITH_API_KEY,environmentKey:env.FLAGSMITH_ENVIRONMENT_KEY,projectId:env.FLAGSMITH_PROJECT_ID});
    const key=String(resources.experimentId);
    if(!runs.has(key)){
      const run={scenario,refreshed:false,traffic:null};
      runs.set(key,run);
      run.promise=(async()=>{
        const connection=await adapter.connection();
        if(!/development|^dev$|sandbox|test/i.test(connection.environmentName)||!connection.warehouseConnected)throw new PilotError('Use a dedicated development environment with a connected warehouse.',403);
        // Deterministic identities prevent double enrollment if a process is restarted.
        run.traffic=await trafficRunner({flagName:plan.flagName,count:800,scenario,seed:'pilot-ui-v1',env});
        await record({action:'live_synthetic_traffic_flushed',planId:plan.id,traffic:run.traffic});
      })();
    }
    const run=runs.get(key);
    if(run.scenario!==scenario)throw new PilotError('This live experiment already has a traffic scenario. Create a new reviewed plan to change it.',409);
    await run.promise;
    if(!run.refreshed){run.refreshed=true;await adapter.refreshResults(resources.experimentId);}
    const deadline=Date.now()+45000;
    let fetched,metric,inference;
    do{
      fetched=await adapter.results(resources.experimentId);
      metric=fetched.normalized?.metrics?.find(x=>x.metricId===resources.metricId);
      inference=metric?.inference?.treatment;
      if(fetched.normalized?.asOf&&metric&&Number.isFinite(inference?.chance_to_win))break;
      await new Promise(resolve=>setTimeout(resolve,1500));
    }while(Date.now()<deadline);
    if(!fetched.normalized?.asOf||!metric||!Number.isFinite(inference?.chance_to_win))throw new PilotError('Flagsmith is still computing results. The synthetic traffic has been sent once. Retry this action to read the same experiment; no additional cohort will be created.',503);
    const variants=['control','treatment'].map(key=>({key,label:plan[key],visitors:metric.variants[key]?.exposed,conversions:metric.variants[key]?.conversions,rate:metric.variants[key]?.rate}));
    const evidence={source:'flagsmith',audience:'synthetic',scenario,generatedAt:new Date().toISOString(),planId:plan.id,planHash:plan.hash,
      variants,probability:inference.chance_to_win,probabilityMethod:'Flagsmith Bayesian analysis of synthetic SDK events',
      sampleRatioP:ratioP(variants[0].visitors,variants[1].visitors),warehouseSampleRatioP:fetched.normalized.srmPValue,
      totalVisitors:variants.reduce((n,v)=>n+v.visitors,0),events:variants.reduce((n,v)=>n+v.conversions,0),
      interval:{low:inference.ci_low,high:inference.ci_high},experimentId:resources.experimentId,asOf:fetched.normalized.asOf,
      notes:['Actual assignment, event ingestion and analysis by Flagsmith. The audience and conversion choices are deliberately synthetic.','The conversion probabilities are inputs to the integration demonstration, not discoveries about customers.','This run validates the integration and decision boundary; it does not predict social reach.',...(fetched.normalized.srmPValue===null?['The Flagsmith beta returned no allocation p-value. The separately labelled local chi-square check uses actual warehouse counts and the reviewed 50/50 split.']:[])]};
    await record({action:'live_flagsmith_results',evidence});
    return evidence;
  };
}
