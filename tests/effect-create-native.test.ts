// Explicit Gaussian Blur creation through the native lane: scoped demand, exact initialization bound to the approval,
// one apply batch, partial-progress evidence.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { metadataReadSetJson, computePlanDigest, bindApproval } from '../packages/action-plan/dist/src/index.js';
import type { ActionPlan, EnsureEffectOperation } from '../packages/action-plan/dist/src/index.js';
import { array, decodeOrThrow, isJsonArray, isJsonObject, jsonObject, presentFields, wireJson } from '../packages/decode/dist/src/index.js';
import type { JsonObject, JsonValue } from '../packages/decode/dist/src/index.js';
import { jsonOf } from '../packages/mcp-server/dist/src/index.js';
import { presentPlanRows } from '../packages/mcp-server/dist/src/plan-rows.js';
import { metadataReadbackSnapshot } from '../apps/sidecar/dist/src/verify/metadata-readback.js';
import { boundedCreationEvidence as boundedHostEvidence } from '../apps/sidecar/dist/src/verify/creation-evidence.js';
import { fieldOf, listOf, recordsOf, textOf } from '../apps/sidecar/dist/tests/http-json.js';
import type { NativeRig } from '../apps/sidecar/dist/tests/native-rig.js';
import type { ToolCallEnvelope } from '../apps/sidecar/dist/tests/sidecar-fixture.js';
import { isWireObject } from '../tools/fake-plugin/dist/src/index.js';
import type { WireObject } from '../tools/fake-plugin/dist/src/index.js';
import { creationWorld } from './effect-create-native-world.ts';
import type { CreationOptions, CreationWorld } from './effect-create-native-world.ts';
import {
  worldRig, demand, propose, approve, applyPlan, assertNotApplied, stampOf, receiptOf,
  latestRaw, latestSnapshot, latestStored, sealedPlan, issuedCapability, patchHostAnswer,
} from './readset-native-rig.ts';
import { applyAgain, callsTo, lastAnswer, lastReadback, rewriteOperations, sentCommand } from './readset-native-host.ts';

const EFFECT = 'ADBE Effect Parade/ADBE Gaussian Blur 2';

type Initialization = { blurriness: number; dimensions: number; repeatEdgePixels: boolean };

type CreateOperation = {
  type: 'ensure_effect';
  target: { compositionId: string; layerId: string; effectPath: string };
  capabilityId: string;
  effectMatchName: string;
  effectPath: string;
  enabled: boolean;
  initialization: Initialization;
};

const INITIALIZATION: Initialization = { blurriness: 20, dimensions: 1, repeatEdgePixels: true };
const createOps = (initialization: Initialization = INITIALIZATION): CreateOperation[] => [{
  type: 'ensure_effect', target: { compositionId: '300', layerId: '900', effectPath: EFFECT }, capabilityId: 'host:ADBE Gaussian Blur 2',
  effectMatchName: 'ADBE Gaussian Blur 2', effectPath: EFFECT, enabled: true, initialization: { ...initialization },
}];
const SUMMARY = 'Create Gaussian: enabled, blur 20, dimensions 1, repeat edges ON';

interface Collected {
  readonly world: CreationWorld;
  readonly rig: NativeRig;
  readonly page: ToolCallEnvelope;
}

async function collected(t: TestContext, options?: CreationOptions): Promise<Collected> {
  const world = creationWorld(options), rig = await worldRig(t, world);
  const page = await demand(rig, { target: { ...world.target, expectedStamp: stampOf(rig, world) } });
  return { world, rig, page };
}

function ensureOf(plan: ActionPlan): EnsureEffectOperation {
  const operation = plan.operations[0];
  if (operation?.type !== 'ensure_effect') throw new Error('the plan does not start with an effect creation');
  return operation;
}

function initializationOf(operation: EnsureEffectOperation): NonNullable<EnsureEffectOperation['initialization']> {
  if (operation.initialization === undefined) throw new Error('the creation carries no initialization');
  return operation.initialization;
}

function planJsonOf(plan: ActionPlan): JsonObject {
  return decodeOrThrow(jsonObject, decodeOrThrow(wireJson, plan));
}

function withFirstOperation(plan: JsonObject, change: (operation: JsonObject) => JsonObject): JsonObject {
  const [first] = decodeOrThrow(array(jsonObject), plan.operations);
  if (first === undefined) throw new Error('the plan has no operation');
  return { ...plan, operations: [change(first)] };
}

function graphValue(value: JsonValue): JsonValue {
  if (isJsonArray(value)) return value.map(graphValue);
  return isJsonObject(value) ? graphObject(value) : value;
}

function graphObject(value: JsonObject): JsonObject {
  return Object.fromEntries(Object.entries(value).map(([key, member]) => [key, graphValue(member)]));
}

