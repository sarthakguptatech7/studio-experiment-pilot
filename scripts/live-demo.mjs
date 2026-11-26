#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPlan, validatePlan, decide, planFields, ratioP } from '../src/core.mjs';
import { FlagsmithAdapter } from '../src/flagsmith.mjs';
import { runTraffic } from './traffic.mjs';

export function parseDemoArgs(args) {
  const options = { approveDemo: false, approveRollout: false, count: 800, scenario: 'clear', seed: 'studio-live-v1', output: 'evidence/live-integration.json', waitSeconds: 120 };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--approve-demo') { options.approveDemo = true; continue; }
    if (arg === '--approve-rollout') { options.approveRollout = true; continue; }
    const field = { '--count': 'count', '--seed': 'seed', '--scenario': 'scenario', '--out': 'output', '--wait-seconds': 'waitSeconds' }[arg];
    if (!field || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Usage: node scripts/live-demo.mjs --approve-demo [--approve-rollout] [--count 800] [--out evidence/live-integration.json]');
    const value = args[++i]; options[field] = ['count', 'waitSeconds'].includes(field) ? Number(value) : value;
  }
  if (!options.approveDemo) throw new Error('Review the source and pass --approve-demo to create a new experiment and synthetic traffic in a dedicated development environment.');
  if (!/^evidence\/[A-Za-z0-9_-]+\.json$/.test(options.output)) throw new Error('Evidence output must be a JSON filename directly under evidence/.');
  if (!Number.isSafeInteger(options.waitSeconds) || options.waitSeconds < 1 || options.waitSeconds > 240) throw new Error('Result wait must be 1–240 seconds.');
  if (!Number.isSafeInteger(options.count) || options.count < 1 || options.count > 2000 || !['clear', 'inconclusive'].includes(options.scenario) || !/^[A-Za-z0-9_-]{1,64}$/.test(options.seed)) throw new Error('Invalid bounded traffic arguments.');
  return options;
}

export function publicEvidence(value, env = process.env) {
  const secrets = [env.FLAGSMITH_API_KEY, env.FLAGSMITH_ENVIRONMENT_KEY].filter(Boolean);
  return JSON.parse(JSON.stringify(value, (key, item) => {
    if (/api.?key|environment.?key|authorization|password|secret|token/i.test(key)) return '[redacted]';
    if (typeof item === 'string') for (const secret of secrets) item = item.split(secret).join('[redacted]');
    return item;
  }));
}

export function verifyRollout(plan, resources, detail) {
  return plan.split === 50 && detail.featureId === resources.featureId && detail.experimentId === resources.experimentId && detail.flagName === plan.flagName &&
    detail.status === 'running' && detail.rollout?.enabled === true && detail.rollout.percentage === 100 && detail.rollout.controlValue === 'control' &&
    detail.rollout.weights?.length === 1 && detail.rollout.weights[0].id === resources.variantId && detail.rollout.weights[0].weight === 50 &&
    detail.variants.length === 1 && detail.variants[0].id === resources.variantId && detail.variants[0].key === 'treatment' && detail.variants[0].value === 'treatment';
}

export function allocationCheck(normalized, metric, verifiedRollout50) {
  if (Number.isFinite(normalized.srmPValue)) return { source: 'flagsmith', pValue: normalized.srmPValue, passed: normalized.srmPValue >= .001 && normalized.srmPValue <= 1 };
  const a = metric?.variants?.control?.exposed, b = metric?.variants?.treatment?.exposed;
  if (normalized.srmPValue === null && verifiedRollout50 && Number.isSafeInteger(a) && Number.isSafeInteger(b) && a > 0 && b > 0) {
    const pValue = ratioP(a, b);
    return { source: 'local-50-50', pValue, passed: pValue >= .001,
      reason: 'Flagsmith returned null SRM. This local chi-squared allocation check uses real warehouse exposure counts and the verified approved 50/50 rollout. It is not a Flagsmith-reported p-value.' };
  }
  return { source: 'unavailable', pValue: null, passed: false, reason: 'No valid platform SRM or verified 50/50 fallback.' };
}

