/**
 * Apply-plan host contract: frame capture bounds, pending and extension-appended output, and the vector artwork timing readback.
 * The fake host and payload builders live in host-apply-harness.ts.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { loadCaptureAdapters } from "./host-apply-harness.js";
import { requestJson } from "./host-plan-io.js";
import { fieldOf, textAt } from "./json-narrow.js";
import { vectorArtworkTimingMatches } from "./host-vector-timing.js";

const NATIVE_FRAME = { operation: "capture_frame", compositionId: "comp-capture", time: 1, width: 1920, height: 1080, format: "png" } as const;

test("vector artwork timing readback accepts host float rounding but catches a short layer", () => {
  const comp = { duration: 6, frameRate: 29.97002997, layers: [{ inPoint: 0, outPoint: 5.99999999 }] };
  assert.equal(vectorArtworkTimingMatches(comp, 6, 29.97), true);
  assert.equal(vectorArtworkTimingMatches({ ...comp, layers: [{ inPoint: 0, outPoint: 1 / 29.97 }] }, 6, 29.97), false);
  assert.equal(vectorArtworkTimingMatches({ ...comp, layers: [] }, 6, 29.97), false);
  assert.equal(vectorArtworkTimingMatches({ duration: 6, frameRate: 29.97 }, 6, 29.97), null);
});

test("capture enforces native bounds", () => {
  const { capture, discard, saved, removed } = loadCaptureAdapters();
  const base = { ...NATIVE_FRAME, captureId: "capture-1" };
  const nonNative = requestJson(capture, { ...base, width: 1280 });
  assert.equal(fieldOf(nonNative, "ok"), false);
  assert.equal(fieldOf(nonNative, "error", "code"), "NATIVE_SIZE_REQUIRED");
  const outsideDuration = requestJson(capture, { ...base, time: 11 });
  assert.equal(fieldOf(outsideDuration, "ok"), false);
  assert.equal(fieldOf(outsideDuration, "error", "code"), "INVALID_VALUE");
  const captured = requestJson(capture, base);
  assert.equal(fieldOf(captured, "ok"), true);
  assert.deepEqual(saved, [{ time: 1, path: "/user-data/extynt captures/capture-1.png" }]);
  const discarded = requestJson(discard, { operation: "discard_capture_frame", captureId: "capture-1" });
  assert.deepEqual(discarded, { ok: true, operation: "discard_capture_frame", captureId: "capture-1" });
  assert.deepEqual(removed, ["/user-data/extynt captures/capture-1.png"]);
  assert.equal(JSON.stringify(discarded).includes("/user-data"), false);
});

test("native capture answers pending, with both names AE may use, when the PNG is not written yet", () => {
  const { capture } = loadCaptureAdapters(false);
  const result = requestJson(capture, { ...NATIVE_FRAME, captureId: "capture-missing" });
  assert.equal(fieldOf(result, "ok"), true);
  assert.equal(fieldOf(result, "pending"), true);
  assert.equal(fieldOf(result, "fileExists"), false);
  assert.equal(textAt(result, "localPath"), "/user-data/extynt captures/capture-missing.png");
  assert.equal(textAt(result, "alternatePath"), "/user-data/extynt captures/capture-missing.png.png");
});

test("native capture waits briefly for AE to publish its PNG", () => {
  const adapters = loadCaptureAdapters("delayed");
  const result = requestJson(adapters.capture, { ...NATIVE_FRAME, captureId: "capture-delayed" });
  assert.equal(fieldOf(result, "ok"), true);
  assert.equal(fieldOf(result, "extensionAppended"), false);
  assert.equal(textAt(result, "localPath").includes("capture-delayed.png"), true);
  assert.equal(adapters.sleepCalls >= 2, true);
});

test("native capture accepts the bounded extension-appended output and cleanup removes it", () => {
  const { capture, discard, removed } = loadCaptureAdapters("appended");
  const captured = requestJson(capture, { ...NATIVE_FRAME, captureId: "capture-appended" });
  assert.equal(fieldOf(captured, "ok"), true);
  assert.equal(fieldOf(captured, "extensionAppended"), true);
  assert.equal(textAt(captured, "localPath").endsWith("capture-appended.png.png"), true);
  const discarded = requestJson(discard, { operation: "discard_capture_frame", captureId: "capture-appended" });
  assert.equal(fieldOf(discarded, "ok"), true);
  assert.deepEqual(removed, ["/user-data/extynt captures/capture-appended.png.png"]);
});
