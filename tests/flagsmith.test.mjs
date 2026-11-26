import test from 'node:test';
import assert from 'node:assert/strict';
import { FlagsmithAdapter, FlagsmithError, normalizeResults } from '../src/flagsmith.mjs';

const secret = 'private-test-key-never-echo';
const env = { id: 2, project: 1, name: 'Development', use_v2_feature_versioning: false };
const state = (allocation = 0) => ({ id: 30, feature: 10, environment: 2, identity: null, feature_segment: null,
  enabled: true, feature_state_value: 'control', multivariate_feature_state_values: [{ id: 21, multivariate_feature_option: 20, percentage_allocation: allocation }] });
const plan = { id: 'plan-1', title: 'Improve first action', hypothesis: 'Specific copy increases continuation.', flagName: 'studio_plan_one', metric: 'continue_clicked', control: 'Continue', treatment: 'Build my first scene', split: 50 };
const snapshot = { schemaVersion: 1, projectId: 1, environmentId: 2, featureId: 10, variantId: 20, experimentId: 50,
  featureState: { id: 30, enabled: true, value: 'control', multivariate: [{ multivariate_feature_option: 20, percentage_allocation: 0 }] } };

function fixture(responses) {
  const calls = [];
  const adapter = new FlagsmithAdapter({ apiKey: secret, environmentKey: 'test-env', projectId: 1,
    fetchImpl: async (url, options) => {
      calls.push({ url, ...options, body: options.body === undefined ? undefined : JSON.parse(options.body) });
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.Authorization, `Api-Key ${secret}`);
      const next = responses.shift();
      assert.ok(next, `Unexpected request: ${options.method} ${url}`);
      if (next.throw) throw next.throw;
      return new Response(JSON.stringify(next.data ?? next), { status: next.statusCode ?? 200 });
    } });
  return { adapter, calls, responses };
}

test('validates origin, IDs, environment key, and keeps credentials private', () => {
  for (const baseUrl of ['http://example.com', 'https://name:pass@example.com', 'https://example.com/path', 'https://example.com?x=1']) {
    assert.throws(() => new FlagsmithAdapter({ baseUrl, apiKey: secret, environmentKey: 'ok', projectId: 1 }), FlagsmithError);
  }
  assert.throws(() => new FlagsmithAdapter({ apiKey: secret, environmentKey: '../etc', projectId: 1 }));
  assert.throws(() => new FlagsmithAdapter({ apiKey: secret, environmentKey: 'ok', projectId: '1/../../' }));
  const a = new FlagsmithAdapter({ baseUrl: 'http://127.0.0.1:8000/api/v1/', apiKey: secret, environmentKey: 'ok', projectId: 1 });
  assert.equal(JSON.stringify(a), '{}');
});

test('creates keyed multivariate experiment and starts after exact prerequisite calls', async () => {
  const { adapter, calls } = fixture([env, [{ id: 1 }], [], { id: 10 }, { id: 20 }, [state()], [], { id: 40 }, { id: 50, status: 'created' }, { id: 50, status: 'running' }]);
  const result = await adapter.createExperiment(plan);
  assert.equal(result.status, 'running');
  assert.equal(result.experimentId, 50);
  assert.equal(result.snapshot.featureState.value, 'control');
  assert.ok(!JSON.stringify(result).includes(secret));
  assert.ok(!JSON.stringify(result).includes('test-env'));
  assert.deepEqual(calls[3].body, { name: plan.flagName, type: 'MULTIVARIATE', initial_value: 'control', default_enabled: true, description: `Studio Experiment Pilot: ${plan.title}` });
  assert.match(calls[4].url, /projects\/1\/features\/10\/mv-options\/$/);
  assert.deepEqual(calls[4].body, { feature: 10, type: 'unicode', string_value: 'treatment', key: 'treatment', default_percentage_allocation: 0 });
  assert.deepEqual(calls[7].body.definition, { version: 1, event: 'continue_clicked' });
  assert.deepEqual(calls[8].body.experiment_rollout, { enabled: true, rollout_percentage: 100,
    feature_state_value: { type: 'string', value: 'control' },
    multivariate_feature_state_values: [{ multivariate_feature_option: 20, percentage_allocation: 50 }] });
  assert.match(calls[9].url, /experiments\/50\/start\/$/);
});

test('does not overwrite an existing flag or retry a failed create', async () => {
  const existing = fixture([env, [{ id: 1 }], [{ id: 10, name: plan.flagName }]]);
  await assert.rejects(existing.adapter.createExperiment(plan), e => e.code === 'FLAG_EXISTS' && e.partial.featureId === null);
  assert.equal(existing.calls.filter(c => c.method !== 'GET').length, 0);
  const failed = fixture([env, [{ id: 1 }], [], { id: 10 }, { statusCode: 500, data: { secret, environmentKey: 'test-env' } }]);
  await assert.rejects(failed.adapter.createExperiment(plan), e => {
    assert.equal(e.partial.featureId, 10);
    assert.equal(e.partial.variantId, null);
    assert.equal(e.uncertain, true);
    assert.ok(!JSON.stringify(e).includes(secret));
    assert.ok(!e.message.includes('test-env'));
    return true;
  });
  assert.equal(failed.calls.length, 5);
});

