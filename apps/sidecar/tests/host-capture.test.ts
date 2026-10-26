/** `capture_frame`: the host saves a PNG, the sidecar reads it from disk through the PNG pipeline and answers the capture request or keeps a thumbnail. */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { jsonOf } from "@extynt/mcp-server";
import { compileCaptureCommand } from "@extynt/host-ae";
import { ok, refuse, toWire } from "@extynt/fake-plugin";
import type { HostCallHandler } from "@extynt/fake-plugin";
import { ACTION_PLAN_SCHEMA } from "@extynt/action-plan";
import type { StoredPlan } from "@extynt/mcp-server";
import { decode, object, string } from "@extynt/decode";
import { enqueueHostWork } from "../src/host/work-queue.js";
import { decodePng } from "../src/capture/png-decode.js";
import { startHostRig, type HostRig } from "./host-rig.js";
import { present } from "./present.js";
import { FIXTURE_PNG, FIXTURE_PNG_BASE64, frameDirectory, solidPng } from "./png-fixture.js";

const frames = frameDirectory();

function savesFrame(bytes: Uint8Array, size: { width: number; height: number }): HostCallHandler {
  return (args) => {
    const captureId = String(args.captureId), localPath = frames.write(`${captureId}.png`, bytes);
    return ok(toWire({ ok: true, operation: "capture_frame", captureId, compositionId: args.compositionId, time: args.time, width: size.width, height: size.height, format: "png", storage: "userData", fileExists: true, localPath, providerShared: false }));
  };
}

interface CaptureExtras { preview?: { maxWidth: number; maxHeight: number }; maxEncodedBytes?: number; background?: [number, number, number] }

function request(rig: HostRig, captureId: string, size: { width: number; height: number }, extra: CaptureExtras = {}) {
  const command = compileCaptureCommand({ compositionId: "5", time: 1, ...size, format: "png", shareWithProvider: false }, captureId);
  assert.ok("operation" in command, "a command the sidecar itself would compile");
  const preview = extra.preview ?? { maxWidth: 1280, maxHeight: 720 }, maxEncodedBytes = extra.maxEncodedBytes ?? 3_000_000;
  rig.sidecar.captures.set(captureId, { captureId, status: "queued", request: command, preview, maxEncodedBytes });
  enqueueHostWork(rig.sidecar, { approvedData: { kind: "capture_frame", command: jsonOf(command), preview, maxEncodedBytes, ...(extra.background ? { background: extra.background } : {}) } });
}

const captureOf = (rig: HostRig, id: string) => present(rig.sidecar.captures.get(id), `capture ${id}`);
const receiptOf = (rig: HostRig, id: string) => present(captureOf(rig, id).receipt, `receipt of ${id}`);
const pngOf = (dataUrl: string) => Buffer.from(present(dataUrl.split(",")[1], "a data URL payload"), "base64");

function errorCodeOf(rig: HostRig, id: string): string | undefined {
  const decoded = decode(object({ error: object({ code: string() }) }), receiptOf(rig, id));
  return decoded.ok ? decoded.value.error.code : undefined;
}

test("a frame already inside the bounds goes out as the PNG the host wrote, with the measured sample", async () => {
  const rig = await startHostRig({ plugin: { hostCalls: { aeCaptureFrame: savesFrame(FIXTURE_PNG, { width: 16, height: 16 }) } } });
  try {
    request(rig, "frame-one", { width: 16, height: 16 });
    assert.deepEqual(await rig.drain(), ["capture_frame"]);
    const capture = captureOf(rig, "frame-one"), receipt = receiptOf(rig, "frame-one");
    assert.equal(capture.status, "completed");
    assert.equal(receipt.dataUrl, `data:image/png;base64,${FIXTURE_PNG_BASE64}`, "no re-encode when nothing needs to change");
    assert.deepEqual([receipt.originalWidth, receipt.originalHeight, receipt.previewWidth, receipt.resized], [16, 16, 16, false]);
    assert.equal(receipt.backgroundFlattened, false, "nothing was flattened, and the receipt says so");
    assert.ok(receipt.summary, "the receipt carries the measurements of the pixels");
    assert.equal(existsSync(`${frames.path}/frame-one.png`), false, "the file is removed once it is read");
    assert.equal(rig.sidecar.inFlight, undefined);
  } finally { await rig.close(); }
});

