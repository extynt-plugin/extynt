// The metadata read set (a layer rename in a 300-composition project) through the native lane: scoped demand, approval bound to the read set, one apply batch.
import { jsonFieldsOf } from '../packages/mcp-server/dist/src/index.js';
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { metadataReadSet, metadataReadSetJson, validateActionPlan, computePlanDigest, bindApproval } from '../packages/action-plan/dist/src/index.js';
import type { ActionPlan, ApprovalBinding, ApprovalCapability, SetLayerNameOperation } from '../packages/action-plan/dist/src/index.js';
import { array, decodeOrThrow, jsonObject, presentFields, wireJson } from '../packages/decode/dist/src/index.js';
import { compileCommand } from '../packages/host-ae/dist/src/index.js';
import { resolveComposition, resolveLayer } from '../packages/project-graph/dist/src/index.js';
import type { ProjectSnapshot } from '../packages/project-graph/dist/src/index.js';
import { ok } from '../tools/fake-plugin/dist/src/index.js';
import { metadataBeforeMatches, metadataReadbackSnapshot } from '../apps/sidecar/dist/src/verify/metadata-readback.js';
import { fieldOf } from '../apps/sidecar/dist/tests/http-json.js';
import type { JsonObject } from '../apps/sidecar/dist/tests/http-json.js';
import type { NativeRig } from '../apps/sidecar/dist/tests/native-rig.js';
import { metadataWorld } from './readset-native-metadata-world.ts';
import type { MetadataOptions, MetadataWorld } from './readset-native-metadata-world.ts';
import { worldRig, demand, propose, approve, applyPlan, assertNotApplied, receiptOf, latestRaw, latestSnapshot, latestStored, sealedPlan, issuedCapability, boundApproval } from './readset-native-rig.ts';
import { applyAgain, lastAnswer, lastReadback, rewriteOperations, sentCommand } from './readset-native-host.ts';

type RenameOperation = { type: 'set_layer_name'; target: { compositionId: string; layerId: string }; name: string };

const renameOps = (name = 'After'): RenameOperation[] => [{ type: 'set_layer_name', target: { compositionId: '300', layerId: '900' }, name }];

interface Sealed {
  readonly world: MetadataWorld;
  readonly rig: NativeRig;
  readonly planId: string;
  readonly plan: ActionPlan;
  readonly snapshot: ProjectSnapshot;
  readonly capability: ApprovalCapability;
  readonly approval: ApprovalBinding;
}

async function collected(t: TestContext, options?: MetadataOptions): Promise<{ world: MetadataWorld; rig: NativeRig }> {
  const world = metadataWorld(options), rig = await worldRig(t, world);
  const page = await demand(rig, { target: world.target });
  assert.equal(fieldOf(page, 'data.state'), 'observed', JSON.stringify(page));
  return { world, rig };
}

async function sealed(t: TestContext): Promise<Sealed> {
  const { world, rig } = await collected(t);
  const planId = await propose(rig, renameOps());
  const plan = sealedPlan(rig, planId), snapshot = latestSnapshot(rig);
  const capability = issuedCapability(plan, snapshot);
  return { world, rig, planId, plan, snapshot, capability, approval: boundApproval(plan, snapshot, capability) };
}

function renameOf(plan: ActionPlan): SetLayerNameOperation {
  const operation = plan.operations[0];
  if (operation?.type !== 'set_layer_name') throw new Error('the plan does not start with a rename');
  return operation;
}

const reopenOnBegin = (world: MetadataWorld): void => { world.context.app.beginUndoGroup = () => { world.calls.begin++; world.project.revision++; }; };

test('composition 300 metadata approval applies and reconciles without any prefix or deep traversal', async (t) => {
  const { world, rig } = await collected(t);
  const before = latestSnapshot(rig);
  world.calls.items = 0;
  world.calls.layers = 0;
  const { receipt } = await applyPlan(rig, renameOps());
  assert.equal(fieldOf(receipt, 'status'), 'executed', JSON.stringify(receipt));
  assert.equal(world.layer.name, 'After');
  assert.deepEqual([world.calls.begin, world.calls.end, world.calls.items, world.calls.layers], [1, 1, 4, 3]);
  assert.equal(fieldOf(sentCommand(world), 'readSet.schemaVersion'), 'metadata-read-set/1');
  assert.deepEqual(rig.batches().at(-1), ['watch_state', 'host_call:aeApplyPlan', 'watch_state']);
  const after = latestSnapshot(rig);
  assert.equal(after.compositions[0]?.layers[0]?.name, 'After');
  assert.equal(fieldOf(latestStored(rig), 'snapshot.result.coverage.properties'), 'unknown');
  assert.notEqual(after.fingerprint, before.fingerprint);
  assert.equal(fieldOf(receipt, 'afterFingerprint'), after.fingerprint);
  assert.equal(fieldOf(receipt, 'beforeFingerprint'), before.fingerprint);
});