test('fails before writes without a warehouse, with mismatched scope or production', async () => {
  for (const [responses, code] of [
    [[env, []], 'WAREHOUSE_REQUIRED'],
    [[{ ...env, project: 7 }], 'SCOPE_MISMATCH'],
    [[{ ...env, name: 'Production' }, [{ id: 1 }]], 'PRODUCTION_BLOCKED'],
  ]) {
    const f = fixture(responses);
    await assert.rejects(f.adapter.createExperiment(plan), e => e.code === code);
    assert.ok(f.calls.every(c => c.method === 'GET'));
  }
});

test('refuses truncated preflight list rather than missing a duplicate', async () => {
  const f = fixture([env, [{ id: 1 }], { results: [], next: 'https://example.com/leak' }]);
  await assert.rejects(f.adapter.createExperiment(plan), e => e.code === 'PAGINATION_REQUIRED');
  assert.equal(f.calls.length, 3);
});

test('redacts thrown network errors and upstream error bodies', async () => {
  const f = fixture([{ throw: new Error(`network ${secret}`) }]);
  await assert.rejects(f.adapter.connection(), e => e.code === 'NETWORK_ERROR' && !e.message.includes(secret));
  const forbidden = fixture([{ statusCode: 403, data: { detail: `token ${secret}` } }]);
  await assert.rejects(forbidden.adapter.connection(), e => e.status === 403 && !e.message.includes(secret));
});

test('rollout completes with a verified variant and prevents scope confusion', async () => {
  const f = fixture([env, { id: 50, feature: { id: 10 }, status: 'running' }, { id: 50, status: 'completed' }]);
  const result = await f.adapter.rollout({ winner: 'treatment' }, snapshot);
  assert.equal(result.status, 'completed');
  assert.deepEqual(f.calls[2].body, { rollout_decision: 'variant', rollout_variant: 20 });
  const other = fixture([env, { id: 50, feature: { id: 999 }, status: 'running' }]);
  await assert.rejects(other.adapter.rollout({ winner: 'treatment' }, snapshot), e => e.code === 'SCOPE_MISMATCH');
  assert.ok(other.calls.every(c => c.method === 'GET'));
});

test('rollback restores and reads back legacy state', async () => {
  const f = fixture([env, { feature: 10, status: 'completed' }, [state(100)], state(), [state()]]);
  assert.equal((await f.adapter.rollback(snapshot)).restored, true);
  assert.equal(f.calls[3].method, 'PUT');
  assert.deepEqual(f.calls[3].body, { enabled: true, feature_state_value: 'control', multivariate_feature_state_values: [{ ...snapshot.featureState.multivariate[0], id: 21 }] });
});

test('rollback uses official v2 version payload and verifies result', async () => {
  const f = fixture([{ ...env, use_v2_feature_versioning: true }, { feature: 10, status: 'running' }, { status: 'completed' }, [state()], { id: 'uuid-version' }, [state()]]);
  assert.equal((await f.adapter.rollback(snapshot)).restored, true);
  assert.deepEqual(f.calls[2].body, { rollout_decision: 'control' });
  assert.match(f.calls[4].url, /environments\/2\/features\/10\/versions\/$/);
  assert.deepEqual(f.calls[4].body.feature_states_to_update[0].feature_state_value, { type: 'unicode', string_value: 'control' });
  assert.equal(f.calls[4].body.publish_immediately, true);
});

test('results preserve official evidence, normalize only confirmed fields, never invent data', async () => {
  assert.equal(normalizeResults({ results: null }), null);
  assert.equal(normalizeResults({ results: { surprise: true } }), null);
  const raw = { results: { as_of: '2026-11-26T12:00:00Z', is_final: false, payload: { srm_p_value: 0.8,
    metrics: [{ metric_id: 40, variants: { control: { n: 100, sum: 20, sum_squares: 20 }, treatment: { n: 100, sum: 30, sum_squares: 30 } },
      inference: { treatment: { lift: 0.5, chance_to_win: 0.94, ci_low: -0.1, ci_high: 1.2 } } }] } } };
  const f = fixture([raw]);
  const result = await f.adapter.results(50);
  assert.deepEqual(result.raw, raw);
  assert.equal(result.normalized.metrics[0].variants.treatment.rate, 0.3);
  assert.equal(result.normalized.metrics[0].inference.treatment.ci_low, -0.1);
});
