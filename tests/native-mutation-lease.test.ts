/** Tests which outcomes pin the mutation lane and which settle it. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { pairing } from '../apps/sidecar/dist/src/server-http-auth.js';
import { panelRoutes } from '../apps/sidecar/dist/src/server-panel-routes.js';
import { findRoute } from '../apps/sidecar/dist/src/server-route-table.js';
import { accepted } from '../apps/sidecar/dist/src/receiver-outcome.js';
import { NativeFlight } from '../apps/sidecar/dist/src/server-native-flight.js';
import { settleApplyReceipt } from '../apps/sidecar/dist/src/server-apply-settlement.js';
import { sidecarFor } from '../apps/sidecar/dist/tests/sidecar-fixture.js';
import { retainNativeMutationLease, nativeMutationQuarantine, recordUnknownNativeAccess } from '../apps/sidecar/dist/src/native-mutation-lease.js';
import type { InFlightItem, RequestContext } from '../apps/sidecar/dist/src/server-types.js';
import type { ReceiptContext } from '../apps/sidecar/dist/src/server-receipt-context.js';
import type { StoredApplyReceipt } from '../apps/sidecar/dist/src/server-apply-receipt.js';
import type { LogFields } from '../apps/sidecar/dist/src/server-plan-log.js';
import type { RespondInput } from '../apps/sidecar/dist/src/sidecar-context.js';
import type { Opaque } from '../apps/sidecar/dist/src/snapshot-view.js';
import type { JsonObject } from '../packages/decode/dist/src/index.js';

interface LogicalBridge { activeLogicalMatches(kind: string, id: string): boolean }

class LeaseState {
  readonly flight = new NativeFlight();
  nativeBridge?: LogicalBridge;
  get inFlight(): InFlightItem | undefined { return this.flight.current; }
  set inFlight(value: InFlightItem | undefined) { this.flight.current = value; }
}

const makeState = (kind = 'apply_plan'): LeaseState => {
  const state = new LeaseState();
  state.inFlight = { kind, id: 'plan-1', claimedAt: 4 };
  state.nativeBridge = { activeLogicalMatches: () => true };
  return state;
};

type LeaseSidecar = ReturnType<typeof leaseSidecar>;

const settlementOf = (state: LeaseState): string | undefined => state.inFlight?.nativeSettlement;

const leaseSidecar = (token: string) => sidecarFor({ port: 0, token, quietAgentLog: true });

const requestFor = (headers: { readonly instance?: string; readonly body?: string }): IncomingMessage => {
  const request = new IncomingMessage(new Socket());
  request.headers.authorization = 'Bearer t';
  if (headers.instance !== undefined) request.headers['x-ae-panel-instance'] = headers.instance;
  if (headers.body !== undefined) request.push(Buffer.from(headers.body));
  request.push(null);
  return request;
};

for (const code of ['HOST_DISPATCH_UNKNOWN', 'HOST_TIMEOUT', 'HOST_HOP_TIMED_OUT']) {
  test(code + ' pins exact mutation lane across receipt cleanup, pairing and replacement', () => {
    const state = makeState();
    retainNativeMutationLease(state, { planId: 'plan-1', hostError: { code }, mayHaveMutated: true, mutationState: 'unknown' });
    const pinned = state.inFlight;
    assert.ok(pinned);
    assert.equal(pinned.nativeSettlement, 'unknown');
    assert.ok(Object.isFrozen(pinned));
    state.inFlight = undefined;
    assert.equal(state.inFlight, pinned);
    state.inFlight = { kind: 'apply_plan', id: 'other-plan', claimedAt: 9 };
    assert.equal(state.inFlight, pinned);
    retainNativeMutationLease(state, { planId: 'plan-1', hostError: { code: 'HOST_TIMEOUT' } });
    assert.equal(state.inFlight, pinned);
    const recovery = nativeMutationQuarantine(state.inFlight);
    assert.ok(recovery);
    assert.equal(recovery.code, code);
    assert.equal(recovery.recovery, 'exact-callback-or-explicit-local-journal-recovery');
    assert.match(recovery.message, /Do not retry, collect, apply, Undo or Redo/);
    assert.match(recovery.message, /Restart and reconnect do not establish settlement/);
    assert.equal(nativeMutationQuarantine(new LeaseState().inFlight), null);
  });
}

test('known-settled partial failure, malformed callback and ordinary collection never pin mutation lane', () => {
  for (const code of ['PROPERTY_WRITE_FAILED', 'READBACK_MISMATCH', 'INVALID_HOST_RESPONSE', 'HOST_BUSY', 'HOST_QUARANTINED']) {
    const state = makeState();
    retainNativeMutationLease(state, { planId: 'plan-1', hostError: { code }, mayHaveMutated: true, mutationState: 'unknown' });
    assert.equal(nativeMutationQuarantine(state.inFlight), null);
    state.inFlight = undefined; assert.equal(state.inFlight, undefined);
  }
  const collection = makeState('collection_page');
  retainNativeMutationLease(collection, { planId: 'plan-1', hostError: { code: 'HOST_TIMEOUT' } });
  collection.inFlight = undefined; assert.equal(collection.inFlight, undefined);
});

test('mismatched/pre-dispatch evidence cannot pin another plan; undo timeout is pinned', () => {
  const state = makeState();
  retainNativeMutationLease(state, { planId: 'different-plan', hostError: { code: 'HOST_TIMEOUT' } });
  assert.equal(nativeMutationQuarantine(state.inFlight), null);
  const absent = new LeaseState();
  retainNativeMutationLease(absent, { planId: 'plan-1', hostError: { code: 'HOST_TIMEOUT' } });
  assert.equal(absent.inFlight, undefined);
  const undo = makeState('undo_plan');
  retainNativeMutationLease(undo, { planId: 'plan-1', hostError: { code: 'HOST_HOP_TIMED_OUT' }, status: 'unknown' });
  undo.inFlight = undefined; assert.equal(settlementOf(undo), 'unknown');
});

test('actual apply receipt settlement records outcome while retaining native lane', () => {
  const sidecar = leaseSidecar('lease-token');
  sidecar.inFlight = { kind: 'apply_plan', id: 'plan-1', claimedAt: 4 };
  sidecar.nativeBridge.activeLogicalMatches = () => true;
  const runtime = { projectWorkflowApplyReceipt() {}, projectWorkflowUndoReceipt() {}, recordRuntimeEvidence(): never { throw Error('unknown must not publish success evidence'); } };
  const context: ReceiptContext = { state: sidecar, planLog: sidecar, planState: sidecar, jobUndo: sidecar, runtime, transport: sidecar };
  const receipt: StoredApplyReceipt = { planId: 'plan-1', status: 'rejected', receivedAt: '2026-10-24T00:00:00.000Z', operation: 'apply_plan',
    hostError: { code: 'HOST_DISPATCH_UNKNOWN', message: 'the host dispatch outcome is unknown' }, mayHaveMutated: true, mutationState: 'unknown' };
  const admission = { planId: 'plan-1', admitting: undefined, claimed: true, preDispatch: false, reconcileLate: false };
  const outcome = settleApplyReceipt({ context, receipt, admission, panelInstanceId: undefined, readback: undefined });
  assert.equal(sidecar.receipts.length, 1);
  assert.equal(sidecar.inFlight?.nativeSettlement, 'unknown');
  assert.equal(outcome.status, 201);
});

test('precheck/read timeouts and pending approval are never pinned as native mutations', () => {
  for (const kind of ['apply_pending', 'apply_plan']) {
    const state = makeState(kind);
    retainNativeMutationLease(state, { planId: 'plan-1', hostError: { code: 'HOST_TIMEOUT' }, mayHaveMutated: false, mutationState: 'not-applied' });
    assert.equal(nativeMutationQuarantine(state.inFlight), null);
    state.inFlight = undefined; assert.equal(state.inFlight, undefined);
  }
  const pending = makeState('apply_pending');
  retainNativeMutationLease(pending, { planId: 'plan-1', hostError: { code: 'HOST_TIMEOUT' }, mayHaveMutated: true, mutationState: 'unknown' });
  assert.equal(nativeMutationQuarantine(pending.inFlight), null);
});

test('a quarantined host claim is refused before idle abandonment or consuming queued work', () => {
  const sidecar = leaseSidecar('lease-token');
  sidecar.inFlight = { kind: 'apply_plan', id: 'plan-1', claimedAt: 4 };
  assert.equal(recordUnknownNativeAccess(sidecar, { kind: 'mutation', code: 'HOST_TIMEOUT' }, 55), true);
  sidecar.agentMailbox.push({ approvedData: { kind: 'refresh_snapshot' } });
  const outcome = sidecar.claimHostItem();
  assert.equal(outcome.kind, 'blocked');
  assert.equal(outcome.code, 'HOST_NATIVE_UNRESOLVED');
  assert.equal(sidecar.agentMailbox.length, 1);
  assert.equal(sidecar.inFlight.nativeSettlement, 'unknown');
});

test('an unknown read notification is ignored: it pins nothing and invents no mutation; a mutation notification still pins', () => {
  const state = new LeaseState();
  for (const code of ['HOST_DISPATCH_UNKNOWN', 'HOST_TIMEOUT']) {
    assert.equal(recordUnknownNativeAccess(state, { kind: 'read', code }, 55), false);
    assert.equal(state.inFlight, undefined);
  }
  assert.equal(nativeMutationQuarantine(state.inFlight), null);
  assert.equal(recordUnknownNativeAccess(state, { kind: 'mutation', code: 'HOST_TIMEOUT' }, 56), true);
  const pinned = state.inFlight;
  assert.ok(pinned);
  assert.equal(pinned.kind, 'host_native_unknown'); assert.equal(pinned.nativeAccessKind, 'mutation');
  state.inFlight = undefined; assert.equal(state.inFlight, pinned);
  assert.equal(nativeMutationQuarantine(pinned)?.accessKind, 'mutation');
  assert.equal(recordUnknownNativeAccess(state, { kind: 'read', code: 'HOST_TIMEOUT' }, 57), false);
  assert.equal(state.inFlight, pinned);
});

test('scheduler mutation notification preserves actual admitted plan identity, a read notification leaves it alone, and malformed events refuse', () => {
  const state = makeState();
  const malformed: Opaque[] = [null, [], {}, { kind: 'read', code: 'PROPERTY_WRITE_FAILED' }, { kind: 'other', code: 'HOST_TIMEOUT' }];
  for (const value of malformed) assert.equal(recordUnknownNativeAccess(state, value, 55), false);
  assert.equal(recordUnknownNativeAccess(state, { kind: 'mutation', code: 'HOST_TIMEOUT' }, 55), true);
  assert.equal(state.inFlight?.id, 'plan-1'); assert.equal(state.inFlight?.kind, 'apply_plan');
  const pending = makeState('apply_pending');
  assert.equal(recordUnknownNativeAccess(pending, { kind: 'read', code: 'HOST_TIMEOUT' }, 56), false);
  assert.equal(pending.inFlight?.kind, 'apply_pending'); assert.equal(pending.inFlight?.nativeSettlement, undefined);
});

test('native event route refuses native uncertainty from an unpaired panel before intake and takes it from the paired one', async () => {
  const sidecar = leaseSidecar('lease-token');
  const answers: RespondInput[] = [];
  let events = 0;
  sidecar.activePanelInstanceId = 'new-panel';
  sidecar.beginPhase = () => 0;
  sidecar.endPhase = () => {};
  sidecar.respond = (reply) => { answers.push(reply); };
  sidecar.acceptPanelEvent = () => { events += 1; return accepted(200, { ok: true }); };
  const found = findRoute(panelRoutes, 'POST', '/v1/panel/events');
  assert.ok(found);
  const report = JSON.stringify({ code: 'HOST_NATIVE_UNRESOLVED', message: 'unknown', nativeLease: { kind: 'read', code: 'HOST_TIMEOUT' } });
  const send = async (instance: string | undefined): Promise<void> => {
    const request = requestFor({ ...(instance === undefined ? {} : { instance }), body: report });
    const context: RequestContext = { correlationId: 'c', requestId: null, method: 'POST', route: '/v1/panel/events', startedAt: 0 };
    await found.route.serve({ state: sidecar, dispatch: sidecar }, { request, response: new ServerResponse(request), context, url: new URL('http://x/v1/panel/events') }, '');
  };
  for (const instance of [undefined, 'old-panel']) await send(instance);
  assert.equal(events, 0); assert.equal(answers.length, 2); assert.equal(answers[0]?.statusCode, 409);
  await send('new-panel');
  assert.equal(events, 1);
});

interface ReleaseLog { readonly owners: readonly string[]; readonly released: readonly string[]; readonly events: ReadonlyArray<readonly [string, LogFields]> }

function assertReleased(sidecar: LeaseSidecar, log: ReleaseLog): void {
  assert.equal(JSON.stringify(log.owners), '["new-panel"]');
  assert.equal(JSON.stringify(log.released), '["plan-1"]');
  assert.equal(JSON.stringify(log.events), '[["plan.native-lease-owner-replaced",{"kind":"mutation","logicalOwner":"plan-1"}]]');
  assert.equal(sidecar.activePanelInstanceId, 'new-panel');
}

const pairWith = (sidecar: LeaseSidecar, instance: string) => pairing({ state: sidecar, dispatch: sidecar }, requestFor({ instance }));

test('pairing serializes retained collection quarantine even with no mutation lane', () => {
  const recovery: JsonObject = { state: 'unresolved', accessKind: 'read', operation: 'collection_page', planId: 'ticket-1', code: 'COLLECTION_QUARANTINED' };
  const sidecar = leaseSidecar('t');
  sidecar.nativeBridge.accessQuarantine = () => null;
  sidecar.collection.pair = () => {};
  sidecar.collection.nativeAccessQuarantine = () => recovery;
  sidecar.logPlanEvent = () => {};
  const body = pairWith(sidecar, 'new-panel');
  assert.equal(body.nativeAccessQuarantine, recovery);
  assert.equal(body.nativeMutationQuarantine, recovery);
  assert.equal(sidecar.inFlight, undefined);
});

test('pairing a different panel instance releases its predecessor\'s lease and unknown flight; re-pairing the same instance releases nothing', () => {
  for (const [instance, expectRelease] of [['old-panel', false], ['new-panel', true]] as const) {
    const sidecar = leaseSidecar('t');
    sidecar.activePanelInstanceId = 'old-panel';
    const released: string[] = [], events: Array<[string, LogFields]> = [], owners: string[] = [];
    sidecar.nativeBridge.accessQuarantine = () => null;
    sidecar.nativeBridge.releaseForNewOwner = (owner) => { owners.push(owner); return { released: true, kind: 'mutation', logicalOwner: { kind: 'apply_plan', id: 'plan-1' } }; };
    sidecar.collection.pair = () => {};
    sidecar.collection.nativeAccessQuarantine = () => null;
    sidecar.releaseNativeFlight = (id) => { released.push(id); sidecar.inFlight = undefined; };
    sidecar.inFlight = { kind: 'apply_plan', id: 'plan-1', claimedAt: 1, nativeSettlement: 'unknown' };
    sidecar.logPlanEvent = (type, data) => { events.push([type, data]); };
    pairWith(sidecar, instance);
    if (expectRelease) assertReleased(sidecar, { owners, released, events });
    else { assert.equal(owners.length, 0); assert.equal(released.length, 0); assert.equal(sidecar.inFlight?.nativeSettlement, 'unknown'); }
  }
});

test('late unknown receipt cannot resurrect physical lane after exact bridge settlement', () => {
  const state = makeState(); state.nativeBridge = { activeLogicalMatches: () => false };
  retainNativeMutationLease(state, { planId: 'plan-1', hostError: { code: 'HOST_TIMEOUT' }, mayHaveMutated: true, mutationState: 'unknown' });
  assert.equal(state.inFlight?.nativeSettlement, undefined); state.inFlight = undefined; assert.equal(state.inFlight, undefined);
});
