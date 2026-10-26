// What the receipt of a native typed apply may and may not confirm in relational SQL, with the receipt altered at the sidecar's receiver boundary.
import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { fieldOf, listAt, numberAt, recordAt, recordOf } from '../apps/panel/dist/tests/json-narrow.js';
import type { ReceiverOutcome } from '../apps/sidecar/dist/src/receiver-types.js';
import { isJsonObject } from '../packages/decode/dist/src/index.js';
import type { JsonObject, JsonValue } from '../packages/decode/dist/src/index.js';
import { approveParameter, blurObservation, controlPage, desiredEvidence, firstControl, parameterProposal, relationalRig } from './relational-native-agent.ts';
import type { DesiredEvidence, Proposal } from './relational-native-agent.ts';
import { answerOf, until } from './relational-native-rig.ts';
import type { Rig } from './relational-native-rig.ts';

interface Refusal {
  readonly evidence: DesiredEvidence;
  readonly controls: JsonObject;
}

interface Seen {
  original: JsonValue | undefined;
  refused: ReceiverOutcome | undefined;
  afterRefusal: Refusal | undefined;
}

interface ApplyRun {
  readonly rig: Rig;
  readonly proposal: Proposal;
  readonly seen: Seen;
}

type Send = (next: JsonValue) => Promise<ReceiverOutcome>;
type OnReceipt = (receipt: JsonValue, send: Send, run: ApplyRun) => Promise<ReceiverOutcome>;
type Corruption = (receipt: JsonValue) => JsonValue;

async function startApply(t: TestContext, onReceipt: OnReceipt): Promise<ApplyRun> {
  const rig = await relationalRig(t);
  const { control } = await blurObservation(rig);
  const proposal = await parameterProposal(rig, control);
  const run: ApplyRun = { rig, proposal, seen: { original: undefined, refused: undefined, afterRefusal: undefined } };
  rig.receiptHook = async (receipt, send) => {
    run.seen.original = structuredClone(receipt);
    return onReceipt(receipt, send, run);
  };
  await approveParameter(rig, proposal);
  return run;
}

async function nativeApply(t: TestContext, onReceipt: OnReceipt): Promise<ApplyRun> {
  const run = await startApply(t, onReceipt);
  await settled(run.rig);
  return run;
}

async function settled(rig: Rig): Promise<void> {
  await until(() => rig.receipts.length > 0);
  await rig.quiet();
}

function inReadback(receipt: JsonValue, change: (readback: JsonObject) => JsonObject): JsonValue {
  if (!isJsonObject(receipt)) throw new Error('the receipt is not an object');
  return { ...receipt, metadataReadback: change(recordAt(receipt, 'metadataReadback')) };
}

function inFirstRow(readback: JsonObject, change: (row: JsonObject) => JsonObject): JsonObject {
  const [row, ...rest] = listAt(readback, 'rows');
  if (!isJsonObject(row)) throw new Error('the readback has no row');
  return { ...readback, rows: [change(row), ...rest] };
}

function withoutReadback(receipt: JsonValue): JsonValue {
  return Object.fromEntries(Object.entries(recordOf(receipt)).filter(([key]) => key !== 'metadataReadback'));
}

const proofFaults: ReadonlyArray<readonly [string, Corruption]> = [
  ['unrelated native target', receipt => inReadback(receipt, readback => inFirstRow(readback, row => ({ ...row, layerId: 'unrelated-layer' })))],
  ['older native revision', receipt => inReadback(receipt, readback => ({ ...readback, stamp: { ...recordAt(readback, 'stamp'), revision: 0 } }))],
  ['unproved expression state', receipt => inReadback(receipt, readback => ({ ...readback, localEffect: { ...recordAt(readback, 'localEffect'), expressionEnabled: true } }))],
  ['absent native proof', withoutReadback],
  ['trimmed verification', receipt => ({ ...recordOf(receipt), verificationTrimmed: true })],
];

