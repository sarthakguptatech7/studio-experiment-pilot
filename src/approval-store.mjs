import {PilotError} from './core.mjs';

// This table belongs to this store, not to a schema-migration tool. CREATE is
// idempotent; every state mutation below is a single atomic SQL statement.
export const APPROVAL_SCHEMA = `CREATE TABLE IF NOT EXISTS pilot_approvals (
  plan_id TEXT PRIMARY KEY,
  plan_hash TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('rehearsal', 'live')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'needs_review')),
  receipt_id TEXT,
  receipt_action TEXT,
  pending_action TEXT,
  failure_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`;

const conflict = () => new PilotError('This approval is stale, already used, or awaiting review. Inspect the current run before continuing.', 409);
const identifier = value => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new PilotError('Invalid approval identifier.');
  return value;
};
const launchFields = (plan, mode) => {
  const planId = identifier(plan?.id);
  if (!/^[a-f0-9]{64}$/.test(plan?.hash || '') || !['rehearsal', 'live'].includes(mode)) throw new PilotError('Invalid approval scope.');
  return {planId, planHash: plan.hash, mode};
};
const transitionFrom = action => {
  if (action === 'rollout') return 'launch';
  if (action === 'rollback') return 'rollout';
  throw new PilotError('Unsupported approval transition.');
};
const failureText = reason => typeof reason === 'string' && reason.trim()
  ? reason.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 240)
  : 'The reserved operation did not complete. Inspect the run before taking further action.';
const copy = row => row ? {...row} : null;
const fromSql = row => row ? {
  planId: row.plan_id, planHash: row.plan_hash, mode: row.mode, status: row.status,
  receiptId: row.receipt_id, receiptAction: row.receipt_action,
  pendingAction: row.pending_action, failureReason: row.failure_reason,
  createdAt: row.created_at, updatedAt: row.updated_at
} : null;
const validateCompletion = (row, planId, receipt) => {
  const receiptId = identifier(receipt?.receiptId);
  const expectedActions = row?.pendingAction === 'rollback' ? ['launch', 'completed', 'rollback'] : [row?.pendingAction];
  if (!row || row.status !== 'pending' || receipt?.planId !== planId ||
      receipt.planHash !== row.planHash || receipt.mode !== row.mode ||
      receipt.scope !== 'development' || !expectedActions.includes(receipt.action)) throw conflict();
  if (receiptId === row.receiptId) throw conflict();
  return receiptId;
};