export async function runLiveDemo(options, { env = process.env, onProgress = line => console.error(line) } = {}) {
  // This utility is intentionally limited to a local, disposable API stack.
  const api = new URL(env.FLAGSMITH_API_URL || 'https://api.flagsmith.com');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(api.hostname)) throw new Error('The automatic integration demo requires a loopback Flagsmith development instance.');
  if (!options.approveDemo) throw new Error('Explicit --approve-demo is required.');
  const output = resolve(options.output);
  const trace = [], record = (action, details = {}) => { trace.push({ at: new Date().toISOString(), action, ...details }); onProgress(action); };
  const evidence = { schemaVersion: 1, generatedAt: new Date().toISOString(), integration: 'real Flagsmith API and official Node.js SDK',
    trafficProvenance: 'synthetic', synthetic: true, scope: 'development', completed: false,
    approval: { experiment: '--approve-demo', rolloutAndImmediateRollback: options.approveRollout ? '--approve-rollout' : null }, trace };
  const save = async () => { await mkdir(resolve('evidence'), { recursive: true }); await writeFile(output, JSON.stringify(publicEvidence(evidence, env), null, 2) + '\n'); };
  const adapter = new FlagsmithAdapter({ baseUrl: env.FLAGSMITH_API_URL, apiKey: env.FLAGSMITH_API_KEY, environmentKey: env.FLAGSMITH_ENVIRONMENT_KEY, projectId: env.FLAGSMITH_PROJECT_ID });
  try {
    const connection = await adapter.connection();
    if (!/development|^dev$|sandbox|test/i.test(connection.environmentName) || !connection.warehouseConnected) throw new Error('Use a dedicated development/test environment with its warehouse connected.');
    evidence.connection = { connected: connection.connected, environmentId: connection.environmentId, projectId: connection.projectId, warehouseConnected: connection.warehouseConnected };
    record('Verified dedicated development environment and warehouse.');
    const plan = await createPlan({ title: 'Studio headline: outcome versus generic', brief: 'Demonstrate a complete Flagsmith integration with explicitly synthetic visitors on an owned studio preview.',
      hypothesis: 'The demo traffic generator assigns different conversion probabilities to test the complete measurement and approval workflow. This is an integration test, not evidence of real customer preference.',
      control: 'A better way to make content.', treatment: 'From one idea to a ready-to-review content draft.' }, { agent: true });
    await validatePlan(plan, plan.hash);
    evidence.plan = { ...planFields(plan), hash: plan.hash }; record('Created and validated the agent-authored development plan.');
    const resources = await adapter.createExperiment(plan);
    evidence.resources = resources; record('Created and started the approved Flagsmith experiment.', { experimentId: resources.experimentId }); await save();
    evidence.traffic = await runTraffic({ flagName: plan.flagName, count: options.count, scenario: options.scenario, seed: options.seed, env,
      onProgress: ({ completed, count }) => onProgress(`Synthetic SDK visitors: ${completed}/${count}`) });
    record('Flushed all synthetic exposure and conversion events through the SDK.', { acceptedEvents: evidence.traffic.acceptedEvents }); await save();
    await adapter.refreshResults(resources.experimentId); record('Requested one Flagsmith warehouse result refresh.');
    const deadline = Date.now() + options.waitSeconds * 1000;
    let fetched;
    do {
      fetched = await adapter.results(resources.experimentId);
      if (fetched.normalized?.asOf && fetched.normalized.metrics.length) break;
      await new Promise(resolveWait => setTimeout(resolveWait, 2000));
    } while (Date.now() < deadline);
    if (!fetched?.normalized?.asOf || !fetched.normalized.metrics.length) throw new Error('Flagsmith results were not ready within the bounded wait. Verify the task processor, then inspect the existing experiment; do not automatically recreate it.');
    evidence.flagsmithResults = fetched; record('Read computed statistical results from Flagsmith.');
    const metric = fetched.normalized.metrics.find(m => m.metricId === resources.metricId);
    const inference = metric?.inference?.treatment;
    if (metric && inference && Number.isFinite(inference.chance_to_win)) {
      const detail = await adapter.inspectExperiment(resources.experimentId);
      const allocation = allocationCheck(fetched.normalized, metric, verifyRollout(plan, resources, detail));
      evidence.allocationCheck = allocation;
      if (allocation.source === 'local-50-50') record('Used an explicitly labelled local allocation check because Flagsmith returned null SRM.', { pValue: allocation.pValue });
      const actualEvidence = { source: 'flagsmith', synthetic: true, audience: 'synthetic', provenance: 'Synthetic visitors through the real SDK and warehouse', planId: plan.id, planHash: plan.hash,
        variants: ['control', 'treatment'].map(key => ({ key, visitors: metric.variants[key]?.exposed, conversions: metric.variants[key]?.conversions })),
        probability: inference.chance_to_win, probabilityMethod: 'Flagsmith warehouse inference', credibleInterval: { low: inference.ci_low, high: inference.ci_high },
        interval: { low: inference.ci_low, high: inference.ci_high }, warehouseSampleRatioP: fetched.normalized.srmPValue,
        allocationCheck: allocation };
      evidence.decision = decide(plan, actualEvidence);
      const intervalSupportsTreatment = Number.isFinite(inference.ci_low) && inference.ci_low > 0;
      const warehouseSplitValid = allocation.passed;
      evidence.decision.credibleIntervalSupportsTreatment = intervalSupportsTreatment;
      evidence.decision.warehouseSplitValid = warehouseSplitValid;
      if (options.approveRollout && evidence.decision.eligible && intervalSupportsTreatment && warehouseSplitValid) {
        evidence.rollout = await adapter.rollout({ winner: 'treatment' }, resources.snapshot);
        record('Applied the explicitly approved development treatment rollout.'); await save();
        evidence.rollback = await adapter.rollback(resources.snapshot);
        record('Restored and verified the prior control configuration.');
      } else {
        record('Kept the running experiment; rollout was not both approved and supported by its actual data.', { approved: options.approveRollout, eligible: evidence.decision.eligible && intervalSupportsTreatment && warehouseSplitValid });
      }
    } else record('Flagsmith inference is not yet available; no rollout performed.');
    evidence.completed = true; await save();
    return { completed: true, output: options.output, experimentId: resources.experimentId, synthetic: true,
      rollout: Boolean(evidence.rollout), rollback: Boolean(evidence.rollback), decision: evidence.decision?.status ?? 'collecting' };
  } catch (error) {
    evidence.failure = { message: String(error.message || 'Integration operation failed.'), code: error.code ?? null, status: error.status ?? null, partial: error.partial ?? null };
    record('Stopped on an actual integration failure. No automatic resource retry was performed.');
    await save();
    throw new Error(`Live integration stopped; scrubbed evidence was saved to ${options.output}. ${error.code || 'INTEGRATION_FAILED'}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await runLiveDemo(parseDemoArgs(process.argv.slice(2))), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
