// The blur-control read set through the native lane: a scoped demand, a plan bound to it, one apply batch, targeted readback, on the fake plugin.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { computePlanDigest, bindApproval, validateActionPlan, metadataReadSet } from '../packages/action-plan/dist/src/index.js';
import type { ActionPlan, EnsureEffectOperation, SetEffectControlOperation } from '../packages/action-plan/dist/src/index.js';
import type { ProjectSnapshot } from '../packages/project-graph/dist/src/index.js';
import { jsonFieldsOf } from '../packages/mcp-server/dist/src/index.js';
import { fieldOf, recordsOf } from '../apps/sidecar/dist/tests/http-json.js';
import type { NativeRig } from '../apps/sidecar/dist/tests/native-rig.js';
import type { ToolCallEnvelope } from '../apps/sidecar/dist/tests/sidecar-fixture.js';
import { blurOps, blurWorld } from './readset-native-blur-world.ts';
import type { BlurOptions, BlurWorld } from './readset-native-blur-world.ts';
import { worldRig, demand, propose, approve, applyPlan, assertNotApplied, stampOf, receiptOf, latestSnapshot, latestStored, sealedPlan, issuedCapability } from './readset-native-rig.ts';
import { applyAgain, callsTo, lastAnswer, rewriteOperations, sentCommand } from './readset-native-host.ts';

interface Collected {
  readonly world: BlurWorld;
  readonly rig: NativeRig;
  readonly page: ToolCallEnvelope;
}

async function collected(t: TestContext, options?: BlurOptions): Promise<Collected> {
  const world = blurWorld(options), rig = await worldRig(t, world);
  const page = await demand(rig, { target: world.target(stampOf(rig, world)) });
  return { world, rig, page };
}

function controlOf(plan: ActionPlan): SetEffectControlOperation {
  const operation = plan.operations[0];
  if (operation?.type !== 'set_effect_control') throw new Error('the plan does not start with a control change');
  return operation;
}

function ensureOf(control: SetEffectControlOperation): EnsureEffectOperation {
  const effectPath = control.target.effectPath;
  if (effectPath === undefined) throw new Error('the control change names no effect path');
  return { type: 'ensure_effect', target: control.target, capabilityId: 'host:ADBE Gaussian Blur 2', effectMatchName: 'ADBE Gaussian Blur 2', effectPath };
}

function withInventory(snapshot: ProjectSnapshot, inventory: Array<{ index: number; matchName: string }>): ProjectSnapshot {
  const { coverage } = snapshot;
  if (coverage?.localEffect === undefined) throw new Error('the snapshot carries no blur observation');
  return { ...snapshot, coverage: { ...coverage, localEffect: { ...coverage.localEffect, inventory } } };
}

test('static existing Gaussian Blur is an exact scoped scalar operation with one setter and targeted readback', async (t) => {
  const { world, rig, page } = await collected(t);
  assert.equal(fieldOf(page, 'data.state'), 'observed', JSON.stringify(page));
  world.calls.items = 0;
  const { approved, receipt } = await applyPlan(rig, blurOps(20));
  assert.equal(fieldOf(receipt, 'status'), 'executed', JSON.stringify(receipt));
  assert.equal(fieldOf(receipt, 'postcondition'), 'passed');
  assert.equal(world.leaf.value, 20);
  assert.deepEqual([world.calls.setters, world.calls.begin, world.calls.end], [1, 1, 1]);
  assert.ok(world.calls.items <= 5, `item lookups ${world.calls.items}`);
  const command = sentCommand(world);
  assert.equal(fieldOf(command, 'readSet.schemaVersion'), 'blur-control-read-set/1');
  assert.equal(fieldOf(approved, 'data.approval.readSetDigest'), fieldOf(command, 'readSet.digest'));
  assert.deepEqual(recordsOf(receipt, 'verification.steps').map((step) => [fieldOf(step, 'verificationState'), fieldOf(step, 'basis')]), [['exact', 'effect-control-value']]);
  const after = latestStored(rig);
  assert.equal(fieldOf(after, 'snapshot.result.coverage.localEffect.value'), 20);
  assert.equal(fieldOf(after, 'snapshot.result.compositions.0.layers.0.propertyPaths.1.value'), 20);
  assert.equal(fieldOf(applyAgain(world, rig.plugin, command), 'error.code'), 'STALE_READ_SET');
  assert.equal(world.calls.setters, 1);
});

const REFUSED_INVENTORIES: readonly BlurOptions[] = [{ duplicate: true, effects: 2 }, { keys: 1 }, { expression: 'time' }, { effects: 17 }];

test('ambiguous, animated, expression-dependent and oversized effect inventories refuse acquisition', async (t) => {
  for (const options of REFUSED_INVENTORIES) {
    const { world, rig, page } = await collected(t, options);
    const hostCode = fieldOf(lastAnswer(world, 'aeCollectBlurControl'), 'error.code');
    assert.equal(fieldOf(page, 'data.state'), 'unknown', JSON.stringify(page));
    assert.equal(fieldOf(page, 'data.error.code'), hostCode);
    assert.equal(fieldOf(latestStored(rig), 'snapshot.result.coverage'), undefined, 'a refused page publishes no evidence: the whole-project read stays current');
    assert.equal(world.calls.setters, 0);
  }
});

