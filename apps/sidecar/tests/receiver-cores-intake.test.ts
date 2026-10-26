/** The snapshot, census and receipt receivers called directly, with no HTTP server and no request in sight. */
import assert from "node:assert/strict";
import test from "node:test";
import { jsonOf } from "@extynt/mcp-server";
import { decode, object } from "@extynt/decode";
import { opaque } from "../src/snapshot-view.js";
import { hostCensus, mutableSnapshot, sidecarFor, token, validSnapshot } from "./sidecar-fixture.js";

const fresh = () => sidecarFor({ port: 0, token, quietAgentLog: true });
const latestId = (sidecar: ReturnType<typeof fresh>) => sidecar.latest?.snapshot.requestId;
const inventoryCount = (sidecar: ReturnType<typeof fresh>) => sidecar.inventory?.items.length;

test("acceptSnapshot stores a probe read and answers its fingerprints, counting the post", async () => {
  const sidecar = fresh();
  const outcome = await sidecar.receivers.acceptSnapshot(jsonOf(mutableSnapshot("probe-core-1")), { bytes: 321 });
  assert.equal(outcome.status, 201);
  assert.equal(outcome.outcome, "succeeded");
  assert.equal(outcome.body.requestId, "probe-core-1");
  assert.equal(outcome.body.bytes, 321);
  assert.equal(typeof outcome.body.fingerprint, "string");
  assert.equal(latestId(sidecar), "probe-core-1");
  assert.equal(sidecar.snapshotPostCount, 1);
});

test("acceptSnapshot refuses what is not a probe snapshot and a read already replaced by a newer one", async () => {
  const sidecar = fresh();
  const invalid = await sidecar.receivers.acceptSnapshot({ ok: true }, { bytes: 10 });
  assert.deepEqual([invalid.status, invalid.outcome, invalid.errorCode], [422, "rejected", "INVALID_SNAPSHOT"]);
  assert.equal(sidecar.latest, undefined);
  await sidecar.receivers.acceptSnapshot(jsonOf(mutableSnapshot("probe-old")), { bytes: 10 });
  await sidecar.receivers.acceptSnapshot(jsonOf(mutableSnapshot("probe-new")), { bytes: 10 });
  const stale = await sidecar.receivers.acceptSnapshot(jsonOf(mutableSnapshot("probe-old")), { bytes: 10 });
  assert.deepEqual([stale.status, stale.errorCode], [409, "SUPERSEDED_SNAPSHOT"]);
  assert.equal(latestId(sidecar), "probe-new");
});

test("acceptSnapshot answers the sidecar's verdict when the read is the precheck of a plan it does not hold", async () => {
  const sidecar = fresh();
  const outcome = await sidecar.receivers.acceptSnapshot(jsonOf(mutableSnapshot("probe-precheck")), { bytes: 10, purpose: "precheck", planId: "plan-gone" });
  assert.equal(outcome.status, 201);
  assert.deepEqual(outcome.body.admission, { ok: false, code: "PLAN_UNKNOWN", text: "The sidecar no longer holds this plan, so nothing was run. Propose the plan again." });
  const plain = await sidecar.receivers.acceptSnapshot(jsonOf(mutableSnapshot("probe-plain")), { bytes: 10 });
  assert.equal("admission" in plain.body, false);
});

test("acceptHostCensus records the inventory and profile, and refuses a body that is not a census", async () => {
  const sidecar = fresh();
  const refused = await sidecar.receivers.acceptHostCensus(jsonOf(validSnapshot), 10);
  assert.deepEqual([refused.status, refused.errorCode], [422, "INVALID_HOST_CENSUS"]);
  assert.equal(sidecar.inventory, undefined);
  const outcome = await sidecar.receivers.acceptHostCensus(jsonOf(hostCensus(3)), 99);
  assert.equal(outcome.status, 201);
  assert.equal(outcome.body.requestId, "census-1");
  assert.equal(outcome.body.bytes, 99);
  assert.equal(typeof outcome.body.profileId, "string");
  assert.equal(inventoryCount(sidecar), 3);
});

test("acceptReceipt refuses a body without a plan and status, and a status outside the execution vocabulary", async () => {
  const sidecar = fresh();
  const malformed = await sidecar.receivers.acceptReceipt({ planId: 7 });
  assert.deepEqual([malformed.status, malformed.errorCode], [422, "INVALID_RECEIPT"]);
  const vocabulary = await sidecar.receivers.acceptReceipt({ planId: "plan-1", status: "executed", postcondition: "made-up" });
  assert.deepEqual([vocabulary.status, vocabulary.errorCode], [409, "INVALID_RECEIPT_OUTCOME"]);
  const contradictory = await sidecar.receivers.acceptReceipt({ planId: "plan-1", status: "executed", postcondition: "not_run" });
  assert.deepEqual([contradictory.status, contradictory.errorCode], [409, "CONTRADICTORY_RECEIPT"]);
  assert.equal(sidecar.receipts.length, 0);
});

test("acceptReceipt settles a receipt that claims no work and keeps it for the status surface", async () => {
  const sidecar = fresh();
  const outcome = await sidecar.receivers.acceptReceipt({ planId: "plan-1", operation: "apply_plan", status: "rejected", postcondition: "not_run", mayHaveMutated: false });
  assert.equal(outcome.status, 201);
  assert.equal(outcome.outcome, "succeeded");
  assert.equal(sidecar.receipts.length, 1);
  assert.equal(sidecar.receipts[0]?.planId, "plan-1");
});

test("acceptReceipt routes an undo receipt for a plan the sidecar never applied to the undo path", async () => {
  const sidecar = fresh();
  const outcome = await sidecar.receivers.acceptReceipt({ planId: "plan-1", operation: "undo_plan", status: "executed", times: 1 }, "native:1:1");
  assert.equal(outcome.status, 201);
  const stored = decode(object({ receipt: object({ operation: opaque }) }), outcome.body);
  assert.equal(stored.ok ? stored.value.receipt.operation : undefined, "undo_plan");
});
