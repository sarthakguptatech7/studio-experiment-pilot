import test from 'node:test';
import assert from 'node:assert/strict';
import { runTraffic, sdkConfiguration, parseTrafficArgs } from '../scripts/traffic.mjs';
import { parseDemoArgs, publicEvidence, allocationCheck } from '../scripts/live-demo.mjs';

const flagName = 'studio_hook_1234abcd';
const env = { FLAGSMITH_API_URL: 'http://127.0.0.1:8000', FLAGSMITH_ENVIRONMENT_KEY: 'test-environment-key', FLAGSMITH_EVENTS_URL: 'http://127.0.0.1:8000/api/' };

function fakeTransport({ eventsStatus = 202, running = true, rejectOne = false } = {}) {
  const evaluations = [], events = [], urls = [];
  return { evaluations, events, urls, fetchImpl: async (input, options) => {
    const url = new URL(String(input)); urls.push(url.href);
    assert.equal(options.redirect, 'error');
    assert.equal(url.origin, 'http://127.0.0.1:8000');
    const body = JSON.parse(options.body);
    if (url.pathname === '/api/v1/identities/') {
      evaluations.push(body.identifier);
      const index = Number(body.identifier.split('_').at(-1));
      const variant = index % 2 ? 'treatment' : 'control';
      return new Response(JSON.stringify({ flags: [{ feature: { id: 10, name: flagName }, enabled: true,
        feature_state_value: variant, variant,
        metadata: { experiment: { id: 50, name: 'Test experiment', in_experiment: running } } }] }), { status: 200 });
    }
    assert.equal(url.pathname, '/api/v1/events');
    events.push(...body.events);
    return new Response(JSON.stringify({ accepted: body.events.length - (rejectOne ? 1 : 0), rejected: rejectOne ? [{ index: 0, error: 'test rejection' }] : [] }), { status: eventsStatus });
  } };
}

test('SDK configuration sends flag and event calls to one explicit self-hosted origin', () => {
  const cfg = sdkConfiguration(env);
  assert.equal(cfg.apiUrl, 'http://127.0.0.1:8000/api/v1/');
  assert.equal(cfg.eventProcessorConfig.eventsApiUrl, 'http://127.0.0.1:8000/api/');
  assert.equal(cfg.enableEvents, true);
  assert.equal(cfg.eventProcessorConfig.flushInterval, 0);
  assert.equal(cfg.enableAnalytics, false);
  assert.throws(() => sdkConfiguration({ ...env, FLAGSMITH_EVENTS_URL: 'https://events.api.flagsmith.com/' }), /same Flagsmith/);
  assert.throws(() => sdkConfiguration({ ...env, FLAGSMITH_API_URL: 'http://public.example.com' }), /HTTPS/);
  assert.throws(() => sdkConfiguration({}), /Set FLAGSMITH/);
});

test('real SDK records every exposure and associates conversions with the same synthetic identities', async () => {
  const t = fakeTransport();
  const result = await runTraffic({ flagName, count: 80, seed: 'fixed-seed', env, fetchImpl: t.fetchImpl });
  assert.deepEqual(result.assignments, { control: 40, treatment: 40 });
  assert.equal(result.synthetic, true); assert.equal(result.flushed, true);
  assert.equal(t.evaluations.length, 80); assert.equal(new Set(t.evaluations).size, 80);
  assert.ok(t.evaluations.every(identifier => identifier.startsWith(result.identityPrefix)));
  const exposures = t.events.filter(e => e.event === '$flag_exposure');
  const conversions = t.events.filter(e => e.event === 'continue_clicked');
  assert.equal(exposures.length, 80);
  assert.equal(conversions.length, result.conversions.control + result.conversions.treatment);
  assert.equal(result.acceptedEvents, t.events.length);
  assert.ok(exposures.every(e => e.feature_name === flagName && e.metadata.experiment_id === 50));
  assert.ok(conversions.every(e => e.metadata.synthetic === true && exposures.some(x => x.identifier === e.identifier)));
  assert.ok(t.urls.every(url => url.startsWith('http://127.0.0.1:8000/')));
  assert.ok(!JSON.stringify(result).includes(env.FLAGSMITH_ENVIRONMENT_KEY));
});