for (const [name, corrupt] of proofFaults) {
  test(`a passed receipt carrying ${name} cannot confirm relational SQL state`, async t => {
    const { rig, proposal, seen } = await nativeApply(t, (receipt, send) => send(corrupt(receipt)));
    assert.equal(fieldOf(seen.original, 'postcondition'), 'passed', 'the lane verified the authentic result before the receipt was altered');
    assert.equal(fieldOf(rig.receipts.at(-1)?.answer, 'receipt', 'graphSynchronization', 'state'), 'invalidated', JSON.stringify(rig.receipts.at(-1)?.answer));
    const desired = desiredEvidence(rig, proposal.planId);
    assert.equal(desired.status, 'invalidated');
    assert.equal(desired.verified_observation_id, null);
    assert.equal(desired.receipt_reference, null);
    assert.equal(fieldOf(await controlPage(rig), 'state'), 'unknown');
    assert.equal(rig.host.counters.setters, 1, 'receiving a proof never issues a setter');
  });
}

test('receipt approval refusal leaves bound evidence available for the exact authorized receipt', async t => {
  const refusingFirst: OnReceipt = async (receipt, send, { rig, proposal, seen }) => {
    seen.refused = await send({ ...recordOf(receipt), approvalId: 'another-approval' });
    seen.afterRefusal = { evidence: desiredEvidence(rig, proposal.planId), controls: await controlPage(rig) };
    return send(receipt);
  };
  const { rig, proposal, seen } = await nativeApply(t, refusingFirst);
  assert.ok(seen.refused && seen.afterRefusal);
  assert.equal(seen.refused.status, 409, JSON.stringify(answerOf(seen.refused)));
  assert.equal(fieldOf(answerOf(seen.refused), 'error', 'code'), 'APPROVAL_MISMATCH');
  assert.equal(seen.afterRefusal.evidence.status, 'bound');
  assert.equal(fieldOf(seen.afterRefusal.controls, 'state'), 'unknown');
  assert.equal(fieldOf(rig.receipts.at(-1)?.answer, 'receipt', 'graphSynchronization', 'state'), 'observed');
  const verified = desiredEvidence(rig, proposal.planId);
  assert.equal(verified.status, 'verified');
  assert.match(verified.receipt_reference ?? '', /^native-readback-sha256:[0-9a-f]{64}$/, 'a receipt without an id is referenced by the hash of its proof');
  assert.equal(fieldOf(firstControl(await controlPage(rig)), 'current', 'value'), 8);
  assert.equal(rig.host.counters.setters, 1);
});

test('late exact native proof cannot restore SQL after an explicit native manual change signal', async t => {
  let release = (): void => undefined;
  const held = new Promise<void>(resolve => { release = resolve; });
  const { rig, proposal, seen } = await startApply(t, async (receipt, send) => { await held; return send(receipt); });
  await until(() => seen.original !== undefined);
  const nativeRevision = numberAt(seen.original, 'metadataReadback', 'stamp', 'revision');
  rig.host.edit(7);
  rig.change();
  await until(() => (rig.sidecar.liveStamp?.revision ?? Number.NEGATIVE_INFINITY) > nativeRevision);
  assert.equal(fieldOf(await controlPage(rig), 'state'), 'unknown');
  release();
  await settled(rig);
  assert.equal(fieldOf(rig.receipts.at(-1)?.answer, 'receipt', 'graphSynchronization', 'state'), 'observed', JSON.stringify(rig.receipts.at(-1)?.answer));
  const current = await controlPage(rig);
  assert.equal(fieldOf(current, 'state'), 'unknown', 'the late proof does not make the control current again');
  assert.deepEqual(fieldOf(current, 'rows'), []);
  const proven = desiredEvidence(rig, proposal.planId);
  assert.equal(proven.status, 'verified');
  assert.equal(proven.verified_revision, nativeRevision, 'the proof stays attributed to the revision it proved');
  assert.ok((rig.sidecar.liveStamp?.revision ?? Number.NEGATIVE_INFINITY) > (proven.verified_revision ?? Number.POSITIVE_INFINITY), 'the live revision has moved past the proof');
  assert.equal(rig.host.counters.setters, 2, 'only the approved apply and manual edit invoked setters');
});
