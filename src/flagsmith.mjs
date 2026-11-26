/**
 * Bounded server-only Flagsmith Management API adapter. No SDK/third-party dependencies.
 * Verified 2026-11-26 against Flagsmith's official setup documentation and source:
 * https://docs.flagsmith.com/experimentation/set-up-with-a-coding-agent
 * https://github.com/Flagsmith/flagsmith/blob/main/api/experimentation/views.py
 * https://github.com/Flagsmith/flagsmith/blob/main/api/experimentation/serializers.py
 * https://github.com/Flagsmith/flagsmith/blob/main/api/features/versioning/serializers.py
 * Feature option strings use `unicode`; experiment rollout strings use `string`.
 * The caller MUST authenticate and bind human approval to a plan before mutation.
 */

export class FlagsmithError extends Error {
  constructor(message, { code = 'FLAGSMITH_ERROR', status, partial, uncertain = false } = {}) {
    super(message); this.name = 'FlagsmithError'; this.code = code;
    if (status !== undefined) this.status = status;
    if (partial) this.partial = partial;
    this.uncertain = uncertain;
  }
}

const fail = (message, code = 'INVALID_INPUT') => { throw new FlagsmithError(message, { code }); };
const id = value => {
  if (!Number.isSafeInteger(Number(value)) || Number(value) <= 0 || !/^\d+$/.test(String(value))) fail('Expected a positive resource ID.');
  return Number(value);
};
const text = (value, max, label) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f]/.test(value)) fail(`Invalid ${label}.`);
  return value.trim();
};
const list = data => {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.results)) {
    if (data.next) fail('Resource list is truncated; narrow the scope before continuing.', 'PAGINATION_REQUIRED');
    return data.results;
  }
  fail('Unexpected Flagsmith list response.', 'UNSUPPORTED_SCHEMA');
};
const featureId = feature => id(typeof feature === 'object' ? feature?.id : feature);

export class FlagsmithAdapter {
  #base; #key; #environment; #project; #fetch; #timeout;
  constructor({ baseUrl = 'https://api.flagsmith.com', apiKey, environmentKey, projectId, fetchImpl = fetch, timeoutMs = 15000 } = {}) {
    let url;
    try { url = new URL(baseUrl); } catch { fail('Invalid Flagsmith base URL.'); }
    if (url.username || url.password || url.search || url.hash) fail('Base URL cannot contain credentials, a query, or fragment.');
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) fail('Flagsmith requires HTTPS, except on loopback.');
    if (!['', '/', '/api/v1', '/api/v1/'].includes(url.pathname)) fail('Use a Flagsmith origin or /api/v1 base URL.');
    this.#base = `${url.origin}/api/v1`;
    this.#key = text(apiKey, 512, 'API key');
    this.#environment = text(environmentKey, 128, 'environment key');
    if (!/^[A-Za-z0-9_-]+$/.test(this.#environment)) fail('Invalid environment key.');
    this.#project = id(projectId);
    if (typeof fetchImpl !== 'function') fail('fetchImpl must be a function.');
    this.#fetch = fetchImpl;
    this.#timeout = Math.min(30000, Math.max(100, Number(timeoutMs) || 15000));
  }

  #env(suffix = '') { return `/environments/${this.#environment}/${suffix}`; }
  async #request(path, method = 'GET', body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeout);
    try {
      const response = await this.#fetch(`${this.#base}${path}`, {
        method, redirect: 'error', signal: controller.signal,
        headers: { Authorization: `Api-Key ${this.#key}`, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) throw new FlagsmithError(`Flagsmith request failed (HTTP ${response.status}). No automatic retry was attempted.`, {
        code: 'UPSTREAM_ERROR', status: response.status, uncertain: method !== 'GET' && response.status >= 500,
      });
      if (response.status === 204 || response.status === 202) return { accepted: true };
      const length = Number(response.headers?.get('content-length') || 0);
      if (length > 2_000_000) fail('Flagsmith response exceeded the size limit.', 'RESPONSE_TOO_LARGE');
      const raw = await response.text();
      if (raw.length > 2_000_000) fail('Flagsmith response exceeded the size limit.', 'RESPONSE_TOO_LARGE');
      try { return JSON.parse(raw); } catch { fail('Flagsmith returned invalid JSON.', 'UNSUPPORTED_SCHEMA'); }
    } catch (error) {
      if (error instanceof FlagsmithError) throw error;
      // Never echo upstream errors, URLs, response bodies, or credentials.
      throw new FlagsmithError('Flagsmith network request failed or timed out. Check server connectivity before retrying.', { code: 'NETWORK_ERROR', uncertain: method !== 'GET' });
    } finally { clearTimeout(timer); }
  }

