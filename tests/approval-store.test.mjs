import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {MemoryApprovalStore, D1ApprovalStore} from '../src/approval-store.mjs';
import {LocalApprovalStore} from '../scripts/local-approval-store.mjs';

const plan = {id: 'exp_0123456789abcdef', hash: 'a'.repeat(64)};
const receipt = (receiptId, action, extra = {}) => ({receiptId, action, planId: plan.id,
  planHash: plan.hash, mode: 'rehearsal', scope: 'development', ...extra});
const conflict = error => error.status === 409;

for (const [name, create] of [['memory', () => new MemoryApprovalStore()], ['sqlite-backed D1 logic', () => new LocalApprovalStore(':memory:')]]) {
  test(`${name}: concurrent launch and transition attempts reserve only once`, async () => {
    const store = create();
    try {
      const launches = await Promise.allSettled([store.beginLaunch(plan, 'rehearsal'), store.beginLaunch(plan, 'rehearsal')]);
      assert.equal(launches.filter(r => r.status === 'fulfilled').length, 1);
      assert.equal(launches.find(r => r.status === 'rejected').reason.status, 409);
      await store.complete(plan.id, receipt('launch-1', 'launch'));
      const transitions = await Promise.allSettled([
        store.beginTransition(plan.id, 'launch-1', 'rollout'), store.beginTransition(plan.id, 'launch-1', 'rollout')
      ]);
      assert.equal(transitions.filter(r => r.status === 'fulfilled').length, 1);
      assert.equal(transitions.find(r => r.status === 'rejected').reason.status, 409);
      await assert.rejects(() => store.ensureCurrent(plan.id, 'launch-1'), conflict);
    } finally { store.close?.(); }
  });

  test(`${name}: rollback invalidates old receipts and requires the new state`, async () => {
    const store = create();
    try {
      await store.beginLaunch(plan, 'rehearsal');
      await store.complete(plan.id, receipt('launch-1', 'launch'));
      await assert.rejects(() => store.beginTransition(plan.id, 'launch-1', 'rollback'), conflict);
      await store.beginTransition(plan.id, 'launch-1', 'rollout');
      await store.complete(plan.id, receipt('rollout-1', 'rollout'));
      await assert.rejects(() => store.ensureCurrent(plan.id, 'launch-1'), conflict);
      await store.beginTransition(plan.id, 'rollout-1', 'rollback');
      await store.complete(plan.id, receipt('restored-1', 'launch'));
      await assert.rejects(() => store.beginTransition(plan.id, 'launch-1', 'rollout'), conflict);
      await assert.rejects(() => store.beginTransition(plan.id, 'rollout-1', 'rollback'), conflict);
      assert.equal((await store.ensureCurrent(plan.id, 'restored-1')).receiptId, 'restored-1');
      await store.beginTransition(plan.id, 'restored-1', 'rollout');
    } finally { store.close?.(); }
  });

  test(`${name}: uncertain operations remain blocked and scope changes cannot complete them`, async () => {
    const store = create();
    try {
      await store.beginLaunch(plan, 'rehearsal');
      await assert.rejects(() => store.complete(plan.id, receipt('wrong-mode', 'launch', {mode: 'live'})), conflict);
      await assert.rejects(() => store.complete(plan.id, receipt('wrong-plan', 'launch', {planHash: 'b'.repeat(64)})), conflict);
      await store.fail(plan.id, 'Upstream outcome is uncertain. Inspect the dedicated environment.');
      assert.equal((await store.get(plan.id)).status, 'needs_review');
      await assert.rejects(() => store.beginLaunch(plan, 'rehearsal'), conflict);
      await assert.rejects(() => store.complete(plan.id, receipt('late-result', 'launch')), conflict);
      await assert.rejects(() => store.ensureCurrent(plan.id, 'late-result'), conflict);
    } finally { store.close?.(); }
  });
}

test('local approval state survives restart and remains exclusive across store instances', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'pilot-approvals-'));
  const filename = path.join(directory, 'approvals.sqlite');
  let first, second;
  try {
    first = new LocalApprovalStore(filename);
    await first.beginLaunch(plan, 'rehearsal');
    await first.complete(plan.id, receipt('persisted-launch', 'launch'));
    first.close(); first = new LocalApprovalStore(filename);
    second = new LocalApprovalStore(filename);
    assert.equal((await second.ensureCurrent(plan.id, 'persisted-launch')).planHash, plan.hash);
    const results = await Promise.allSettled([
      first.beginTransition(plan.id, 'persisted-launch', 'rollout'),
      second.beginTransition(plan.id, 'persisted-launch', 'rollout')
    ]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    await first.fail(plan.id, 'Inspect this pending operation.');
    assert.equal((await second.get(plan.id)).status, 'needs_review');
  } finally { first?.close(); second?.close(); rmSync(directory, {recursive: true, force: true}); }
});

test('missing hosted storage never silently falls back to process memory', () => {
  assert.throws(() => new D1ApprovalStore(undefined), error => error.status === 503);
});