const initializationJson = (operation: JsonObject): JsonObject => decodeOrThrow(jsonObject, operation.initialization);

const WIDENINGS: ReadonlyArray<(operation: JsonObject) => JsonObject> = [
  (operation) => presentFields({ ...operation, initialization: undefined }),
  (operation) => ({ ...operation, initialization: presentFields({ ...initializationJson(operation), repeatEdgePixels: undefined }) }),
  (operation) => ({ ...operation, initialization: { ...initializationJson(operation), dimensions: 4 } }),
  (operation) => presentFields({ ...operation, enabled: undefined }),
];

function withEdgesOff(operation: WireObject): WireObject {
  const initialization = operation.initialization;
  return { ...operation, initialization: { ...(isWireObject(initialization) ? initialization : {}), repeatEdgePixels: false } };
}

function withControls(readback: JsonObject, change: (controls: ReadonlyArray<JsonObject>) => ReadonlyArray<JsonObject>): JsonObject {
  const created = decodeOrThrow(jsonObject, readback.createdEffect);
  return { ...readback, createdEffect: { ...created, controls: change(decodeOrThrow(array(jsonObject), created.controls)) } };
}

test('explicit creation reacquires invalidated references, preserves requested repeat edges and supports a later blur demand', async (t) => {
  const { world, rig } = await collected(t);
  const { receipt } = await applyPlan(rig, createOps());
  assert.equal(fieldOf(receipt, 'status'), 'executed', JSON.stringify(receipt));
  assert.deepEqual(world.values, [20, 1, 1]);
  assert.deepEqual([world.calls.add, world.calls.set, world.calls.end], [1, 3, 1]);
  const after = latestStored(rig);
  assert.equal(fieldOf(after, 'snapshot.result.compositions.0.layers.0.propertyPaths.3.value'), 1);
  assert.equal(fieldOf(after, 'snapshot.result.activeCompositionId'), '300');
  const expectedStamp = fieldOf(lastAnswer(world, 'aeApplyPlan'), 'metadataReadback.stamp');
  const blur = await demand(rig, { target: { kind: 'blur', itemIndex: 300, compositionId: '300', layerIndex: 1, layerId: '900', expectedStamp: jsonOf(expectedStamp) } });
  assert.equal(fieldOf(blur, 'data.state'), 'observed', JSON.stringify(blur));
  assert.equal(fieldOf(blur, 'data.page.localEffect.value'), 20);
  assert.equal(fieldOf(applyAgain(world, rig.plugin, sentCommand(world)), 'ok'), false);
  assert.equal(world.calls.add, 1);
});

test('creation reads the controls by matchName beside Compositing Options and tolerates 32-bit float storage', async (t) => {
  const { world, rig } = await collected(t, { float32: true });
  const { receipt } = await applyPlan(rig, createOps({ ...INITIALIZATION, blurriness: 12.3 }));
  assert.equal(fieldOf(receipt, 'status'), 'executed', JSON.stringify(receipt));
  assert.equal(world.values[0], Math.fround(12.3));
  assert.notEqual(world.values[0], 12.3);
});

test('omitted or widened initialization cannot reuse approval', async (t) => {
  const { world, rig } = await collected(t);
  const planId = await propose(rig, createOps(), SUMMARY), plan = sealedPlan(rig, planId), snapshot = latestSnapshot(rig);
  const capability = issuedCapability(plan, snapshot);
  const planJson = planJsonOf(plan);
  for (const change of WIDENINGS) assert.equal(metadataReadSetJson(graphObject(withFirstOperation(planJson, change)), snapshot), undefined);
  const operation = ensureOf(plan);
  const changed: ActionPlan = { ...plan, operations: [{ ...operation, initialization: { ...initializationOf(operation), repeatEdgePixels: false } }] };
  changed.digest = computePlanDigest(changed);
  assert.equal(fieldOf(bindApproval(changed, snapshot, capability), 'ok'), false);
  world.rewrite = (entry, args) => (entry === 'aeApplyPlan' ? rewriteOperations(args, withEdgesOff) : args);
  const { receipt } = await approve(rig, planId);
  assertNotApplied(receipt, 'INVALID_READ_SET');
  assert.equal(world.calls.add, 0);
});

const UNAVAILABLE_CREATIONS: readonly CreationOptions[] = [{ count: 16 }, { canAdd: false }];

