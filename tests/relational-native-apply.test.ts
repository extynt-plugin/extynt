// An approved typed parameter change applied by the native lane: SQL stays unconfirmed until the exact receipt settles,
// and a failed readback keeps its uncertainty.
import assert from 'node:assert/strict';
import test from 'node:test';
import { fieldOf, listAt, numberAt, recordOf, recordsAt, textAt } from '../apps/panel/dist/tests/json-narrow.js';
import { agentPage, appliedPlan, approveParameter, blurObservation, controlPage, desiredEvidence, firstControl, parameterProposal, relationalRig } from './relational-native-agent.ts';
import type { DesiredEvidence } from './relational-native-agent.ts';
import { spy } from './relational-native-rig.ts';
import type { Rig, RigCall } from './relational-native-rig.ts';
import { scriptedParameterProposal } from './relational-native-scripted.ts';
import type { VerifiedReadbackInput } from '../apps/sidecar/dist/src/graph-control-types.js';
import type { JsonObject, JsonValue } from '../packages/decode/dist/src/index.js';

interface Seen {
  admitted: DesiredEvidence | undefined;
  admittedControls: JsonObject | undefined;
  beforeConfirmation: DesiredEvidence | undefined;
  controlsBeforeConfirmation: JsonValue | undefined;
  verifySnapshot: JsonValue | undefined;
}

interface Admission {
  readonly seen: Seen;
  readonly control: JsonObject;
  readonly apply: RigCall;
  readonly observedSnapshot: JsonValue | undefined;
}

function snapshotId(rig: Rig): JsonValue | undefined {
  assert.ok(rig.sidecar.latest, 'the sidecar holds a snapshot');
  return rig.sidecar.latest.snapshot.requestId;
}

function applyCall(rig: Rig): RigCall {
  const apply = rig.calls.find(call => call.entry === 'aeApplyPlan');
  assert.ok(apply, 'the lane called the native apply');
  return apply;
}

function watchApply(rig: Rig, planId: string): Seen {
  const seen: Seen = {
    admitted: undefined, admittedControls: undefined, beforeConfirmation: undefined, controlsBeforeConfirmation: undefined, verifySnapshot: undefined,
  };
  rig.beforeNative = async name => {
    if (name !== 'aeApplyPlan') return;
    seen.admitted = desiredEvidence(rig, planId);
    seen.admittedControls = await controlPage(rig);
  };
  spy<'observeVerifiedReadback', [VerifiedReadbackInput], JsonObject>(rig.sidecar.collection, 'observeVerifiedReadback', () => {
    seen.beforeConfirmation = desiredEvidence(rig, planId);
    seen.controlsBeforeConfirmation = rig.sidecar.collection.queryRelational({ kind: 'controls', compositionId: rig.host.comp.id, layerId: rig.host.title.id }).state;
    seen.verifySnapshot = rig.sidecar.latest?.snapshot.requestId;
  });
  return seen;
}

function assertAdmission(rig: Rig, { seen, control, apply, observedSnapshot }: Admission): void {
  assert.ok(seen.admitted && seen.beforeConfirmation, 'the apply was admitted and the readback was observed');
  assert.equal(seen.admitted.status, 'bound', 'the lease admission binds the desired request before the plugin runs');
  assert.equal(seen.admitted.source_observation_id, fieldOf(control, 'observationId'));
  assert.equal(seen.admitted.read_set_digest, textAt(apply.args, 'readSet', 'digest'));
  assert.equal(seen.admitted.ticket, fieldOf(rig.leases.at(-1), 'requestId'));
  assert.equal(seen.admitted.verified_observation_id, null);
  assert.equal(fieldOf(seen.admittedControls, 'state'), 'unknown', 'mutation admission retires the observation before the plugin runs');
  assert.equal(seen.beforeConfirmation.status, 'bound', 'lease settlement and the posted verify snapshot do not confirm a desire');
  assert.equal(seen.controlsBeforeConfirmation, 'unknown', 'callback settlement does not confirm SQL');
  assert.notEqual(seen.verifySnapshot, observedSnapshot, 'a fresh verify snapshot was posted before the receipt');
}

function assertPostedReceipt(rig: Rig): void {
  const posted = rig.receipts.at(-1);
  assert.ok(posted, 'the lane posted a receipt');
  assert.equal(fieldOf(posted.receipt, 'postcondition'), 'passed', 'the lane verified the exact native readback');
  assert.equal(fieldOf(posted.receipt, 'verification', 'steps', 0, 'verificationState'), 'exact');
  assert.equal(fieldOf(posted.answer, 'receipt', 'graphSynchronization', 'state'), 'observed', JSON.stringify(posted.answer));
  assert.equal(fieldOf(posted.answer, 'receipt', 'graphSynchronization', 'writeAuthorizing'), false);
}

