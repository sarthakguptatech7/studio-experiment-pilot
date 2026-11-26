#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { FlagsmithAdapter } from '../src/flagsmith.mjs';
import { validatePlan, decide } from '../src/core.mjs';
import { allocationCheck, verifyRollout, publicEvidence } from './live-demo.mjs';

export async function finishLiveDemo({ file = 'evidence/live-integration.json', approveDemo = false, approveRollout = false, env = process.env } = {}) {
  if (!approveDemo || !approveRollout) throw new Error('Both --approve-demo and --approve-rollout are required to finish this development demonstration.');
  if (!/^evidence\/[A-Za-z0-9_-]+\.json$/.test(file)) throw new Error('Use an existing JSON file directly under evidence/.');
  const origin = new URL(env.FLAGSMITH_API_URL || 'https://api.flagsmith.com');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) throw new Error('Finishing the integration demo requires a local Flagsmith development instance.');
  const evidence = JSON.parse(await readFile(file, 'utf8'));
  if (evidence.synthetic !== true || evidence.scope !== 'development' || !evidence.resources?.snapshot || !evidence.traffic?.flushed) throw new Error('Only a completed synthetic traffic integration record can be continued.');
  const plan = await validatePlan(evidence.plan, evidence.plan.hash);
  const resources = evidence.resources;
  if (resources.snapshot.featureId !== resources.featureId || resources.snapshot.experimentId !== resources.experimentId || resources.snapshot.variantId !== resources.variantId) throw new Error('The saved resource snapshot is inconsistent.');
  const adapter = new FlagsmithAdapter({ baseUrl: env.FLAGSMITH_API_URL, apiKey: env.FLAGSMITH_API_KEY, environmentKey: env.FLAGSMITH_ENVIRONMENT_KEY, projectId: env.FLAGSMITH_PROJECT_ID });
  const save = () => writeFile(file, JSON.stringify(publicEvidence(evidence, env), null, 2) + '\n');
  const record = (action, details = {}) => { evidence.trace.push({ at: new Date().toISOString(), action, ...details }); console.error(action); };
  try {
    const connection = await adapter.connection();
    if (!/development|^dev$|sandbox|test/i.test(connection.environmentName) || !connection.warehouseConnected) throw new Error('A dedicated development environment and warehouse are required.');
    const detail = await adapter.inspectExperiment(resources.experimentId);
    if (!verifyRollout(plan, resources, detail)) throw new Error('The running experiment no longer matches the approved keyed 50/50 plan.');
    record('Verified the existing plan hash and its current Flagsmith 50/50 rollout.');
    const fetched = await adapter.results(resources.experimentId);
    const metric = fetched.normalized?.metrics.find(m => m.metricId === resources.metricId);
    const inference = metric?.inference?.treatment;
    if (!fetched.normalized?.asOf || !inference || !Number.isFinite(inference.ci_low) || inference.ci_low <= 0) throw new Error('Fresh Flagsmith results do not provide a positive lower lift interval.');
    const allocation = allocationCheck(fetched.normalized, metric, true);
    const actualEvidence = { source: 'flagsmith', synthetic: true, audience: 'synthetic', planId: plan.id, planHash: plan.hash,
      variants: ['control', 'treatment'].map(key => ({ key, visitors: metric.variants[key]?.exposed, conversions: metric.variants[key]?.conversions })),
      probability: inference.chance_to_win, probabilityMethod: 'Flagsmith warehouse inference',
      interval: { low: inference.ci_low, high: inference.ci_high }, warehouseSampleRatioP: fetched.normalized.srmPValue, allocationCheck: allocation };
    evidence.flagsmithResults = fetched; evidence.allocationCheck = allocation; evidence.decision = decide(plan, actualEvidence);
    evidence.decision.credibleIntervalSupportsTreatment = true; evidence.decision.warehouseSplitValid = allocation.passed;
    record('Read fresh Flagsmith results and assessed the allocation check.', { allocationSource: allocation.source, pValue: allocation.pValue });
    await save();
    if (!allocation.passed || !evidence.decision.eligible) throw new Error('The current decision remains ineligible. No rollout was attempted.');
    evidence.rollout = await adapter.rollout({ winner: 'treatment' }, resources.snapshot);
    record('Applied the explicitly approved development treatment rollout.'); await save();
    evidence.rollback = await adapter.rollback(resources.snapshot);
    record('Restored and verified the captured control configuration.');
    evidence.completed = true; evidence.finishedAt = new Date().toISOString(); delete evidence.failure;
    await save();
    return { completed: true, experimentId: resources.experimentId, rollout: true, rollback: true, output: file,
      synthetic: true, allocationSource: allocation.source, allocationPValue: allocation.pValue };
  } catch (error) {
    evidence.failure = { message: String(error.message), code: error.code ?? null, status: error.status ?? null };
    record('Stopped continuation on an actual failure; existing resources were not recreated.'); await save();
    throw new Error(`Continuation stopped; scrubbed evidence updated in ${file}. ${error.code || 'INTEGRATION_FAILED'}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2), options = {};
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--approve-demo') options.approveDemo = true;
      else if (args[i] === '--approve-rollout') options.approveRollout = true;
      else if (args[i] === '--evidence' && args[i + 1]) options.file = args[++i];
      else throw new Error('Use --approve-demo --approve-rollout [--evidence evidence/live-integration.json].');
    }
    console.log(JSON.stringify(await finishLiveDemo(options), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
