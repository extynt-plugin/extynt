/** The UI's seam with the host lane: lane events become stream events, and census, capture and variant preview go through the lane. */
import { decodeOrThrow, jsonValue, type JsonValue } from "@extynt/decode";
import type { UiEvent } from "../src/ui-contract.js";
import type { AgentMailboxItem } from "../src/server-types.js";
import assert from "node:assert/strict";
import test from "node:test";
import { makeInventory } from "@extynt/capability-catalogue";
import type { VariantSet } from "@extynt/mcp-server";
import { createFrameStore } from "../src/host/frame-store.js";
import { bindUiHost, thumbsEnabledFor, uiEventSinkFor } from "../src/ui-host.js";
import { uiEventsFor } from "../src/ui-events.js";
import { uiStoreFor } from "../src/ui-store.js";
import { fieldOf, numberOf, readJson, recordOf, recordsOf, textOf } from "./http-json.js";
import { authorization, mutableSnapshot, pause } from "./sidecar-fixture.js";
import { openSse, startUiSidecar, type UiHarness } from "./ui-fixture.js";

type Test = { after: (fn: () => void | Promise<void>) => void };
const PNG = "data:image/png;base64,iVBORw0KGgo=";

async function api(harness: UiHarness, method: string, path: string, body: JsonValue = {}): Promise<{ status: number; json: JsonValue }> {
  const response = await fetch(`http://127.0.0.1:${harness.port}${path}`, { method, headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, json: decodeOrThrow(jsonValue, await readJson(response)) };
}

async function waitForItem(harness: UiHarness, kind: string): Promise<AgentMailboxItem["approvedData"]> {
  for (let waited = 0; waited < 200; waited += 1) {
    const found = harness.sidecar.agentMailbox.find((item) => item.approvedData.kind === kind);
    if (found) return found.approvedData;
    await pause(10);
  }
  throw new Error(`no ${kind} item was queued`);
}

function bound(harness: UiHarness, queueCensus: () => boolean = () => true): ReturnType<typeof createFrameStore> {
  const frames = createFrameStore(uiEventSinkFor(harness.sidecar));
  bindUiHost(harness.sidecar, { frames, queueCensus });
  return frames;
}

test("lane events reach the panel as stream events, and a focus report only re-derives the focus view", async (t: Test) => {
  const harness = await startUiSidecar(t);
  const sink = uiEventSinkFor(harness.sidecar), seen: Array<UiEvent | { type: "poke" }> = [];
  uiEventsFor(harness.sidecar).subscribe((event) => seen.push(event));
  sink.publish({ type: "change", change: { epoch: 1, revision: 4, items: 9, projectName: "P", reasons: ["revision", "selection"] } });
  sink.publish({ type: "thumb", planId: "p1", side: "before" });
  sink.publish({ type: "preview", setId: "s1" });
  sink.publish({ type: "focus", focus: { projectName: "P", projectSaved: true, compositionId: "c", compositionName: "C", selected: 0, selectedLayers: [], time: 0, epoch: 1, revision: 4 } });
  assert.deepEqual(seen, [{ type: "change", seq: 0, reason: "revision,selection" }, { type: "thumbs", planId: "p1" }, { type: "preview", setId: "s1" }, { type: "poke" }]);
});

test("a stream forwards a lane focus change by deriving it, and a preview event by name", async (t: Test) => {
  const harness = await startUiSidecar(t);
  const stream = await openSse(harness.port);
  t.after(() => stream.close());
  await stream.waitFor((frame) => frame.event === "focus");
  uiEventSinkFor(harness.sidecar).publish({ type: "preview", setId: "s1" });
  assert.deepEqual((await stream.waitFor((frame) => frame.event === "preview")).data, { setId: "s1" });
});

test("the thumbnail preference is the stored Before/after frames pref", async (t: Test) => {
  const harness = await startUiSidecar(t);
  const enabled = thumbsEnabledFor(harness.sidecar);
  assert.equal(enabled(), true);
  uiStoreFor(harness.sidecar).patchPrefs({ showThumbnails: false });
  assert.equal(enabled(), false);
});

test("census queues through the lane and answers once a new inventory is recorded; a lane that is offline says so", async (t: Test) => {
  const harness = await startUiSidecar(t);
  bound(harness, () => false);
  const offline = await api(harness, "POST", "/v1/host/census");
  assert.equal(offline.status, 409);
  assert.equal(textOf(offline.json, "error.code"), "HOST_OFFLINE");
  bound(harness, () => true);
  const waiting = api(harness, "POST", "/v1/host/census");
  await pause(20);
  const inventory = makeInventory({ application: "After Effects", version: "26.2.1", buildNumber: "2", platform: "macOS", architecture: "arm64" }, [], false);
  harness.sidecar.inventory = inventory;
  harness.sidecar.notifyChange();
  const done = await waiting;
  assert.equal(done.status, 200);
  assert.deepEqual([fieldOf(done.json, "read"), fieldOf(done.json, "inventory.fingerprint")], [true, inventory.fingerprint]);
});

test("capture queues a capture_frame item for the composition and answers with the frame once the lane completes it", async (t: Test) => {
  const harness = await startUiSidecar(t);
  bound(harness);
  const none = await api(harness, "POST", "/v1/host/capture", { compositionId: "comp-1" });
  assert.equal(none.status, 409, "no read, so no such composition");
  harness.sidecar.latest = { snapshot: mutableSnapshot("probe-1"), receivedAt: "2026-10-04T01:00:00.000Z", bytes: 1 };
  const waiting = api(harness, "POST", "/v1/host/capture", { compositionId: "comp-1" });
  const item = await waitForItem(harness, "capture_frame");
  const command = recordOf(item, "command");
  assert.deepEqual([command.operation, command.compositionId, command.width, command.height, command.format], ["capture_frame", "comp-1", 1920, 1080, "png"]);
  const record = harness.sidecar.captures.get(textOf(command, "captureId"));
  assert.ok(record, "the capture is tracked like an agent's");
  record.status = "completed";
  record.receipt = { captureId: record.captureId, status: "completed", dataUrl: PNG, previewWidth: 800, previewHeight: 450, time: 2 };
  harness.sidecar.notifyChange();
  const done = (await waiting).json;
  assert.deepEqual([textOf(done, "dataUrl"), fieldOf(done, "width"), fieldOf(done, "time")], [PNG, 800, 2]);
});

test("variant preview answers a known result at once, and otherwise queues one preview_controls item", async (t: Test) => {
  const harness = await startUiSidecar(t);
  const frames = bound(harness);
  assert.equal(textOf((await api(harness, "POST", "/v1/variants/nope/preview")).json, "status"), "none", "an unknown set has nothing to picture");
  harness.sidecar.latest = { snapshot: mutableSnapshot("probe-1"), receivedAt: "2026-10-04T01:00:00.000Z", bytes: 1 };
  const set: VariantSet = {
    setId: "s1", status: "open", question: "How strong?", currentValue: 4, snapshotFingerprint: "x", createdAt: "2026-10-04T01:00:00.000Z",
    target: { compositionId: "comp-1", layerId: "layer-1", effectPath: "ADBE Effect Parade/ADBE Gaussian Blur 2", propertyPath: "ADBE Effect Parade/ADBE Gaussian Blur 2/ADBE Gaussian Blur 2-0001", effectMatchName: "ADBE Gaussian Blur 2" },
    names: { composition: "Main", layer: "Original", effect: "Gaussian Blur", control: "Blurriness" },
    candidates: [{ label: "subtler", value: 2, planId: null, current: false }, { label: "stronger", value: 8, planId: null, current: false }],
  };
  harness.sidecar.variants.set("s1", set);
  const waiting = api(harness, "POST", "/v1/variants/s1/preview");
  const item = await waitForItem(harness, "preview_controls");
  const command = recordOf(item, "command");
  assert.deepEqual([item.setId, command.operation, command.compositionId], ["s1", "preview_control_values", "comp-1"]);
  assert.deepEqual(recordsOf(command, "candidates").map((entry) => [textOf(entry, "id"), numberOf(entry, "value")]), [["c0", 2], ["c1", 8]]);
  frames.putPreview("s1", { status: "ready", pictures: { 0: PNG, 1: PNG } });
  harness.sidecar.notifyChange();
  const done = (await waiting).json;
  assert.equal(textOf(done, "status"), "ready");
  assert.equal(textOf(done, "pictures.0"), PNG);
  assert.equal(textOf((await api(harness, "POST", "/v1/variants/s1/preview")).json, "status"), "ready", "a second ask is answered from the store");
});

test("with Before/after frames off, a variant preview asks the host for nothing", async (t: Test) => {
  const harness = await startUiSidecar(t);
  bound(harness);
  uiStoreFor(harness.sidecar).patchPrefs({ showThumbnails: false });
  harness.sidecar.latest = { snapshot: mutableSnapshot("probe-1"), receivedAt: "2026-10-04T01:00:00.000Z", bytes: 1 };
  assert.equal(textOf((await api(harness, "POST", "/v1/variants/s1/preview")).json, "status"), "none");
  assert.equal(harness.sidecar.agentMailbox.length, 0);
});
