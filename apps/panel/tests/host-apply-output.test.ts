/**
 * Apply-plan host contract: render output settings, Send to Media Encoder and project cleanup.
 */
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { loadApplyPlan, loadExtended } from "./host-apply-harness.js";
import { type PlanApply, applyPlan, assertApplied } from "./host-plan-io.js";
import { type Found, fieldOf, recordsAt } from "./json-narrow.js";
import type { JsonObject, JsonValue } from "@extynt/decode";

const RENDER: JsonObject = { operation: "render_composition", compositionId: "comp-main", outputPath: "/renders/title.mov", destinationPolicy: "explicit-local-path" };
const HOME = "/Users/me";
const HOME_ONLY = /only folders under the home folder are created/;
const AUDIO_FIELDS = ["audio.output", "audio.sampleRate", "audio.bitDepth", "audio.channels"];
const BAD_OUTPUT_SETTINGS: ReadonlyArray<JsonValue> = [{ nonsense: 1 }, { channels: "CMYK" }, { resize: { width: 1280 } }, {}, { crop: { top: -1 } }];

interface FolderLike {
  readonly fsName: string;
  readonly exists: boolean;
  readonly parent: FolderLike | null;
  create(): boolean;
}

function renderPlan(apply: PlanApply, planId: string, extra: JsonObject): JsonObject {
  return applyPlan(apply, planId, [{ ...RENDER, ...extra }]);
}

function reportValue(result: JsonObject, field: string, key: string): Found {
  const entry = recordsAt(result, "steps", 0, "settings").find((candidate) => fieldOf(candidate, "field") === field);
  return fieldOf(entry, key);
}

function errorCode(result: JsonObject): Found {
  return fieldOf(result, "error", "code");
}

test("output and render settings are written one field at a time and read back per field", () => {
  const { apply } = loadApplyPlan();
  const outputSettings = { format: "QuickTime", resize: { width: 1280, height: 720, quality: "High" }, audio: { output: "Off", sampleRate: 48000, bitDepth: 16, channels: "Stereo" } };
  const result = renderPlan(apply, "settings-ok", { outputSettings, renderSettings: { quality: "Draft", resolution: "Half" } });
  assert.equal(fieldOf(result, "ok"), true);
  assert.equal(fieldOf(result, "steps", 0, "status"), "queued");
  assert.equal(reportValue(result, "resize.width", "observed"), 1280);
  assert.equal(reportValue(result, "resize.width", "key"), "Resize to");
  assert.equal(reportValue(result, "resize.quality", "key"), "Resize Quality");
  assert.equal(reportValue(result, "resize", "status"), "applied");
  assert.equal(reportValue(result, "quality", "status"), "applied");
  assert.equal(reportValue(result, "outputPath", "status"), "applied");
  assert.deepEqual(fieldOf(result, "steps", 0, "refusedSettings"), []);
});

test("audio values are written as After Effects spells them and read back tolerantly", () => {
  const { apply } = loadApplyPlan();
  const result = renderPlan(apply, "audio-real", { outputSettings: { audio: { output: "Off", sampleRate: 48000, bitDepth: 16, channels: "Stereo" } } });
  for (const field of AUDIO_FIELDS) {
    assert.equal(reportValue(result, field, "status"), "applied", field);
  }
  assert.equal(reportValue(result, "audio.sampleRate", "observed"), "48.000 kHz");
  assert.equal(reportValue(result, "audio.bitDepth", "observed"), "16 Bit");
});

test("a setting After Effects refuses is reported by field and a queue-only plan still queues", () => {
  const { apply, output } = loadApplyPlan();
  output.refuseKeys.add("Video Codec");
  const result = renderPlan(apply, "settings-refused", { outputSettings: { format: "QuickTime", videoCodec: "Apple ProRes 4444" } });
  assert.equal(fieldOf(result, "ok"), true);
  assert.deepEqual(fieldOf(result, "steps", 0, "refusedSettings"), ["videoCodec"]);
  assert.equal(reportValue(result, "videoCodec", "status"), "refused");
  assert.equal(reportValue(result, "format", "status"), "applied");
});

