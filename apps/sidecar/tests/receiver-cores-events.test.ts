/** The pipeline, panel-event, capture and focus receivers called directly, with no HTTP server and no request in sight. */
import { compileCaptureCommand } from "@extynt/host-ae";
import assert from "node:assert/strict";
import test from "node:test";
import { jsonOf } from "@extynt/mcp-server";
import { decode, object } from "@extynt/decode";
import { opaque } from "../src/snapshot-view.js";
import { matchingFocus, mutableSnapshot, sidecarFor, token } from "./sidecar-fixture.js";

const fresh = () => sidecarFor({ port: 0, token, quietAgentLog: true });

test("beginApply refuses a claim that names no plan, and a plan the sidecar does not hold", async () => {
  const sidecar = fresh();
  const nameless = await sidecar.receivers.beginApply("");
  assert.deepEqual([nameless.status, nameless.outcome, nameless.errorCode], [409, "rejected", "WORKFLOW_APPLY_REFUSED"]);
  const unknown = await sidecar.receivers.beginApply("plan-gone extra detail");
  assert.deepEqual([unknown.status, unknown.errorCode], [409, "WORKFLOW_APPLY_REFUSED"]);
  const refusal = decode(object({ error: object({ message: opaque }) }), unknown.body);
  assert.match(String(refusal.ok ? refusal.value.error.message : undefined), /no approved plan/);
  assert.equal(sidecar.inFlight, undefined);
});

test("acceptPipelineEvent answers a named event, refuses one without a lowercase name, and routes apply-begin to the admission", async () => {
  const sidecar = fresh();
  const noted = await sidecar.receivers.acceptPipelineEvent({ event: "read-started", detail: "scope full" });
  assert.deepEqual([noted.status, noted.outcome, noted.body], [200, "succeeded", { ok: true }]);
  const nameless = await sidecar.receivers.acceptPipelineEvent({ detail: "x" });
  assert.deepEqual([nameless.status, nameless.errorCode], [422, "INVALID_PIPELINE_EVENT"]);
  const shouting = await sidecar.receivers.acceptPipelineEvent({ event: "Apply Begin" });
  assert.equal(shouting.errorCode, "INVALID_PIPELINE_EVENT");
  const begin = await sidecar.receivers.acceptPipelineEvent({ event: "apply-begin", detail: "plan-gone" });
  assert.deepEqual([begin.status, begin.errorCode], [409, "WORKFLOW_APPLY_REFUSED"]);
});

test("acceptPanelEvent records a host failure for the status surface and wakes waiters", async () => {
  const sidecar = fresh();
  const outcome = await sidecar.receivers.acceptPanelEvent({ code: "HOST_BUSY", message: "After Effects is busy" });
  assert.deepEqual([outcome.status, outcome.body], [201, { ok: true }]);
  assert.equal(sidecar.panel.lastError?.code, "HOST_BUSY");
  const refused = await sidecar.receivers.acceptPanelEvent({ message: "no code" });
  assert.deepEqual([refused.status, refused.errorCode], [422, "INVALID_PANEL_EVENT"]);
});

test("acceptPanelEvent ignores a native-unresolved report that names no active reservation", async () => {
  const sidecar = fresh();
  await sidecar.receivers.acceptSnapshot(jsonOf(mutableSnapshot("probe-keep")), { bytes: 10 });
  const outcome = await sidecar.receivers.acceptPanelEvent({ code: "HOST_NATIVE_UNRESOLVED", message: "unknown", nativeLease: { requestId: "never-reserved" } });
  assert.deepEqual([outcome.status, outcome.body], [201, { ok: true, ignored: true }]);
  assert.equal(sidecar.latest?.snapshot.requestId, "probe-keep");
  assert.equal(sidecar.panel.lastError, null);
});

function queueCapture(sidecar: ReturnType<typeof fresh>, captureId: string): void {
  const request = compileCaptureCommand({ compositionId: "comp-1", time: 1, width: 64, height: 64, format: "png", quality: 80, shareWithProvider: false }, captureId);
  if (!("operation" in request)) throw new Error(`the fixture capture request was refused: ${request.message}`);
  sidecar.captures.set(captureId, { captureId, status: "queued", request, preview: { maxWidth: 64, maxHeight: 64 }, maxEncodedBytes: 4096 });
}

test("acceptCapture refuses a receipt for a capture the sidecar never requested", async () => {
  const outcome = await fresh().receivers.acceptCapture({ captureId: "frame-unknown", ok: true });
  assert.deepEqual([outcome.status, outcome.outcome, outcome.errorCode], [422, "rejected", "CAPTURE_NOT_FOUND"]);
  const empty = await fresh().receivers.acceptCapture(null);
  assert.equal(empty.errorCode, "CAPTURE_NOT_FOUND");
});

test("acceptCapture fails the capture a host reports it could not take, and clears its flight", async () => {
  const sidecar = fresh();
  queueCapture(sidecar, "frame-core-1");
  sidecar.inFlight = { kind: "capture_frame", id: "frame-core-1", claimedAt: 1 };
  const outcome = await sidecar.receivers.acceptCapture({ captureId: "frame-core-1", ok: false, error: { code: "CAPTURE_FAILED", message: "no frame" } });
  assert.deepEqual([outcome.status, outcome.body], [200, { ok: true, captureId: "frame-core-1", status: "failed" }]);
  assert.equal(sidecar.captures.get("frame-core-1")?.status, "failed");
  assert.equal(sidecar.inFlight, undefined);
});

test("acceptFocus stores the live focus and answers the selection fingerprint and view over it", async () => {
  const sidecar = fresh();
  await sidecar.receivers.acceptSnapshot(jsonOf(mutableSnapshot("probe-focus")), { bytes: 10 });
  const outcome = await sidecar.receivers.acceptFocus(matchingFocus());
  assert.equal(outcome.status, 200);
  assert.equal(outcome.body.ok, true);
  assert.equal(typeof outcome.body.selectionFingerprint, "string");
  assert.equal(sidecar.liveFocus?.activeCompositionId, "comp-1");
});

test("acceptFocus refuses a report that is not a focus and stores nothing", async () => {
  const sidecar = fresh();
  const outcome = await sidecar.receivers.acceptFocus({ schemaVersion: "0.1" });
  assert.equal(outcome.status, 422);
  assert.equal(outcome.outcome, "rejected");
  assert.equal(typeof outcome.errorCode, "string");
  assert.ok(!sidecar.liveFocus);
});