test('creation availability is complete bounded absence, not missing cached data', async (t) => {
  for (const options of UNAVAILABLE_CREATIONS) {
    const { world, rig, page } = await collected(t, options);
    assert.equal(fieldOf(page, 'data.state'), 'unknown', JSON.stringify(page));
    assert.equal(fieldOf(page, 'data.error.code'), fieldOf(lastAnswer(world, 'aeCollectEffectCreation'), 'error.code'));
    assert.equal(fieldOf(latestStored(rig), 'snapshot.result.coverage'), undefined, 'a refused page publishes no evidence');
  }
  const empty = await collected(t, { count: 0 });
  assert.equal(fieldOf(empty.page, 'data.state'), 'observed', JSON.stringify(empty.page));
  const existing = await collected(t);
  const { receipt } = await applyPlan(existing.rig, createOps(), () => { existing.world.effects.push({ matchName: 'ADBE Gaussian Blur 2' }); existing.world.project.revision++; });
  assertNotApplied(receipt, 'STALE_READ_SET');
  assert.equal(existing.world.calls.add, 0);
});

test('same-count external edits and reentrant undo edits refuse before creation', async (t) => {
  const external = await collected(t);
  const refused = await applyPlan(external.rig, createOps(), () => { external.world.project.revision++; });
  assertNotApplied(refused.receipt, 'STALE_READ_SET');
  assert.equal(external.world.calls.add, 0);
  const reentrant = await collected(t, { editOnBegin: true });
  const { receipt } = await applyPlan(reentrant.rig, createOps());
  assert.equal(fieldOf(receipt, 'hostError.code'), 'STALE_READ_SET');
  assert.equal(fieldOf(receipt, 'status'), 'rejected');
  assert.equal(reentrant.world.calls.add, 0);
  assert.equal(reentrant.world.calls.begin, reentrant.world.calls.end);
});

const PARTIAL_FAILURES: readonly CreationOptions[] = [
  { throwAfterAdd: true }, { duplicateAdd: true }, { throwControl: 2 }, { coerce: 1 }, { editAfterControl: 1 },
];

test('a lost add return, a duplicate new effect and an initialization failure preserve partial mutation evidence without retry', async (t) => {
  for (const options of PARTIAL_FAILURES) {
    const { world, rig } = await collected(t, options);
    const { receipt } = await applyPlan(rig, createOps());
    const label = JSON.stringify(options);
    assert.equal(fieldOf(receipt, 'status'), 'rejected', `${label} ${JSON.stringify(receipt)}`);
    assert.equal(fieldOf(receipt, 'mayHaveMutated'), true, label);
    assert.deepEqual([world.calls.add, world.calls.begin === world.calls.end], [1, true], label);
    assert.ok(listOf(receipt, 'creationEvidence').length > 0, label);
    assert.deepEqual(fieldOf(receipt, 'creationEvidence'), fieldOf(lastAnswer(world, 'aeApplyPlan'), 'creationEvidence'), label);
    assert.equal(fieldOf(applyAgain(world, rig.plugin, sentCommand(world)), 'ok'), false, label);
    assert.equal(world.calls.add, 1, label);
  }
});

test('targeted readback rejects missing or changed initialization controls', async (t) => {
  const { world, rig } = await collected(t);
  const raw = latestRaw(rig);
  await applyPlan(rig, createOps());
  const command = sentCommand(world), readback = lastReadback(world);
  assert.ok(metadataReadbackSnapshot(command, readback, raw, 'good'), 'the untouched readback reconciles');
  const bad = withControls(readback, (controls) => controls.map((control, index) => (index === 2 ? { ...control, value: 0 } : control)));
  assert.equal(metadataReadbackSnapshot(command, bad, raw, 'bad'), null);
  const absent = withControls(readback, (controls) => controls.slice(0, -1));
  assert.equal(metadataReadbackSnapshot(command, absent, raw, 'bad'), null);
});

test('a reentrant addProperty method access refuses before invoking the captured method', async (t) => {
  const { world, rig } = await collected(t);
  const original = world.layer.property;
  world.layer.property = function property(name: string) {
    const parade = original(name), add = parade.addProperty;
    Object.defineProperty(parade, 'addProperty', { get() { world.project.revision++; return add; } });
    return parade;
  };
  const { receipt } = await applyPlan(rig, createOps());
  assertNotApplied(receipt, 'STALE_READ_SET');
  assert.equal(world.calls.add, 0);
});

const BAD_EVIDENCE: readonly JsonValue[] = [
  [{ action: 'control-2', state: 'observed' }],
  Array.from({ length: 11 }, () => ({ action: 'add-effect', state: 'attempted' })),
  [{ action: 'add-effect', state: 'attempted', junk: 1 }],
];