test("a value After Effects snaps is reported as adjusted and a key it never reports back as refused", () => {
  const { apply, output } = loadApplyPlan();
  output.adjust.set("Audio Sample Rate", "44.100 kHz");
  output.hideKeys.add("Depth");
  const result = renderPlan(apply, "settings-adjusted", { outputSettings: { audio: { sampleRate: 48000 }, depth: "Millions of Colors" } });
  assert.equal(reportValue(result, "audio.sampleRate", "status"), "adjusted");
  assert.deepEqual(fieldOf(result, "steps", 0, "adjustedSettings"), ["audio.sampleRate"]);
  assert.equal(reportValue(result, "depth", "status"), "refused");
});

test("resize unlocks the aspect ratio, enables Resize and writes Resize to as one size", () => {
  const { apply } = loadApplyPlan();
  const result = renderPlan(apply, "resize-pair", { outputSettings: { resize: { width: 320, height: 180, quality: "High" } } });
  assert.equal(reportValue(result, "resize", "status"), "applied");
  assert.equal(reportValue(result, "resize.width", "status"), "applied");
  assert.equal(reportValue(result, "resize.height", "observed"), 180);
  assert.deepEqual(fieldOf(result, "steps", 0, "refusedSettings"), []);
});

test("a key this After Effects does not have is refused as Invalid Key, and Channels as read-only", () => {
  const { apply } = loadApplyPlan();
  const result = renderPlan(apply, "settings-real-keys", { outputSettings: { channels: "RGB + Alpha", format: "H.264" } });
  assert.equal(fieldOf(result, "ok"), true);
  assert.deepEqual(fieldOf(result, "steps", 0, "refusedSettings"), ["channels"]);
  assert.match(String(reportValue(result, "channels", "detail")), /read-only/);
});

test("a refused or unreported key says which, and names what the output module does report", () => {
  const { apply, output } = loadApplyPlan();
  output.hideKeys.add("Depth");
  const result = renderPlan(apply, "settings-detail", { outputSettings: { channels: "RGB + Alpha", depth: "Millions of Colors" } });
  assert.match(String(reportValue(result, "channels", "detail")), /^Refused by After Effects for this format: /);
  assert.match(String(reportValue(result, "depth", "detail")), /it reports: .*Format/);
});

test("refused settings stop an execute before anything renders", () => {
  const { apply, render } = loadApplyPlan();
  const result = renderPlan(apply, "settings-stop", { outputSettings: { channels: "Alpha" }, executeAuthorization: "RENDER_NOW" });
  assert.equal(fieldOf(result, "ok"), false);
  assert.match(String(errorCode(result)), /RENDER_SETTINGS_REFUSED/);
  assert.equal(render.calls, 0);
});

test("settings objects with unknown fields, bad values or an incomplete resize are rejected", () => {
  const { apply } = loadApplyPlan();
  for (const outputSettings of BAD_OUTPUT_SETTINGS) {
    const result = renderPlan(apply, "settings-bad", { outputSettings });
    assert.equal(fieldOf(result, "ok"), false);
    assert.equal(errorCode(result), "INVALID_VALUE");
  }
  const renderBad = renderPlan(apply, "settings-bad-render", { renderSettings: { quality: "Ultra" } });
  assert.equal(errorCode(renderBad), "INVALID_VALUE");
});