test('changed operation semantics or a missing read-set binding cannot reuse approval', async (t) => {
  const { world, rig, plan, snapshot, capability, approval } = await sealed(t);
  const changed: ActionPlan = { ...plan, operations: [{ ...renameOf(plan), name: 'Widened' }] };
  changed.digest = computePlanDigest(changed);
  assert.equal(fieldOf(bindApproval(changed, snapshot, capability), 'ok'), false);
  assert.equal(fieldOf(compileCommand(plan, snapshot, presentFields({ ...approval, readSetDigest: undefined })), 'code'), 'APPROVAL_MISMATCH');
  world.rewrite = (entry, args) => (entry === 'aeApplyPlan' ? rewriteOperations(args, (operation) => ({ ...operation, name: 'Widened' })) : args);
  const { receipt } = await approve(rig, plan.planId);
  assertNotApplied(receipt, 'INVALID_READ_SET');
  assert.equal(world.calls.begin, 0);
});

const SWITCHING_MOVES: ReadonlyArray<readonly [string, (world: MetadataWorld, rig: NativeRig) => void]> = [
  ['external', (world) => { world.layer.name = 'External'; }],
  ['undo', (world) => { world.project.revision++; }],
  ['switch', (_world, rig) => { rig.plugin.state.watch = { ...rig.plugin.state.watch, epoch: rig.plugin.state.watch.epoch + 1 }; }],
];

test('external edit, undo revisions and a project switch refuse before an undo group opens', async (t) => {
  for (const [kind, move] of SWITCHING_MOVES) {
    const { world, rig } = await collected(t);
    const { receipt } = await applyPlan(rig, renameOps(), () => move(world, rig));
    assertNotApplied(receipt, 'STALE_READ_SET', kind);
    assert.equal(world.calls.begin, 0, kind);
  }
});

test('replay after mutation is refused and does not open a second group', async (t) => {
  const { world, rig } = await collected(t);
  const { receipt } = await applyPlan(rig, renameOps());
  assert.equal(fieldOf(receipt, 'status'), 'executed');
  assert.equal(fieldOf(applyAgain(world, rig.plugin, sentCommand(world)), 'error.code'), 'STALE_READ_SET');
  assert.equal(world.calls.begin, 1);
});

test('readback mismatch preserves the mutation and the completed-operation evidence', async (t) => {
  const world = metadataWorld({ coerce: true }), rig = await worldRig(t, world);
  await demand(rig, { target: world.target });
  const { receipt } = await applyPlan(rig, renameOps());
  assert.equal(fieldOf(lastAnswer(world, 'aeApplyPlan'), 'error.code'), 'READBACK_MISMATCH');
  assert.equal(fieldOf(receipt, 'hostError.code'), 'READBACK_MISMATCH');
  assert.equal(fieldOf(receipt, 'mayHaveMutated'), true);
  assert.deepEqual(fieldOf(receipt, 'completedOperations'), ['set_layer_name']);
  assert.deepEqual([world.calls.begin, world.calls.end], [1, 1]);
});

test('malformed or unsupported read sets refuse without throwing or pretending unknown values are absent', async (t) => {
  const { plan, snapshot } = await sealed(t);
  const unsupported: ReadonlyArray<ReadonlyArray<JsonObject | null>> = [
    [null], [{ type: 'set_layer_name' }], [{ type: 'set_layer_property', target: jsonFieldsOf(renameOf(plan).target), propertyPath: 'ADBE Opacity', role: 'transform.opacity', value: 50 }],
  ];
  for (const operations of unsupported) {
    assert.equal(fieldOf(validateActionPlan(jsonFieldsOf({ ...plan, operations }), snapshot), 'code'), 'READ_SET_UNSUPPORTED');
  }
  assert.equal(resolveComposition(snapshot, { id: '1' }).status, 'unknown');
  assert.equal(resolveComposition(snapshot, { name: 'Comp 300' }).status, 'unknown');
  assert.equal(resolveComposition(snapshot, { id: '300' }).status, 'found');
  assert.equal(resolveLayer(snapshot, { name: 'Before' }).status, 'unknown');
  assert.equal(resolveLayer(snapshot, { compositionId: '300', name: 'Before' }).status, 'found');
  assert.equal(metadataReadSet(plan, snapshot)?.digest, metadataReadSet(plan, snapshot)?.digest);
});