  async #environmentInfo() {
    const environment = await this.#request(this.#env());
    if (featureId(environment.project) !== this.#project) fail('The environment belongs to another project.', 'SCOPE_MISMATCH');
    return environment;
  }

  async connection() {
    const environment = await this.#environmentInfo();
    const warehouses = list(await this.#request(this.#env('warehouse-connections/')));
    return { connected: true, projectId: this.#project, environmentId: id(environment.id),
      environmentName: String(environment.name || ''), warehouseConnected: warehouses.length > 0,
      warehouseCount: warehouses.length, useV2FeatureVersioning: Boolean(environment.use_v2_feature_versioning) };
  }

  async #defaultState(fid) {
    const states = list(await this.#request(this.#env(`featurestates/?feature=${id(fid)}`)));
    const matches = states.filter(s => !s.identity && !s.feature_segment && featureId(s.feature) === id(fid));
    if (matches.length !== 1) fail('Expected exactly one default feature state.', 'UNSUPPORTED_SCHEMA');
    const s = matches[0];
    if (typeof s.enabled !== 'boolean' || typeof s.feature_state_value !== 'string' || !Array.isArray(s.multivariate_feature_state_values)) fail('Unsupported default feature state schema.', 'UNSUPPORTED_SCHEMA');
    return { id: id(s.id), enabled: s.enabled, value: s.feature_state_value,
      multivariate: s.multivariate_feature_state_values.map(v => ({ id: id(v.id), multivariate_feature_option: featureId(v.multivariate_feature_option), percentage_allocation: Number(v.percentage_allocation) })) };
  }

  async createExperiment(plan) {
    const flagName = text(plan?.flagName, 120, 'flag name');
    if (!/^[a-z][a-z0-9_]*$/.test(flagName)) fail('Use a lower-case underscore flag name.');
    const title = text(plan.title, 200, 'title');
    const hypothesis = text(plan.hypothesis, 4000, 'hypothesis');
    const metric = text(plan.metric, 100, 'metric');
    if (!/^[a-z][a-z0-9_]*$/.test(metric)) fail('Invalid metric event name.');
    if (plan.split !== 50) fail('This adapter supports a 50/50 experiment only.');
    text(plan.control, 2000, 'control copy'); text(plan.treatment, 2000, 'treatment copy');
    const partial = { operations: [], featureId: null, variantId: null, metricId: null, experimentId: null, snapshot: null };
    try {
      const info = await this.connection();
      if (!info.warehouseConnected) fail('Connect a Flagsmith warehouse before creating an experiment.', 'WAREHOUSE_REQUIRED');
      if (/\bproduction\b|^prod$/i.test(info.environmentName)) fail('This demo adapter does not mutate production environments.', 'PRODUCTION_BLOCKED');
      const existing = list(await this.#request(`/projects/${this.#project}/features/?search=${encodeURIComponent(flagName)}`));
      if (existing.some(f => f.name === flagName)) fail('The flag already exists. Inspect the previous operation before choosing a new plan ID; it was not changed.', 'FLAG_EXISTS');
      const flag = await this.#request(`/projects/${this.#project}/features/`, 'POST', {
        name: flagName, type: 'MULTIVARIATE', initial_value: 'control', default_enabled: true,
        description: `Studio Experiment Pilot: ${title}`,
      });
      partial.featureId = id(flag.id); partial.operations.push('Created multivariate flag with control value.');
      const variant = await this.#request(`/projects/${this.#project}/features/${partial.featureId}/mv-options/`, 'POST', {
        feature: partial.featureId, type: 'unicode', string_value: 'treatment', key: 'treatment', default_percentage_allocation: 0,
      });
      partial.variantId = id(variant.id); partial.operations.push('Created keyed treatment variant with zero default allocation.');
      const state = await this.#defaultState(partial.featureId);
      partial.snapshot = { schemaVersion: 1, projectId: this.#project, environmentId: info.environmentId,
        useV2FeatureVersioning: info.useV2FeatureVersioning, featureId: partial.featureId, variantId: partial.variantId, featureState: state };
      const metricName = `${flagName}: ${metric}`;
      const metrics = list(await this.#request(this.#env(`experiment-metrics/?q=${encodeURIComponent(metricName)}`)));
      const duplicateMetric = metrics.find(m => m.name === metricName);
      if (duplicateMetric) fail('A metric with this plan name already exists; inspect it before retrying.', 'METRIC_EXISTS');
      const createdMetric = await this.#request(this.#env('experiment-metrics/'), 'POST', {
        name: metricName, aggregation: 'occurrence', direction: 'up', definition: { version: 1, event: metric },
      });
      partial.metricId = id(createdMetric.id); partial.operations.push('Created occurrence metric for the conversion event.');
      const experiment = await this.#request(this.#env('experiments/'), 'POST', {
        feature: partial.featureId, name: title, hypothesis,
        metrics: [{ metric: partial.metricId, expected_direction: 'increase' }],
        experiment_rollout: { enabled: true, rollout_percentage: 100,
          feature_state_value: { type: 'string', value: 'control' },
          multivariate_feature_state_values: [{ multivariate_feature_option: partial.variantId, percentage_allocation: 50 }] },
      });
      partial.experimentId = id(experiment.id); partial.snapshot.experimentId = partial.experimentId;
      partial.operations.push('Created experiment with a 50/50 allocation.');
      const started = await this.#request(this.#env(`experiments/${partial.experimentId}/start/`), 'POST', {});
      if (started.status !== 'running') fail('Start request did not confirm running status. Inspect Flagsmith before retrying.', 'START_UNCONFIRMED');
      partial.operations.push('Started the approved experiment.');
      return { ...partial, status: 'running' };
    } catch (error) {
      if (error instanceof FlagsmithError) { error.partial = partial; throw error; }
      throw new FlagsmithError('Experiment setup failed; inspect partial resources before retrying.', { partial });
    }
  }

  async results(experimentId) {
    const raw = await this.#request(this.#env(`experiments/${id(experimentId)}/results/`));
    return { raw, normalized: normalizeResults(raw) };
  }

  async inspectExperiment(experimentId) {
    const raw = await this.#request(this.#env(`experiments/${id(experimentId)}/`));
    const feature = raw.feature;
    if (!feature || typeof feature !== 'object' || !Array.isArray(feature.multivariate_options)) fail('Unsupported experiment detail schema.', 'UNSUPPORTED_SCHEMA');
    return { experimentId: id(raw.id), featureId: id(feature.id), flagName: String(feature.name), status: raw.status,
      initialValue: feature.initial_value,
      variants: feature.multivariate_options.map(v => ({ id: id(v.id), key: v.key, value: v.string_value })),
      rollout: raw.experiment_rollout ? { enabled: raw.experiment_rollout.enabled, percentage: raw.experiment_rollout.rollout_percentage,
        controlValue: raw.experiment_rollout.feature_state_value?.value,
        weights: raw.experiment_rollout.multivariate_feature_state_values?.map(v => ({ id: id(v.multivariate_feature_option), weight: v.percentage_allocation })) } : null };
  }

  async refreshResults(experimentId) {
    return this.#request(this.#env(`experiments/${id(experimentId)}/results/refresh/`), 'POST', {});
  }

  async #validateSnapshot(snapshot) {
    if (snapshot?.schemaVersion !== 1 || id(snapshot.projectId) !== this.#project) fail('Snapshot does not match the configured project.', 'SCOPE_MISMATCH');
    const environment = await this.#environmentInfo();
    if (id(environment.id) !== id(snapshot.environmentId)) fail('Snapshot does not match the configured environment.', 'SCOPE_MISMATCH');
    if (/\bproduction\b|^prod$/i.test(String(environment.name || ''))) fail('This demo adapter does not mutate production environments.', 'PRODUCTION_BLOCKED');
    const experiment = await this.#request(this.#env(`experiments/${id(snapshot.experimentId)}/`));
    if (featureId(experiment.feature) !== id(snapshot.featureId)) fail('Snapshot feature does not match the experiment.', 'SCOPE_MISMATCH');
    return { environment, experiment };
  }

  async rollout(plan, snapshot = plan?.snapshot) {
    const { experiment } = await this.#validateSnapshot(snapshot);
    if (!['running', 'paused'].includes(experiment.status)) fail('Only an active experiment can be completed.', 'INVALID_STATE');
    const winner = plan.winner ?? plan.variant;
    if (!['control', 'treatment', 'disable'].includes(winner)) fail('Unsupported rollout decision.');
    const body = winner === 'treatment' ? { rollout_decision: 'variant', rollout_variant: id(snapshot.variantId) } : { rollout_decision: winner };
    const result = await this.#request(this.#env(`experiments/${id(snapshot.experimentId)}/complete/`), 'POST', body);
    if (result.status !== 'completed') fail('Rollout completion was not confirmed. Inspect Flagsmith.', 'ROLLOUT_UNCONFIRMED');
    return { status: 'completed', winner, experimentId: id(snapshot.experimentId), snapshot, operations: ['Completed experiment and applied the approved rollout decision.'] };
  }

  async rollback(snapshot) {
    const { environment, experiment } = await this.#validateSnapshot(snapshot);
    const prior = snapshot.featureState;
    if (!prior || typeof prior.enabled !== 'boolean' || prior.value !== 'control' || !Array.isArray(prior.multivariate)) fail('Unsupported snapshot. Only this adapter’s captured control state can be restored.', 'UNSUPPORTED_SNAPSHOT');
    if (prior.multivariate.some(v => featureId(v.multivariate_feature_option) !== id(snapshot.variantId) || v.percentage_allocation !== 0)) fail('Unexpected snapshot variant allocation.', 'UNSUPPORTED_SNAPSHOT');
    if (!['running', 'paused', 'completed'].includes(experiment.status)) fail('Only a started experiment can be rolled back.', 'INVALID_STATE');
    const operations = [];
    if (experiment.status !== 'completed') {
      await this.#request(this.#env(`experiments/${id(snapshot.experimentId)}/complete/`), 'POST', { rollout_decision: 'control' });
      operations.push('Completed the experiment with control.');
    }
    const current = await this.#defaultState(snapshot.featureId);
    if (current.value !== prior.value || current.multivariate.some(v =>
      v.multivariate_feature_option !== id(snapshot.variantId) || ![0, 50, 100].includes(v.percentage_allocation))) {
      fail('The flag has changed outside this experiment. Inspect it before restoring a snapshot.', 'STATE_DRIFT');
    }
    // Legacy nested updates require the existing child row ID, otherwise the
    // serializer tries to insert a duplicate (feature_state, option) pair.
    // Read CURRENT child IDs: snapshots may predate a published v2 version.
    const variants = prior.multivariate.map(v => ({ multivariate_feature_option: v.multivariate_feature_option, percentage_allocation: v.percentage_allocation }));
    if (environment.use_v2_feature_versioning) {
      await this.#request(`/environments/${id(environment.id)}/features/${id(snapshot.featureId)}/versions/`, 'POST', {
        publish_immediately: true,
        feature_states_to_update: [{ feature_segment: null, enabled: prior.enabled,
          feature_state_value: { type: 'unicode', string_value: prior.value }, multivariate_feature_state_values: variants }],
      });
    } else {
      const legacyVariants = variants.map(v => {
        const existing = current.multivariate.find(m => m.multivariate_feature_option === v.multivariate_feature_option);
        if (!existing) fail('The captured variant no longer has a current state row.', 'STATE_DRIFT');
        return { ...v, id: id(existing.id) };
      });
      await this.#request(this.#env(`featurestates/${current.id}/`), 'PUT', {
        enabled: prior.enabled, feature_state_value: prior.value, multivariate_feature_state_values: legacyVariants,
      });
    }
    const verified = await this.#defaultState(snapshot.featureId);
    if (verified.enabled !== prior.enabled || verified.value !== prior.value || verified.multivariate.some(v => v.percentage_allocation !== 0)) fail('Rollback write completed but verification differs. Inspect Flagsmith.', 'ROLLBACK_UNCONFIRMED');
    operations.push('Restored and verified the captured control configuration.');
    return { restored: true, status: 'rolled_back', featureId: id(snapshot.featureId), experimentId: id(snapshot.experimentId), operations };
  }
}

// The official results envelope is {results: {as_of, payload: {metrics, srm_p_value}, ...}}.
// Unknown/not-yet-computed payloads remain null; no synthetic statistics are supplied.
export function normalizeResults(raw) {
  if (raw?.results == null) return null;
  const result = raw.results;
  if (!Array.isArray(result.payload?.metrics)) return null;
  return { asOf: result.as_of ?? null, isFinal: result.is_final === true,
    lastErrorAt: result.last_error_at ?? null, srmPValue: result.payload.srm_p_value ?? null,
    metrics: result.payload.metrics.map(m => ({ metricId: m.metric_id,
      variants: Object.fromEntries(Object.entries(m.variants ?? {}).map(([key, value]) => [key, {
        exposed: value.n, conversions: value.sum, rate: value.n > 0 ? value.sum / value.n : null,
      }])), inference: m.inference ?? {} })) };
}