test("Send to Media Encoder isolates the item, never renders locally and names a missing encoder", () => {
  const { apply, output, render } = loadApplyPlan();
  const sent = renderPlan(apply, "ame-ok", { mediaEncoder: "start" });
  assert.equal(fieldOf(sent, "ok"), true);
  assert.equal(fieldOf(sent, "steps", 0, "status"), "sent-to-media-encoder");
  assert.equal(fieldOf(sent, "steps", 0, "verification"), "render-sent-to-media-encoder");
  assert.equal(output.ameCalls.length, 1);
  assert.equal(output.ameCalls[0]?.start, true);
  assert.equal(render.calls, 0);
  output.ame = "missing";
  const missing = renderPlan(apply, "ame-missing", { mediaEncoder: "queue" });
  assert.equal(fieldOf(missing, "ok"), false);
  assert.match(String(errorCode(missing)), /MEDIA_ENCODER_NOT_INSTALLED/);
  output.ame = "fails";
  const failed = renderPlan(apply, "ame-fails", { mediaEncoder: "queue" });
  assert.match(String(errorCode(failed)), /MEDIA_ENCODER_FAILED/);
});

test("Send to Media Encoder cannot be combined with a local render and needs queueInAME", () => {
  const { apply, context } = loadApplyPlan();
  const both = renderPlan(apply, "ame-both", { mediaEncoder: "queue", executeAuthorization: "RENDER_NOW" });
  assert.equal(errorCode(both), "INVALID_VALUE");
  vm.runInContext("delete app.project.renderQueue.queueInAME", context);
  const absent = renderPlan(apply, "ame-absent", { mediaEncoder: "queue" });
  assert.match(String(errorCode(absent)), /MEDIA_ENCODER_UNSUPPORTED/);
});

function importFootage(newItemId: string, path: string): JsonValue {
  return { operation: "import_file", newItemId, path, importAs: "footage" };
}

function cleanup(apply: PlanApply, planId: string, fields: JsonObject): JsonObject {
  return applyPlan(apply, planId, [{ operation: "cleanup_project", ...fields }]);
}

test("cleanup_project needs the destructive fallback(literal(true), false) and lists exactly what the host removed", () => {
  const { apply, output, projectItems } = loadApplyPlan();
  const unconfirmed = cleanup(apply, "clean-unconfirmed", { mode: "remove_unused_footage" });
  assert.equal(errorCode(unconfirmed), "DESTRUCTIVE_CONFIRMATION_REQUIRED");
  const before = projectItems.length;
  const imported = applyPlan(apply, "clean-import", [importFootage("__new__:item1", "/fixtures/title.mov"), importFootage("__new__:item2", "/fixtures/replacement.mov")]);
  assertApplied(imported);
  const unusedId = String(fieldOf(imported, "steps", 0, "itemId"));
  output.unusedIds.add(unusedId);
  const result = cleanup(apply, "clean-run", { mode: "remove_unused_footage", destructive: true });
  assertApplied(result);
  assert.equal(fieldOf(result, "steps", 0, "removedCount"), 1);
  assert.equal(fieldOf(result, "steps", 0, "removed", 0, "id"), unusedId);
  assert.equal(fieldOf(result, "steps", 0, "verification"), "project-cleanup-diffed");
  assert.equal(projectItems.length, before + 1);
  assert.deepEqual(output.cleanupCalls, ["remove_unused_footage"]);
});

test("reduce keeps the named compositions and consolidate reports the merged items", () => {
  const { apply, output } = loadApplyPlan();
  const missing = cleanup(apply, "reduce-missing", { mode: "reduce", compositionIds: ["nope"], destructive: true });
  assert.equal(errorCode(missing), "TARGET_NOT_FOUND");
  const noIds = cleanup(apply, "reduce-no-ids", { mode: "reduce", destructive: true });
  assert.equal(errorCode(noIds), "INVALID_VALUE");
  const reduced = cleanup(apply, "reduce-ok", { mode: "reduce", compositionIds: ["comp-main"], destructive: true });
  assertApplied(reduced);
  assert.equal(fieldOf(reduced, "steps", 0, "removedCount"), 0);
  const consolidated = cleanup(apply, "consolidate-ok", { mode: "consolidate_footage", destructive: true });
  assert.equal(fieldOf(consolidated, "steps", 0, "mode"), "consolidate_footage");
  assert.deepEqual(output.cleanupCalls, ["reduce", "consolidate_footage"]);
});