test('approval cannot widen the value or target; malformed evidence refuses conservatively', async (t) => {
  const { rig } = await collected(t);
  const planId = await propose(rig, blurOps(20)), plan = sealedPlan(rig, planId), snapshot = latestSnapshot(rig);
  const capability = issuedCapability(plan, snapshot);
  const changed: ActionPlan = { ...plan, operations: [{ ...controlOf(plan), value: 21 }] };
  changed.digest = computePlanDigest(changed);
  assert.equal(fieldOf(bindApproval(changed, snapshot, capability), 'ok'), false);
  assert.equal(fieldOf(validateActionPlan(jsonFieldsOf({ ...plan, operations: [{ type: 'set_effect_control', target: null }] }), snapshot), 'code'), 'READ_SET_UNSUPPORTED');
  assert.equal(metadataReadSet(plan, withInventory(snapshot, [{ index: 1, matchName: '' }])), undefined);
  const ensure: ActionPlan = { ...plan, operations: [ensureOf(controlOf(plan))] };
  assert.equal(metadataReadSet(ensure, snapshot), undefined);
});

test('a command widened after approval is refused by the host before any undo group opens', async (t) => {
  const { world, rig } = await collected(t);
  world.rewrite = (entry, args) => (entry === 'aeApplyPlan' ? rewriteOperations(args, (operation) => ({ ...operation, value: 21 })) : args);
  const { receipt } = await applyPlan(rig, blurOps(20));
  assertNotApplied(receipt, 'INVALID_READ_SET');
  assert.equal(world.calls.begin, 0);
  assert.equal(world.calls.setters, 0);
});

const reopenOnBegin = (world: BlurWorld): void => { world.context.app.beginUndoGroup = () => { world.calls.begin++; world.project.revision++; }; };

const ABANDONING_MOVES: ReadonlyArray<readonly [string, (world: BlurWorld) => void]> = [
  ['external', (world) => { world.project.revision++; }],
  ['undo', (world) => { world.project.revision++; }],
  ['lock', (world) => { world.layer.locked = true; }],
  ['reentrant', reopenOnBegin],
];

test('external edit, undo, locking and reentrant group-open edit refuse before any setter', async (t) => {
  for (const [kind, move] of ABANDONING_MOVES) {
    const { world, rig } = await collected(t);
    const { receipt } = await applyPlan(rig, blurOps(20), () => move(world));
    if (kind === 'reentrant') assert.equal(fieldOf(receipt, 'mutationState'), 'mutation-unknown', 'the group was already open: the host cannot say nothing changed');
    else assertNotApplied(receipt, 'STALE_READ_SET', kind);
    assert.equal(fieldOf(receipt, 'hostError.code'), 'STALE_READ_SET', kind);
    assert.equal(world.calls.setters, 0, kind);
    assert.equal(world.calls.end, world.calls.begin, kind);
  }
});

test('readback failure preserves the applied prefix and the native undo evidence', async (t) => {
  const { world, rig } = await collected(t, { coerce: true });
  const { receipt } = await applyPlan(rig, blurOps(20));
  assert.equal(fieldOf(lastAnswer(world, 'aeApplyPlan'), 'error.code'), 'READBACK_MISMATCH');
  assert.equal(fieldOf(receipt, 'hostError.code'), 'READBACK_MISMATCH');
  assert.equal(fieldOf(receipt, 'mayHaveMutated'), true);
  assert.deepEqual(fieldOf(receipt, 'completedOperations'), ['set_effect_control']);
  assert.deepEqual([world.calls.setters, world.calls.end], [1, 1]);
});

test('a scoped apply never reads the project: one batch of guard, write and stamp, and an unmatched observation refuses before the host', async (t) => {
  const { world, rig } = await collected(t);
  await applyPlan(rig, blurOps(20));
  assert.deepEqual(rig.batches().at(-1), ['watch_state', 'host_call:aeApplyPlan', 'watch_state']);
  assert.equal(rig.entries().filter((entry) => entry === 'aeApplyPlan').length, 1);
  const second = await collected(t);
  const lane = second.rig.sidecar.nativeHost?.lane;
  if (lane === undefined) throw new Error('the sidecar has no native lane');
  lane.stop();
  const planId = await propose(second.rig, blurOps(20));
  await second.rig.agent('ae_approve_plan', { planId });
  second.rig.sidecar.latest = undefined;
  lane.start();
  await second.rig.waitFor(() => receiptOf(second.rig, planId) !== undefined);
  assert.equal(fieldOf(receiptOf(second.rig, planId), 'postcondition'), 'not_run');
  assert.equal(second.rig.writes().length, 0, 'the host was never asked');
  assert.equal(callsTo(second.world, 'aeApplyPlan').length, 0);
  assert.equal(world.calls.setters, 1);
});