test('missing or mismatched targeted readback, or a different before snapshot, cannot produce verified metadata', async (t) => {
  const { world, rig } = await collected(t);
  const raw = latestRaw(rig);
  await applyPlan(rig, renameOps());
  const command = sentCommand(world), readback = lastReadback(world);
  assert.equal(metadataBeforeMatches(command, { ...raw, result: { ...decodeOrThrow(jsonObject, raw.result), compositions: [] } }), false);
  assert.equal(metadataReadbackSnapshot(command, { rows: [] }, raw, 'after'), null);
  const rows = decodeOrThrow(array(jsonObject), readback.rows);
  const wrong = { ...readback, rows: rows.map((row, index) => (index === 0 ? { ...row, name: 'Wrong' } : row)) };
  assert.equal(metadataReadbackSnapshot(command, wrong, raw, 'after'), null);
  const missing = { ...readback, compositions: [] };
  assert.equal(metadataReadbackSnapshot(command, missing, raw, 'after'), null, 'missing fresh composition metadata is not promoted');
  assert.ok(metadataReadbackSnapshot(command, readback, raw, 'after'), 'the untouched readback does reconcile');
});

test('the built-in observation condition is supported but arbitrary condition semantics refuse', async (t) => {
  const { plan, snapshot } = await sealed(t);
  const planJson = decodeOrThrow(jsonObject, decodeOrThrow(wireJson, plan));
  assert.ok(metadataReadSetJson({ ...planJson, postconditions: [{ code: 'OPERATIONS_OBSERVED', description: 'Fresh observation' }] }, snapshot));
  assert.equal(metadataReadSetJson({ ...planJson, postconditions: [{ code: 'OPERATIONS_OBSERVED', target: 'other' }] }, snapshot), undefined);
  assert.equal(metadataReadSetJson({ ...planJson, postconditions: [{ code: 'CUSTOM' }] }, snapshot), undefined);
});

test('a reentrant change when opening the undo group refuses before the setter and closes the group', async (t) => {
  const { world, rig } = await collected(t);
  const { receipt } = await applyPlan(rig, renameOps(), () => reopenOnBegin(world));
  assert.equal(fieldOf(receipt, 'status'), 'rejected');
  assert.equal(fieldOf(receipt, 'hostError.code'), 'STALE_READ_SET');
  assert.equal(world.layer.name, 'Before');
  assert.equal(world.calls.end, 1);
});

test('authenticated MCP proposal, approval, host delivery and a duplicate apply claim retain the read set', async (t) => {
  const { world, rig } = await collected(t);
  const planId = await propose(rig, renameOps(), 'Rename exact observed layer');
  const receivers = rig.sidecar.receivers, reserve = receivers.nativeBridge;
  let duplicate: ReturnType<typeof receivers.beginApply> | undefined;
  receivers.nativeBridge = (action, body) => {
    if (action === 'reserve' && !duplicate) duplicate = receivers.beginApply(`${planId} 1 operations`);
    return reserve(action, body);
  };
  const approved = await rig.agent('ae_approve_plan', { planId, acknowledgeUnverified: true });
  assert.equal(fieldOf(approved.body, 'data.status'), 'approved', JSON.stringify(approved.body));
  await rig.waitFor(() => receiptOf(rig, planId) !== undefined);
  const command = sentCommand(world);
  assert.equal(fieldOf(command, 'readSet.schemaVersion'), 'metadata-read-set/1');
  assert.equal(fieldOf(approved.body, 'data.approval.readSetDigest'), fieldOf(command, 'readSet.digest'));
  assert.equal(fieldOf(await duplicate, 'body.alreadyExecuting'), true, 'a second claim for the plan being applied does not start another apply');
  assert.equal(fieldOf(receiptOf(rig, planId), 'status'), 'executed');
  assert.equal(world.calls.begin, 1);
  for (const name of ['ae_undo_plan', 'ae_undo_agent_work']) {
    const undone = await rig.agent(name, { planId });
    assert.equal(fieldOf(undone.body, 'error.code'), 'SCOPED_UNDO_UNSUPPORTED', JSON.stringify(undone.body));
  }
  assert.equal(rig.sidecar.agentMailbox.length, 0, 'nothing further is queued for the host');
  assert.deepEqual(rig.writes(), ['aeApplyPlan']);
});

const MALFORMED_APPLY_ANSWERS = ['{}', '{"ok":"true"}', '{"ok":true}', '{"ok":true,"steps":[]}', '{"ok":true,"mayHaveMutated":false,"error":{}}', 'null', 'not-json'];

test('malformed host apply answers cannot claim that nothing changed', async (t) => {
  for (const answer of MALFORMED_APPLY_ANSWERS) {
    const { rig } = await collected(t);
    rig.plugin.hostCalls.set('aeApplyPlan', () => ok(answer));
    const { receipt } = await applyPlan(rig, renameOps());
    assert.notEqual(fieldOf(receipt, 'status'), 'executed', answer);
    assert.equal(fieldOf(receipt, 'mayHaveMutated'), true, answer);
    assert.equal(fieldOf(receipt, 'mutationState'), 'unknown', answer);
  }
});
