/** The collection, catalogue and native-bridge receivers called directly, speaking for the active host rather than for a request header. */
import assert from "node:assert/strict";
import test from "node:test";
import { jsonOf } from "@extynt/mcp-server";
import { decode, object, optional, refine } from "@extynt/decode";
import { isRow, opaque, type Opaque } from "../src/snapshot-view.js";
import { hostCensus, sidecarFor, token } from "./sidecar-fixture.js";

const fresh = () => sidecarFor({ port: 0, token, quietAgentLog: true });
const paired = () => { const sidecar = fresh(); sidecar.activePanelInstanceId = "native:42:1"; return sidecar; };
const row = refine(opaque, isRow, "object");
const errorBody = object({ error: optional(object({ code: optional(opaque) })) });
const leaseBody = object({ lease: optional(row) });

function errorCodeOf(body: Record<string, Opaque>): Opaque {
  const decoded = decode(errorBody, body);
  return decoded.ok ? decoded.value.error?.code : undefined;
}

test("collection refuses a call when no host is paired, and settles a cancel for the paired one", async () => {
  const lonely = await fresh().receivers.collection("cancel", {});
  assert.deepEqual([lonely.status, lonely.outcome, errorCodeOf(lonely.body)], [409, "rejected", "STALE_PANEL_INSTANCE"]);
  const outcome = await paired().receivers.collection("cancel", {});
  assert.deepEqual([outcome.status, outcome.outcome, outcome.body], [200, "succeeded", { ok: true }]);
});

test("collection answers a dispatch for a ticket it never issued with the bounded code and wakes waiters", async () => {
  const sidecar = paired();
  let woken = 0;
  sidecar.changeWaiters.add(() => { woken += 1; });
  const outcome = await sidecar.receivers.collection("dispatch", { ticket: "ticket-unknown" });
  assert.deepEqual([outcome.status, outcome.outcome, errorCodeOf(outcome.body), outcome.errorCode], [409, "rejected", "STALE_COLLECTION_TICKET", undefined]);
  assert.equal(woken, 1);
  const malformed = await sidecar.receivers.collection("prepare", "not an object");
  assert.deepEqual([malformed.status, errorCodeOf(malformed.body)], [409, "INVALID_COLLECTION_REQUEST"]);
});

test("catalogue start waits for a host census, then starts and answers its progress", async () => {
  const sidecar = fresh();
  const early = await sidecar.receivers.catalogue("start", {});
  assert.deepEqual([early.status, errorCodeOf(early.body)], [409, "NO_CENSUS"]);
  await sidecar.receivers.acceptHostCensus(jsonOf(hostCensus(2)), 10);
  const started = await sidecar.receivers.catalogue("start", {});
  assert.equal(started.status, 200);
  assert.equal(started.body.ok, true);
  assert.equal(typeof started.body.progress, "object");
});

test("catalogue complete refuses a page without a ticket and records nothing", async () => {
  const outcome = await fresh().receivers.catalogue("complete", { page: {} });
  assert.deepEqual([outcome.status, outcome.outcome, errorCodeOf(outcome.body)], [409, "rejected", "INVALID_CATALOGUE_COMPLETION"]);
});

test("nativeBridge reserves and settles a read lease for the paired host", async () => {
  const sidecar = paired();
  const reserved = await sidecar.receivers.nativeBridge("reserve", { requestId: "read-1", kind: "read" });
  assert.equal(reserved.status, 200);
  const reservedBody = decode(leaseBody, reserved.body), lease = reservedBody.ok ? reservedBody.value.lease : undefined;
  assert.equal(lease?.owner, "native:42:1");
  assert.equal(lease?.requestId, "read-1");
  const settled = await sidecar.receivers.nativeBridge("settle", { lease, outcome: "callback-received" });
  assert.deepEqual([settled.status, settled.body.settled], [200, true]);
});

test("nativeBridge refuses a reservation with no paired host, or one that is not exactly a request id and kind", async () => {
  const lonely = await fresh().receivers.nativeBridge("reserve", { requestId: "read-1", kind: "read" });
  assert.deepEqual([lonely.status, lonely.outcome, errorCodeOf(lonely.body), lonely.body.nativeAdmission], [409, "rejected", "STALE_PANEL_INSTANCE", "refused"]);
  const malformed = await paired().receivers.nativeBridge("reserve", { requestId: "read-1", kind: "read", extra: true });
  assert.deepEqual([malformed.status, errorCodeOf(malformed.body), malformed.body.nativeAdmission], [409, "NATIVE_BRIDGE_INVALID_REQUEST", "refused"]);
  const settling = await paired().receivers.nativeBridge("settle", { outcome: "callback-received" });
  assert.equal(errorCodeOf(settling.body), "NATIVE_BRIDGE_INVALID_REQUEST");
  assert.equal("nativeAdmission" in settling.body, false);
});