async function assertConfirmed(rig: Rig, planId: string, control: JsonObject, apply: RigCall): Promise<void> {
  const confirmed = desiredEvidence(rig, planId);
  const stamp = fieldOf(apply.result, 'metadataReadback', 'stamp');
  assert.equal(confirmed.status, 'verified');
  assert.equal(confirmed.receipt_reference, 'relational-confirmed-receipt');
  assert.equal(confirmed.verified_epoch, fieldOf(stamp, 'epoch'));
  assert.equal(confirmed.verified_revision, fieldOf(stamp, 'revision'));
  assert.notEqual(confirmed.verified_observation_id, fieldOf(control, 'observationId'));
  const current = firstControl(await controlPage(rig));
  assert.equal(fieldOf(current, 'current', 'value'), 8);
  assert.equal(fieldOf(current, 'observationId'), confirmed.verified_observation_id);
  assert.equal(fieldOf(current, 'sourceKind'), 'verified-readback');
  assert.deepEqual(fieldOf(current, 'stamp'), stamp);
  const query = { kind: 'desired-requests', controlInstanceId: numberAt(control, 'controlInstanceId'), limit: 1 };
  const desiredPage = await rig.tool('ae_query_relational_graph', { query });
  assert.equal(desiredPage.status, 200, JSON.stringify(desiredPage.body));
  const [row] = recordsAt(desiredPage.body, 'data', 'rows');
  assert.equal(fieldOf(row, 'status'), 'verified');
  assert.deepEqual(fieldOf(row, 'afterStamp'), stamp);
  assert.equal(fieldOf(row, 'receiptReference'), confirmed.receipt_reference);
  assert.equal(fieldOf(row, 'writeAuthorizing'), false);
}

test('native apply and verification confirm SQL only after exact receipt settlement', async t => {
  const rig = await relationalRig(t);
  const { control } = await blurObservation(rig);
  const observedSnapshot = snapshotId(rig);
  const { proposal, result: agent } = await scriptedParameterProposal(rig);
  assert.equal(agent.tools.length, 2);
  assert.equal(desiredEvidence(rig, proposal.planId).status, 'prepared');
  assert.equal(fieldOf(firstControl(await controlPage(rig)), 'current', 'value'), 4);
  const seen = watchApply(rig, proposal.planId);
  rig.receiptHook = (receipt, send) => send({ ...recordOf(receipt), receiptId: 'relational-confirmed-receipt' });
  await approveParameter(rig, proposal);
  const plan = await appliedPlan(rig, proposal.planId);
  const apply = applyCall(rig);
  assert.equal(fieldOf(apply.result, 'ok'), true, JSON.stringify(apply.result));
  assert.equal(fieldOf(apply.result, 'metadataReadback', 'localEffect', 'value'), 8);
  assert.equal(textAt(apply.args, 'readSet', 'schemaVersion'), 'blur-control-read-set/1');
  assert.equal(listAt(apply.args, 'operations').length, 1);
  assert.equal(rig.host.counters.setters, 1);
  assertAdmission(rig, { seen, control, apply, observedSnapshot });
  assertPostedReceipt(rig);
  await assertConfirmed(rig, proposal.planId, control, apply);
  assert.equal(plan.status, 'verified');
  assert.equal(rig.sidecar.inFlight, undefined);
});

test('failed native readback preserves mutation uncertainty and requires a fresh demand before recovery', async t => {
  const rig = await relationalRig(t);
  const { control } = await blurObservation(rig);
  const proposal = await parameterProposal(rig, control);
  const property = rig.host.gaussian.children[0];
  assert.ok(property, 'the gaussian blur has a blurriness property');
  const setValue = property.setValue.bind(property);
  property.setValue = value => setValue(typeof value === 'number' ? value + 1 : value);
  await approveParameter(rig, proposal);
  await appliedPlan(rig, proposal.planId);
  const apply = applyCall(rig);
  assert.equal(fieldOf(apply.result, 'ok'), false, JSON.stringify(apply.result));
  assert.equal(fieldOf(apply.result, 'error', 'code'), 'READBACK_MISMATCH');
  assert.equal(fieldOf(apply.result, 'mayHaveMutated'), true);
  assert.equal(rig.host.counters.setters, 1);
  assert.equal(rig.sidecar.inFlight, undefined);
  const answer = rig.receipts.at(-1)?.answer;
  assert.equal(fieldOf(answer, 'receipt', 'postcondition'), 'partial_mutation_possible');
  assert.equal(fieldOf(answer, 'receipt', 'graphSynchronization', 'state'), 'invalidated');
  assert.equal(desiredEvidence(rig, proposal.planId).status, 'invalidated');
  assert.equal(desiredEvidence(rig, proposal.planId).verified_observation_id, null);
  assert.equal(fieldOf(await controlPage(rig), 'state'), 'unknown');
  property.setValue = setValue;
  const fresh = await agentPage(rig, { target: { ...rig.host.target('blur'), expectedStamp: rig.host.stamp() }, limit: 1 });
  assert.equal(fresh.completed.status, 200, JSON.stringify(fresh.completed.body));
  const current = firstControl(await controlPage(rig));
  assert.equal(fieldOf(current, 'current', 'value'), 9, 'fresh native evidence reports the actual partial setter outcome');
  const retry = await parameterProposal(rig, current, 8);
  assert.notEqual(retry.planId, proposal.planId);
  assert.equal(desiredEvidence(rig, retry.planId).status, 'prepared');
});