test('actual graph demand, proposal, approval, apply and receipt use the blur read set, and undo of it is unsupported', async (t) => {
  const world = blurWorld(), rig = await worldRig(t, world);
  const target = world.target(stampOf(rig, world));
  const pending = await rig.agent('ae_read_graph_page', { target });
  assert.equal(fieldOf(pending.body, 'data.state'), 'pending', JSON.stringify(pending.body));
  await rig.waitFor(() => fieldOf(rig.sidecar.collection.demandResult(String(fieldOf(pending.body, 'data.demandId'))), 'state') === 'observed');
  const planId = await propose(rig, blurOps(20), 'Set existing static Blurriness to 20');
  const approved = await rig.agent('ae_approve_plan', { planId });
  assert.equal(fieldOf(approved.body, 'data.status'), 'approved');
  await rig.waitFor(() => receiptOf(rig, planId) !== undefined);
  const command = sentCommand(world);
  assert.equal(fieldOf(command, 'readSet.schemaVersion'), 'blur-control-read-set/1');
  assert.equal(fieldOf(approved.body, 'data.approval.readSetDigest'), fieldOf(command, 'readSet.digest'));
  const receipt = receiptOf(rig, planId);
  assert.equal(fieldOf(receipt, 'status'), 'executed');
  assert.deepEqual(fieldOf(receipt, 'appliedOperations'), ['set_effect_control']);
  assert.ok(fieldOf(receipt, 'afterFingerprint'));
  const undone = await rig.agent('ae_undo_plan', { planId });
  assert.equal(fieldOf(undone.body, 'error.code'), 'SCOPED_UNDO_UNSUPPORTED');
  assert.equal(world.calls.setters, 1);
  assert.equal(rig.writes().length, 1);
});

test('unavailable expression metadata cannot become disabled or empty authorization', async (t) => {
  const { world, rig } = await collected(t);
  const planId = await propose(rig, blurOps(20));
  world.leaf.expression = undefined;
  const { receipt } = await approve(rig, planId);
  assertNotApplied(receipt, 'STALE_READ_SET');
  assert.equal(world.calls.setters, 0);
  const again = await demand(rig, { target: world.target(stampOf(rig, world)) });
  assert.equal(fieldOf(lastAnswer(world, 'aeCollectBlurControl'), 'ok'), false);
  assert.equal(fieldOf(again, 'data.state'), 'unknown');
});

test('intervening getter edits and a changed effect inventory fail closed before the setter or during readback', async (t) => {
  const first = await collected(t);
  Object.defineProperty(first.world.leaf, 'minValue', { get() { first.world.project.revision++; return 0; } });
  const refused = await applyPlan(first.rig, blurOps(20));
  assertNotApplied(refused.receipt, 'STALE_READ_SET');
  assert.equal(first.world.calls.setters, 0);
  const second = await collected(t);
  const original = second.world.leaf.setValue;
  second.world.leaf.setValue = function setValue(value: number) {
    original(value);
    second.world.parade.numProperties = 2;
    second.world.parade.property = () => ({ matchName: 'ADBE Gaussian Blur 2' });
  };
  const { receipt } = await applyPlan(second.rig, blurOps(20));
  assert.equal(fieldOf(receipt, 'status'), 'rejected');
  assert.equal(fieldOf(receipt, 'postcondition'), 'partial_mutation_possible');
  assert.equal(fieldOf(receipt, 'mayHaveMutated'), true);
  assert.deepEqual(fieldOf(receipt, 'completedOperations'), ['set_effect_control']);
  assert.equal(second.world.calls.setters, 1);
});

test('after a verified scoped plan, an ordinary plan is refused with the refresh step, and the whole read it asks for retires the scoped observation', async (t) => {
  const { rig, page } = await collected(t);
  assert.equal(fieldOf(page, 'data.state'), 'observed', JSON.stringify(page));
  const { receipt } = await applyPlan(rig, blurOps(20));
  assert.equal(fieldOf(receipt, 'postcondition'), 'passed', JSON.stringify(receipt));
  const glow = { type: 'ensure_effect', target: { compositionId: '300', layerId: '900', effectPath: 'ADBE Effect Parade/ADBE Glo2' }, capabilityId: 'adobe.glow', effectMatchName: 'ADBE Glo2', effectPath: 'ADBE Effect Parade/ADBE Glo2' };
  const refused = await rig.agent('ae_propose_plan', { summary: 'Blur and glow', operations: [...blurOps(30), glow] });
  assert.match(JSON.stringify(refused.body), /ae_refresh_snapshot/, 'the refusal names the next step');
  await rig.agent('ae_refresh_snapshot', { waitSeconds: 10 });
  await rig.waitFor(() => fieldOf(rig.sidecar.latest, 'snapshot.result.coverage') === undefined, 8000);
  assert.equal(latestStored(rig).fullBase, undefined, 'the whole read is current again');
});
