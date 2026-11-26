#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { Flagsmith } from '@flagsmith/nodejs';
import { rng } from '../src/core.mjs';

const scenarios = { clear: { control: .20, treatment: .55 }, inconclusive: { control: .30, treatment: .30 } };
const validCount = value => Number.isSafeInteger(value) && value >= 1 && value <= 2000;

/** Self-hosted Flagsmith database setup. Both endpoints MUST share one explicit origin. */
export function sdkConfiguration(env = process.env) {
  if (!env.FLAGSMITH_API_URL || !env.FLAGSMITH_ENVIRONMENT_KEY) throw new Error('Set FLAGSMITH_API_URL and FLAGSMITH_ENVIRONMENT_KEY for a dedicated development environment.');
  let base;
  try { base = new URL(env.FLAGSMITH_API_URL); } catch { throw new Error('Invalid Flagsmith API URL.'); }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname);
  if ((base.protocol !== 'https:' && !(base.protocol === 'http:' && loopback)) || base.username || base.password || base.search || base.hash || !['/', '/api/v1/', '/api/v1'].includes(base.pathname)) throw new Error('Use HTTPS or loopback HTTP with an origin or /api/v1 base URL.');
  const events = new URL(env.FLAGSMITH_EVENTS_URL || `${base.origin}/api/`);
  if (events.origin !== base.origin || events.pathname !== '/api/' || events.username || events.password || events.search || events.hash) throw new Error('Synthetic traffic requires the same Flagsmith database API origin and an events URL ending in /api/.');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(env.FLAGSMITH_ENVIRONMENT_KEY)) throw new Error('Invalid Flagsmith environment key.');
  return { environmentKey: env.FLAGSMITH_ENVIRONMENT_KEY, apiUrl: `${base.origin}/api/v1/`, enableEvents: true,
    enableAnalytics: false, enableLocalEvaluation: false, retries: 0, requestTimeoutSeconds: 10,
    eventProcessorConfig: { eventsApiUrl: events.href, maxBuffer: 5000, flushInterval: 0, requestTimeoutMs: 10000 } };
}

/**
 * Sends labelled synthetic visitors THROUGH the real SDK and Flagsmith assignment.
 * Counts below are request observations, not invented warehouse results. SDK event delivery
 * is checked because close() alone can silently drop failed event batches.
 */
export async function runTraffic({ flagName, count = 800, scenario = 'clear', seed = 'studio-demo-v1', env = process.env,
  fetchImpl = fetch, onProgress = () => {} } = {}) {
  flagName ||= env.FLAGSMITH_FEATURE_NAME;
  if (typeof flagName !== 'string' || !/^[a-z][a-z0-9_]{0,119}$/.test(flagName)) throw new Error('Provide a valid --flag or FLAGSMITH_FEATURE_NAME.');
  if (!validCount(count)) throw new Error('Traffic count must be an integer from 1 through 2000.');
  if (!Object.hasOwn(scenarios, scenario)) throw new Error('Use clear or inconclusive. Allocation mismatch is a rehearsal-only scenario; live assignment belongs to Flagsmith.');
  if (typeof seed !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(seed)) throw new Error('Seed must contain 1–64 letters, numbers, underscores or hyphens.');
  const config = sdkConfiguration(env), origin = new URL(config.apiUrl).origin;
  const assignments = { control: 0, treatment: 0 }, conversions = { control: 0, treatment: 0 };
  const identityPrefix = `synthetic_studio_${flagName}_${seed}`;
  let acceptedEvents = 0, acceptedBatches = 0, warningCount = 0, errorCount = 0, next = 0, done = 0;
  const logger = { debug() {}, info() {}, trace() {}, warn() { warningCount++; }, error() { errorCount++; }, fatal() { errorCount++; }, child() { return this; } };
  const guardedFetch = async (input, options = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.origin !== origin || !['/api/v1/identities/', '/api/v1/events', '/api/v1/events/'].includes(url.pathname)) throw new Error('SDK request left its configured local API scope.');
    const response = await fetchImpl(input, { ...options, redirect: 'error' });
    if (/\/events\/?$/.test(url.pathname) && response.ok) {
      const batch = JSON.parse(options.body);
      // A successful HTTP 202 can still reject individual events.
      // Official local receipt: {accepted: number, rejected: [{index,error}]}.
      let receipt;
      try { receipt = await response.clone().json(); } catch { warningCount++; }
      if (Number.isSafeInteger(receipt?.accepted) && receipt.accepted >= 0 && receipt.accepted <= batch.events.length && Array.isArray(receipt.rejected)) {
        acceptedEvents += receipt.accepted; acceptedBatches++;
        if (receipt.rejected.length || receipt.accepted !== batch.events.length) warningCount++;
      } else warningCount++;
    }
    return response;
  };
  const client = new Flagsmith({ ...config, fetch: guardedFetch, logger });
  let failure;
  try {
    // A bounded concurrency pool keeps local runs practical without changing the random seed.
    await Promise.all(Array.from({ length: Math.min(8, count) }, async () => {
      while (!failure) {
        const index = next++;
        if (index >= count) break;
        const identifier = `${identityPrefix}_${String(index).padStart(4, '0')}`;
        try {
          const flag = await client.getExperimentFlag(flagName, identifier);
          if (!flag.enabled || !flag.experiment?.inExperiment || !Object.hasOwn(assignments, flag.variant) || flag.value !== flag.variant) throw new Error('The flag is not a running keyed control/treatment experiment.');
          assignments[flag.variant]++;
          if (rng(`${seed}:${index}`)() < scenarios[scenario][flag.variant]) {
            client.trackEvent('continue_clicked', { identifier, metadata: { synthetic: true, source: 'studio-experiment-pilot', scenario } });
            conversions[flag.variant]++;
          }
          done++;
          if (done % 100 === 0 || done === count) onProgress({ completed: done, count });
        } catch { failure = new Error('Synthetic traffic stopped: a flag evaluation failed or returned an unsupported experiment. Inspect the Flagsmith development environment.'); }
      }
    }));
  } finally {
    await client.close(25000);
  }
  if (failure) throw failure;
  const expectedEvents = count + conversions.control + conversions.treatment;
  if (acceptedEvents !== expectedEvents || warningCount || errorCount) throw new Error('SDK event delivery was incomplete or reported a warning. Warehouse results must be checked; this run is not marked flushed.');
  return { assignments, conversions, synthetic: true, identityPrefix, flushed: true, count, scenario, seed,
    acceptedEvents, acceptedBatches, conversionProbabilities: scenarios[scenario],
    note: 'Synthetic visitors assigned by Flagsmith; these counts describe SDK calls and accepted events, not real audience behaviour. Reusing a seed reuses identities.' };
}

export function parseTrafficArgs(args, env = process.env) {
  const values = { flagName: env.FLAGSMITH_FEATURE_NAME, count: 800, scenario: 'clear', seed: 'studio-demo-v1' };
  for (let i = 0; i < args.length; i++) {
    const field = { '--flag': 'flagName', '--count': 'count', '--scenario': 'scenario', '--seed': 'seed' }[args[i]];
    if (!field || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Usage: node scripts/traffic.mjs --flag NAME [--count 800] [--scenario clear|inconclusive] [--seed studio-demo-v1]');
    const value = args[++i]; values[field] = field === 'count' ? Number(value) : value;
  }
  return values;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await runTraffic(parseTrafficArgs(process.argv.slice(2))), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