/** Process-local store for explicit tests/rehearsal. Do not use for hosted durability. */
export class MemoryApprovalStore {
  #rows = new Map();
  async beginLaunch(plan, mode) {
    const fields = launchFields(plan, mode);
    if (this.#rows.has(fields.planId)) throw conflict();
    const now = new Date().toISOString();
    const row = {...fields, status: 'pending', receiptId: null, receiptAction: null,
      pendingAction: 'launch', failureReason: null, createdAt: now, updatedAt: now};
    this.#rows.set(fields.planId, row);
    return copy(row);
  }
  async beginTransition(planId, expectedReceiptId, action) {
    identifier(planId); identifier(expectedReceiptId);
    const previousAction = transitionFrom(action), row = this.#rows.get(planId);
    if (!row || row.status !== 'active' || row.receiptId !== expectedReceiptId || row.receiptAction !== previousAction) throw conflict();
    row.status = 'pending'; row.pendingAction = action; row.failureReason = null; row.updatedAt = new Date().toISOString();
    return copy(row);
  }
  async complete(planId, receipt) {
    identifier(planId);
    const row = this.#rows.get(planId), receiptId = validateCompletion(row, planId, receipt);
    row.status = 'active'; row.receiptId = receiptId; row.receiptAction = receipt.action;
    row.pendingAction = null; row.failureReason = null; row.updatedAt = new Date().toISOString();
    return copy(row);
  }
  async fail(planId, safeReason) {
    identifier(planId);
    const row = this.#rows.get(planId);
    // A rejected duplicate request must not poison somebody else's completed run.
    if (row?.status === 'pending') {
      row.status = 'needs_review'; row.failureReason = failureText(safeReason); row.updatedAt = new Date().toISOString();
    }
    return copy(row);
  }
  async ensureCurrent(planId, receiptId) {
    identifier(planId); identifier(receiptId);
    const row = this.#rows.get(planId);
    if (!row || row.status !== 'active' || row.receiptId !== receiptId) throw conflict();
    return copy(row);
  }
  async get(planId) { return copy(this.#rows.get(identifier(planId))); }
}

/** Durable store: pass env.PILOT_DB. Never falls back to an in-memory store. */
export class D1ApprovalStore {
  #db; #ready;
  constructor(database) {
    if (!database || typeof database.prepare !== 'function') throw new PilotError('Durable approval storage is unavailable. No change was attempted.', 503);
    this.#db = database;
  }
  async #init() {
    if (!this.#ready) this.#ready = this.#db.prepare(APPROVAL_SCHEMA).run().then(result => {
      if (result?.success === false) throw new Error('Approval schema initialization failed.');
    }).catch(error => { this.#ready = undefined; throw error; });
    await this.#ready;
  }
  async #run(sql, values) {
    await this.#init();
    const result = await this.#db.prepare(sql).bind(...values).run();
    if (result?.success === false || !Number.isInteger(result?.meta?.changes)) throw new PilotError('Approval storage did not confirm the state change. Inspect the run before retrying.', 503);
    return result.meta.changes;
  }
  async beginLaunch(plan, mode) {
    const {planId, planHash} = launchFields(plan, mode), now = new Date().toISOString();
    const changes = await this.#run(`INSERT INTO pilot_approvals
      (plan_id, plan_hash, mode, status, receipt_id, receipt_action, pending_action, failure_reason, created_at, updated_at)
      VALUES (?, ?, ?, 'pending', NULL, NULL, 'launch', NULL, ?, ?)
      ON CONFLICT(plan_id) DO NOTHING`, [planId, planHash, mode, now, now]);
    if (changes !== 1) throw conflict();
    return this.get(planId);
  }
  async beginTransition(planId, expectedReceiptId, action) {
    identifier(planId); identifier(expectedReceiptId);
    const previousAction = transitionFrom(action);
    const changes = await this.#run(`UPDATE pilot_approvals SET status = 'pending',
      pending_action = ?, failure_reason = NULL, updated_at = ?
      WHERE plan_id = ? AND status = 'active' AND receipt_id = ? AND receipt_action = ?`,
    [action, new Date().toISOString(), planId, expectedReceiptId, previousAction]);
    if (changes !== 1) throw conflict();
    return this.get(planId);
  }
  async complete(planId, receipt) {
    identifier(planId);
    const row = await this.get(planId), receiptId = validateCompletion(row, planId, receipt);
    const changes = await this.#run(`UPDATE pilot_approvals SET status = 'active',
      receipt_id = ?, receipt_action = ?, pending_action = NULL, failure_reason = NULL, updated_at = ?
      WHERE plan_id = ? AND status = 'pending' AND pending_action = ? AND plan_hash = ? AND mode = ? AND receipt_id IS ?`,
    [receiptId, receipt.action, new Date().toISOString(), planId, row.pendingAction, row.planHash, row.mode, row.receiptId]);
    if (changes !== 1) throw conflict();
    return this.get(planId);
  }
  async fail(planId, safeReason) {
    identifier(planId);
    await this.#run(`UPDATE pilot_approvals SET status = 'needs_review', failure_reason = ?, updated_at = ?
      WHERE plan_id = ? AND status = 'pending'`, [failureText(safeReason), new Date().toISOString(), planId]);
    return this.get(planId);
  }
  async ensureCurrent(planId, receiptId) {
    identifier(planId); identifier(receiptId);
    const row = await this.get(planId);
    if (!row || row.status !== 'active' || row.receiptId !== receiptId) throw conflict();
    return row;
  }
  async get(planId) {
    identifier(planId);
    await this.#init();
    return fromSql(await this.#db.prepare('SELECT * FROM pilot_approvals WHERE plan_id = ?').bind(planId).first());
  }
}