function exportFrame(apply: PlanApply, planId: string, base: JsonObject, extra: JsonObject): JsonObject {
  const operation = { operation: "export_frame", compositionId: "comp-main", exportAuthorization: "EXPORT_NOW", ...base, ...extra };
  return applyPlan(apply, planId, [operation]);
}

test("apply_plan export_frame saves a PNG at a time, waits for it, and refuses what it cannot write", () => {
  const { apply, comp, writtenFiles } = loadExtended();
  const files = new Map<string, number>();
  const savePng = (time: number, file: { fsName: string }): void => {
    files.set(file.fsName, 4096 + time);
    writtenFiles.set(file.fsName, 4096 + time);
  };
  Object.assign(comp, { saveFrameToPng: savePng });
  const base = { time: 2, outputPath: "/exports/still.png", overwrite: false };
  const frame = (extra: JsonObject = {}): JsonObject => exportFrame(apply, "frame", base, extra);
  const done = frame();
  assertApplied(done);
  assert.equal(fieldOf(done, "steps", 0, "verification"), "frame-file-written");
  assert.equal(files.get("/exports/still.png"), 4098);
  assert.equal(errorCode(frame({ time: 999 })), "INVALID_VALUE");
  assert.equal(errorCode(frame({ resolution: 0 })), "INVALID_VALUE");
  assert.equal(errorCode(frame({ outputPath: "/exports/still.jpg" })), "INVALID_VALUE");
  assert.equal(errorCode(frame({ exportAuthorization: "yes" })), "INVALID_VALUE");
});

test("export_frame renders at full size whatever the preview resolution is, and puts the preview resolution back", () => {
  const { apply, comp, writtenFiles } = loadExtended();
  const seen: string[] = [];
  let factor = [2, 2];
  const savePng = (_time: number, file: { fsName: string }): void => {
    seen.push(JSON.stringify(factor));
    writtenFiles.set(file.fsName, 4096);
  };
  Object.defineProperty(comp, "resolutionFactor", { get: () => factor, set: (value: number[]) => (factor = value) });
  Object.assign(comp, { saveFrameToPng: savePng });
  const base = { time: 1, outputPath: "/exports/res.png", overwrite: true };
  assertApplied(exportFrame(apply, "frame-res", base, {}));
  assert.deepEqual(seen, ["[1,1]"]);
  assert.equal(JSON.stringify(factor), "[2,2]");
  assertApplied(exportFrame(apply, "frame-res", base, { resolution: 4 }));
  assert.deepEqual(seen, ["[1,1]", "[4,4]"]);
  assert.equal(JSON.stringify(factor), "[2,2]");
});

function parentPath(path: string): string | null {
  const cut = path.lastIndexOf("/");
  return cut > 0 ? path.slice(0, cut) : null;
}

function folderAt(path: string, exists: boolean, made: string[]): FolderLike {
  const parent = parentPath(path);
  return {
    fsName: path,
    exists,
    get parent() {
      return parent === null ? null : folderAt(parent, made.includes(parent) || parent === HOME, made);
    },
    create() {
      made.push(path);
      return true;
    },
  };
}

test("a missing destination folder is created beneath the home folder and refused anywhere else", () => {
  const { context } = loadExtended();
  const made: string[] = [];
  Object.assign(context, { Folder: () => ({ fsName: HOME }) });
  const ensure = (path: string): void => {
    Object.assign(context, { missingFolder: folderAt(path, false, made) });
    vm.runInContext('aeApplyEnsureFolder(missingFolder, "FRAME_EXPORT_FAILED")', context);
  };
  ensure("/Users/me/Movies/new/deeper");
  assert.deepEqual(made, ["/Users/me/Movies", "/Users/me/Movies/new", "/Users/me/Movies/new/deeper"]);
  assert.throws(() => ensure("/Library/elsewhere"), HOME_ONLY);
  assert.throws(() => ensure("/Users/mefoo/x"), HOME_ONLY);
});