test('bounded creation progress survives the host answer and the sidecar receipt intake, and malformed progress is dropped', async (t) => {
  const { world, rig } = await collected(t, { throwControl: 2 });
  const { receipt } = await applyPlan(rig, createOps());
  const progress = lastAnswer(world, 'aeApplyPlan').creationEvidence;
  assert.deepEqual(fieldOf(receipt, 'creationEvidence'), progress);
  assert.deepEqual(boundedHostEvidence(structuredClone(progress)), progress);
  for (const bad of BAD_EVIDENCE) assert.equal(boundedHostEvidence(bad), undefined);
  for (const bad of BAD_EVIDENCE) {
    const second = await collected(t, { throwControl: 2 });
    patchHostAnswer(second.rig, 'aeApplyPlan', { creationEvidence: bad });
    const answered = await applyPlan(second.rig, createOps());
    assert.equal(fieldOf(answered.receipt, 'mayHaveMutated'), true);
    assert.equal(fieldOf(answered.receipt, 'creationEvidence'), undefined, 'malformed progress never reaches the receipt');
  }
});

const DISPATCHED_CREATIONS: readonly CreationOptions[] = [{}, { throwControl: 2 }];

test('actual creation demand, approval, dispatch and receipt retain exact initialization and partial progress', async (t) => {
  for (const options of DISPATCHED_CREATIONS) {
    const world = creationWorld(options), rig = await worldRig(t, world);
    const pending = await rig.agent('ae_read_graph_page', { target: { ...world.target, expectedStamp: stampOf(rig, world) } });
    assert.equal(fieldOf(pending.body, 'data.state'), 'pending', JSON.stringify(pending.body));
    await rig.waitFor(() => fieldOf(rig.sidecar.collection.demandResult(textOf(pending.body, 'data.demandId')), 'state') === 'observed');
    const planId = await propose(rig, createOps(), SUMMARY);
    const approved = await rig.agent('ae_approve_plan', { planId });
    assert.equal(fieldOf(approved.body, 'data.status'), 'approved');
    await rig.waitFor(() => receiptOf(rig, planId) !== undefined);
    const command = sentCommand(world), receipt = receiptOf(rig, planId);
    assert.equal(fieldOf(command, 'readSet.schemaVersion'), 'gaussian-create-read-set/1');
    assert.deepEqual(fieldOf(command, 'operations.0.initialization'), INITIALIZATION);
    assert.equal(fieldOf(approved.body, 'data.approval.readSetDigest'), fieldOf(command, 'readSet.digest'));
    if (options.throwControl) {
      assert.equal(fieldOf(receipt, 'status'), 'rejected');
      assert.equal(fieldOf(receipt, 'mayHaveMutated'), true);
      assert.ok(JSON.stringify(fieldOf(receipt, 'creationEvidence')).includes('control-2'), JSON.stringify(receipt));
    } else {
      assert.equal(fieldOf(receipt, 'status'), 'executed', JSON.stringify(receipt));
      assert.ok(fieldOf(receipt, 'afterFingerprint'));
      assert.equal(fieldOf(receipt, 'postcondition'), 'passed', 'the targeted readback proved the effect, its enabled state and its controls');
      assert.deepEqual(recordsOf(receipt, 'verification.steps').map((step) => fieldOf(step, 'verificationState')), ['exact']);
    }
    const undone = await rig.agent('ae_undo_plan', { planId });
    assert.equal(fieldOf(undone.body, 'error.code'), 'SCOPED_UNDO_UNSUPPORTED');
    assert.doesNotMatch(textOf(undone.body, 'error.message'), /rename/, 'an effect creation is not called a rename');
    assert.equal(world.calls.add, 1);
  }
});

test('explicit initialization never falls through to legacy hidden defaults', async (t) => {
  const { world, rig } = await collected(t);
  world.rewrite = (entry, args) => (entry === 'aeApplyPlan' ? presentFields({ ...args, readSet: undefined }) : args);
  const { receipt } = await applyPlan(rig, createOps());
  assertNotApplied(receipt, textOf(lastAnswer(world, 'aeApplyPlan'), 'error.code'));
  assert.equal(world.calls.add, 0);
  assert.equal(world.calls.begin, 0);
  assert.equal(callsTo(world, 'aeApplyPlan').length, 1);
});

test('approval presentation exposes every creation setting before the target description', async (t) => {
  const { rig } = await collected(t);
  const planId = await propose(rig, createOps(), SUMMARY);
  const [row] = presentPlanRows(latestSnapshot(rig), sealedPlan(rig, planId).operations);
  assert.ok(row, 'the plan presents a row');
  assert.ok(fieldOf(row, 'target'), 'the row names its target apart from the settings');
  const after = textOf(row, 'after'), target = textOf(row, 'target');
  for (const text of [/^enabled, /, /blurriness 20/, /both directions/, /edges repeated/]) assert.match(after, text);
  assert.ok(after.indexOf('enabled') < after.indexOf('blurriness'), 'the enabled state comes before the control settings');
  assert.ok(!after.includes(target), 'the settings are not mixed into the target description');
});