test("a frame larger than the preview is shrunk by area averaging and flattened over the composition background", async () => {
  const rig = await startHostRig({ plugin: { hostCalls: { aeCaptureFrame: savesFrame(solidPng(64, 36, [200, 100, 50]), { width: 64, height: 36 }) } } });
  try {
    request(rig, "frame-two", { width: 64, height: 36 }, { preview: { maxWidth: 32, maxHeight: 18 }, background: [0, 0, 0] });
    await rig.drain();
    const receipt = receiptOf(rig, "frame-two");
    assert.deepEqual([receipt.previewWidth, receipt.previewHeight, receipt.resized], [32, 18, true]);
    const decoded = decodePng(pngOf(String(receipt.dataUrl)));
    assert.ok(decoded.ok && decoded.image.width === 32);
    assert.deepEqual(decoded.ok ? [...decoded.image.rgba.subarray(0, 4)] : [], [200, 100, 50, 255], "solid colour survives the average");
  } finally { await rig.close(); }
});

test("a transparent frame is flattened over the background the composition reports", async () => {
  const rig = await startHostRig({ plugin: { hostCalls: { aeCaptureFrame: savesFrame(FIXTURE_PNG, { width: 16, height: 16 }) } } });
  try {
    request(rig, "frame-flat", { width: 16, height: 16 }, { background: [0, 1, 0] });
    await rig.drain();
    const receipt = receiptOf(rig, "frame-flat"), decoded = decodePng(pngOf(String(receipt.dataUrl)));
    assert.equal(receipt.resized, false, "flattened at the same size is not resized");
    assert.equal(receipt.backgroundFlattened, true, "the receipt reports the flattening the sidecar did");
    assert.ok(decoded.ok);
    const at = (x: number) => (decoded.ok ? [...decoded.image.rgba.subarray(x * 4, x * 4 + 4)] : []);
    assert.deepEqual([at(0), at(15)], [[220, 30, 30, 255], [0, 255, 0, 255]], "red where the frame is opaque, green where it was transparent");
  } finally { await rig.close(); }
});

test("a derivative over the response budget fails the capture and says so", async () => {
  const rig = await startHostRig({ plugin: { hostCalls: { aeCaptureFrame: savesFrame(FIXTURE_PNG, { width: 16, height: 16 }) } } });
  try {
    request(rig, "frame-big", { width: 16, height: 16 }, { maxEncodedBytes: 40 });
    await rig.drain();
    assert.equal(captureOf(rig, "frame-big").status, "failed");
    assert.equal(errorCodeOf(rig, "frame-big"), "CAPTURE_TOO_LARGE");
  } finally { await rig.close(); }
});

test("a file that never becomes a complete PNG fails as incomplete, and a host that refuses fails with its own code", async () => {
  const truncated = FIXTURE_PNG.subarray(0, 40);
  const rig = await startHostRig({ plugin: { hostCalls: { aeCaptureFrame: savesFrame(truncated, { width: 16, height: 16 }) } } });
  try {
    request(rig, "frame-cut", { width: 16, height: 16 });
    await rig.drain();
    assert.equal(errorCodeOf(rig, "frame-cut"), "CAPTURE_INCOMPLETE");
    rig.plugin.hostCalls.set("aeCaptureFrame", () => refuse("HOST_ERROR", "no frame"));
    request(rig, "frame-err", { width: 16, height: 16 });
    await rig.drain();
    assert.equal(captureOf(rig, "frame-err").status, "failed");
    assert.equal(rig.sidecar.inFlight, undefined);
  } finally { await rig.close(); }
});