test('conversion seed is deterministic independently of SDK completion order', async () => {
  const a = fakeTransport(), b = fakeTransport();
  const first = await runTraffic({ flagName, count: 60, seed: 'same', env, fetchImpl: a.fetchImpl });
  const second = await runTraffic({ flagName, count: 60, seed: 'same', env, fetchImpl: b.fetchImpl });
  assert.deepEqual(first.conversions, second.conversions);
  assert.equal(first.identityPrefix, second.identityPrefix);
  assert.deepEqual(first.conversionProbabilities, { control: .20, treatment: .55 });
});

test('a rejected event batch cannot be reported as flushed', async () => {
  const t = fakeTransport({ eventsStatus: 403 });
  await assert.rejects(runTraffic({ flagName, count: 10, env, fetchImpl: t.fetchImpl }), /delivery was incomplete/);
});

test('HTTP 202 with partial event rejection is not treated as full delivery', async () => {
  const t = fakeTransport({ rejectOne: true });
  await assert.rejects(runTraffic({ flagName, count: 10, env, fetchImpl: t.fetchImpl }), /delivery was incomplete/);
});

test('missing experiment enrolment stops rather than inventing exposures', async () => {
  const t = fakeTransport({ running: false });
  await assert.rejects(runTraffic({ flagName, count: 10, env, fetchImpl: t.fetchImpl }), /evaluation failed/);
  assert.equal(t.events.length, 0);
});

test('bounded CLI inputs and explicit approvals fail before any service requests', async () => {
  assert.deepEqual(parseTrafficArgs(['--flag', flagName, '--count', '42']), { flagName, count: 42, seed: 'studio-demo-v1', scenario: 'clear' });
  await assert.rejects(runTraffic({ flagName, count: 2001, env }), /1 through 2000/);
  await assert.rejects(runTraffic({ flagName, scenario: 'mismatch', env }), /rehearsal-only/);
  assert.throws(() => parseDemoArgs([]), /approve-demo/);
  assert.throws(() => parseDemoArgs(['--approve-demo', '--out', '../secret.json']), /under evidence/);
  assert.throws(() => parseDemoArgs(['--approve-demo', '--wait-seconds', '301']), /1–240/);
  const args = parseDemoArgs(['--approve-demo', '--approve-rollout']);
  assert.equal(args.approveDemo, true); assert.equal(args.approveRollout, true);
});

test('public evidence removes known credential values and sensitive field names', () => {
  const keys = { FLAGSMITH_API_KEY: 'management-secret-value', FLAGSMITH_ENVIRONMENT_KEY: 'env-secret-value' };
  const clean = publicEvidence({ apiKey: keys.FLAGSMITH_API_KEY, authorization: 'Bearer secret',
    detail: `bad URL ${keys.FLAGSMITH_ENVIRONMENT_KEY}`, count: 5, variant: 'control' }, keys);
  assert.ok(!JSON.stringify(clean).includes('management-secret-value'));
  assert.ok(!JSON.stringify(clean).includes('env-secret-value'));
  assert.equal(clean.count, 5); assert.equal(clean.variant, 'control');
});

test('null SRM fallback uses actual counts only after the 50/50 rollout is verified', () => {
  const metric = { variants: { control: { exposed: 374 }, treatment: { exposed: 426 } } };
  const result = allocationCheck({ srmPValue: null }, metric, true);
  assert.equal(result.source, 'local-50-50'); assert.equal(result.passed, true);
  assert.ok(result.pValue > .06 && result.pValue < .07);
  assert.equal(allocationCheck({ srmPValue: null }, metric, false).passed, false);
  assert.equal(allocationCheck({ srmPValue: .00001 }, metric, true).passed, false);
  assert.equal(allocationCheck({ srmPValue: null }, { variants: { control: { exposed: 780 }, treatment: { exposed: 20 } } }, true).passed, false);
});