test("a frame AE 25 has started but not finished writing is waited for until it is a complete PNG", async () => {
  const rig = await startHostRig({ plugin: { hostCalls: { aeCaptureFrame: (args) => {
    const captureId = String(args.captureId), localPath = frames.write(`${captureId}.png`, FIXTURE_PNG.subarray(0, 40));
    setTimeout(() => { frames.write(`${captureId}.png`, FIXTURE_PNG); }, 700);
    return ok(toWire({ ok: true, operation: "capture_frame", captureId, compositionId: args.compositionId, time: args.time, width: 16, height: 16, format: "png", storage: "userData", fileExists: true, localPath, providerShared: false }));
  } } } });
  try {
    request(rig, "frame-slow", { width: 16, height: 16 });
    await rig.drain();
    assert.equal(captureOf(rig, "frame-slow").status, "completed");
    assert.equal(receiptOf(rig, "frame-slow").dataUrl, `data:image/png;base64,${FIXTURE_PNG_BASE64}`);
    assert.equal(existsSync(`${frames.path}/frame-slow.png`), false, "the finished file is removed once it is read");
  } finally { await rig.close(); }
});

test("a frame AE writes after the call returns is waited for at either name, then read and removed", async () => {
  const rig = await startHostRig({ plugin: { hostCalls: { aeCaptureFrame: (args) => {
    const captureId = String(args.captureId), localPath = `${frames.path}/${captureId}.png`;
    setTimeout(() => { frames.write(`${captureId}.png.png`, FIXTURE_PNG); }, 400);
    return ok(toWire({ ok: true, operation: "capture_frame", captureId, compositionId: args.compositionId, time: args.time, width: 16, height: 16, format: "png", storage: "userData", fileExists: false, pending: true, localPath, alternatePath: `${localPath}.png`, providerShared: false }));
  } } } });
  try {
    request(rig, "frame-late", { width: 16, height: 16 });
    await rig.drain();
    assert.equal(captureOf(rig, "frame-late").status, "completed");
    assert.equal(receiptOf(rig, "frame-late").dataUrl, `data:image/png;base64,${FIXTURE_PNG_BASE64}`);
    assert.equal(existsSync(`${frames.path}/frame-late.png.png`), false, "the late file is removed once it is read");
  } finally { await rig.close(); }
});

test("a host answer that says it failed is a failed capture with the host's code", async () => {
  const rig = await startHostRig({ plugin: { hostCalls: { aeCaptureFrame: () => ok({ ok: false, error: { code: "COMP_NOT_FOUND", message: "no such composition" } }) } } });
  try {
    request(rig, "frame-nocomp", { width: 16, height: 16 });
    await rig.drain();
    assert.equal(errorCodeOf(rig, "frame-nocomp"), "COMP_NOT_FOUND");
  } finally { await rig.close(); }
});

const visualPlan = [{ type: "set_layer_property", compositionId: "5", layerId: "11", property: "opacity", value: 50 }];

async function withProject(rig: HostRig): Promise<void> {
  rig.pair(); await rig.settle(); rig.timers.fire(); await rig.drain();
}

test("a plan's after thumbnail waits for an idle lane and is a 240 px PNG in the frame store", async () => {
  const rig = await startHostRig({ plugin: { hostCalls: { aeCaptureFrame: savesFrame(solidPng(480, 270), { width: 480, height: 270 }) } } });
  try {
    await withProject(rig);
    rig.ui.length = 0;
    assert.equal(rig.readers.thumbs.queue({ planId: "plan-1", side: "after", operations: visualPlan }), true);
    enqueueHostWork(rig.sidecar, { approvedData: { kind: "host_census" } });
    assert.equal(rig.readers.claimBackground(rig.context.now()), undefined, "never while other work waits");
    assert.deepEqual(await rig.drain(), ["host_census", "capture_frame"], "the thumbnail goes last");
    const thumb = rig.readers.frames.thumbsFor("plan-1")?.after;
    assert.deepEqual([thumb?.width, thumb?.height], [240, 135]);
    const decoded = decodePng(pngOf(present(thumb).dataUrl));
    assert.ok(decoded.ok && decoded.image.width === 240);
    assert.deepEqual(rig.ui.filter((event) => event.type === "thumb"), [{ type: "thumb", planId: "plan-1", side: "after" }]);
  } finally { await rig.close(); }
});

test("an ahead thumbnail goes to the front of the queue, and thumbnails off, or for a plan no frame could show, queue nothing", async () => {
  let enabled = true;
  const rig = await startHostRig({ thumbsEnabled: () => enabled, plugin: { hostCalls: { aeCaptureFrame: savesFrame(solidPng(480, 270), { width: 480, height: 270 }) } } });
  try {
    await withProject(rig);
    enqueueHostWork(rig.sidecar, { approvedData: { kind: "host_census" } });
    assert.equal(rig.readers.thumbs.queue({ planId: "plan-2", side: "before", operations: visualPlan, urgency: "ahead" }), true);
    assert.equal(present(rig.sidecar.agentMailbox[0]).approvedData.kind, "capture_frame");
    assert.equal(rig.readers.thumbs.queue({ planId: "plan-3", side: "after", operations: [{ type: "set_layer_name", compositionId: "5", layerId: "11", name: "x" }] }), false, "a rename shows nothing a frame could show");
    enabled = false;
    assert.equal(rig.readers.thumbs.queue({ planId: "plan-4", side: "after", operations: visualPlan }), false);
    await rig.drain();
    assert.ok(rig.readers.frames.thumbsFor("plan-2")?.before);
  } finally { await rig.close(); }
});

test("capturePlan looks the stored plan up by id, and asks for nothing for a plan the sidecar does not hold", async () => {
  const rig = await startHostRig({ plugin: { hostCalls: { aeCaptureFrame: savesFrame(solidPng(480, 270), { width: 480, height: 270 }) } } });
  try {
    await withProject(rig);
    assert.equal(rig.readers.capturePlan("no-such-plan", "after"), false);
  } finally { await rig.close(); }
});

function storedVisualPlan(planId: string, status: StoredPlan["status"]): StoredPlan {
  const at = "2026-10-05T10:00:00.000Z";
  return { plan: { schemaVersion: ACTION_PLAN_SCHEMA, planId, summary: "Fade", snapshotFingerprint: "fp", operations: [{ type: "set_layer_property", target: { compositionId: "5", layerId: "11", snapshotFingerprint: "fp", selectionFingerprint: "sel" }, role: "transform.opacity", propertyPath: "ADBE Transform Group/ADBE Opacity", value: 50 }], requiresApproval: true }, status, createdAt: at, updatedAt: at };
}

test("an idle before is replaced by one ahead of the apply, never taken once its plan is approved, and not taken twice", async () => {
  const rig = await startHostRig({ plugin: { hostCalls: { aeCaptureFrame: savesFrame(solidPng(480, 270), { width: 480, height: 270 }) } } });
  try {
    await withProject(rig);
    rig.sidecar.plans.set("p1", storedVisualPlan("p1", "prepared"));
    rig.sidecar.plans.set("p2", storedVisualPlan("p2", "prepared"));
    assert.equal(rig.readers.capturePlan("p1", "before", "idle"), true);
    assert.equal(rig.readers.capturePlan("p2", "before", "idle"), true);
    present(rig.sidecar.plans.get("p2")).status = "approved";
    assert.equal(rig.readers.capturePlan("p1", "before", "ahead"), true);
    assert.equal(rig.sidecar.agentMailbox.length, 1, "the ahead capture is the only one in the mailbox");
    assert.deepEqual(await rig.drain(), ["capture_frame"], "p1's before runs once; p2's idle before is gone with its approval; p1's idle one was dropped");
    assert.ok(rig.readers.frames.thumbsFor("p1")?.before);
    assert.equal(rig.readers.frames.thumbsFor("p2"), undefined);
    assert.equal(rig.readers.capturePlan("p1", "before", "ahead"), true);
    assert.equal(rig.sidecar.agentMailbox.length, 0, "a before that exists is not taken again");
  } finally { await rig.close(); }
});
