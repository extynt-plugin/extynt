/** Tests how the kit reads host platform and architecture from a report. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHostKey } from "@extynt/capability-catalogue";
import { analyzeReport } from "../src/analyze.js";
import { buildPack } from "../src/generate.js";
import { allCases } from "../src/cases/index.js";
import { COMMON_EFFECT_ROWS, DIALOG_ON_APPLY, controlTreeDrift, expectedControls } from "../src/cases/sweep.js";
import { canonicalHostKey } from "../src/host-key.js";
import { makeView } from "../src/analyze.js";
import { isJsonObject } from "../src/json.js";
import { parseLiveReport } from "../src/report-parse.js";
import type { CaseRunRecord, DumpSections, LiveReport, PropEntry } from "../src/types.js";

const WINDOWS_RUNTIME = { appVersion: "26.5x89", buildNumber: "89", platform: "undefined", architecture: "undefined", os: "Windows/64 10.0  ", locale: null };
const EMPTY: DumpSections = { items: {}, comps: {}, layers: {}, props: {}, files: {} };

test("the kit computes the product's host key from a Windows runtime that reports no platform or architecture", () => {
  assert.equal(canonicalHostKey(WINDOWS_RUNTIME), "26.5.0 (89) Windows/x86_64");
  assert.equal(parseHostKey("26.5.0 (89) Windows/x86_64")?.os, "Windows");
});

test("macOS keeps the architecture the probe reported and falls back to unknown", () => {
  assert.equal(canonicalHostKey({ ...WINDOWS_RUNTIME, appVersion: "26.2.1x2", buildNumber: "2", platform: "macOS", architecture: "arm64", os: "Macintosh OS 14.5" }), "26.2.1 (2) macOS/arm64");
  assert.equal(canonicalHostKey({ ...WINDOWS_RUNTIME, appVersion: "26.2x2", buildNumber: "2", platform: "undefined", architecture: "undefined", os: "Macintosh OS 14.5" }), "26.2.0 (2) macOS/unknown");
});

test("analyze rewrites an old-format report key so the existing run is writable to the ledger", () => {
  const text = JSON.stringify({ schemaVersion: "0.1", kit: { generatedAt: "g", packDigest: "p", extyntVersion: "0.9.8t" }, runtime: WINDOWS_RUNTIME, hostKey: "26.5x89 (89) undefined/undefined", startedAt: "s", finishedAt: "f", cases: [], apiProbes: {}, runnerErrors: [] });
  const report = parseLiveReport(text);
  assert.equal(report.hostKey, "26.5.0 (89) Windows/x86_64");
  assert.equal(report.runtime?.platform, "Windows");
  assert.equal(report.runtime?.architecture, "x86_64");
  assert.equal(analyzeReport(report, []).hostLabel, "After Effects 26.5.0 (build 89) Windows/x86_64");
});

const prop = (matchName: string, group = false): PropEntry => ({ mn: matchName, nm: matchName, pt: group ? "G" : "P", ...(group ? {} : { vt: "OneD" }) });
const viewOf = (props: Record<string, PropEntry>) => makeView({ ...EMPTY, props: Object.fromEntries(Object.entries(props).map(([path, entry]) => [`L1|${path}`, entry])) }, { tokens: { "@layer:top": "L1" }, caseCompId: "C1" });
const ROOT = "ADBE Effect Parade/ADBE Gaussian Blur 2";
const EVIDENCE_ROWS = [
  { m: "ADBE Gaussian Blur 2-0001", n: "Blurriness", t: "OneD" },
  { m: "ADBE Effect Mask Parade", n: "Masks", g: 1 }, { m: "ADBE Effect Mask Opacity", n: "Effect Opacity", t: "OneD" }, { m: "ADBE Force CPU GPU", n: "GPU Rendering", t: "OneD" },
];

test("an effect's common rows (Masks, Effect Opacity, GPU Rendering) are neither expected nor drift", () => {
  assert.deepEqual([...COMMON_EFFECT_ROWS].sort(), ["ADBE Effect Mask Opacity", "ADBE Effect Mask Parade", "ADBE Force CPU GPU"]);
  const expected = expectedControls("ADBE Gaussian Blur 2", EVIDENCE_ROWS);
  const base = { [ROOT]: prop("ADBE Gaussian Blur 2", true), [`${ROOT}/ADBE Gaussian Blur 2-0001`]: prop("ADBE Gaussian Blur 2-0001") };
  assert.deepEqual(controlTreeDrift(viewOf(base), "top", "ADBE Gaussian Blur 2", expected), [], "a readback without the common rows is not drift");
  const withRows = viewOf({ ...base, [`${ROOT}/ADBE Effect Mask Opacity`]: prop("ADBE Effect Mask Opacity"), [`${ROOT}/ADBE Force CPU GPU`]: prop("ADBE Force CPU GPU") });
  assert.deepEqual(controlTreeDrift(withRows, "top", "ADBE Gaussian Blur 2", expected), [], "a readback that has them is not drift either");
});

test("a real missing or extra control is still drift", () => {
  const expected = expectedControls("ADBE Gaussian Blur 2", EVIDENCE_ROWS);
  const missing = viewOf({ [ROOT]: prop("ADBE Gaussian Blur 2", true) });
  assert.match(controlTreeDrift(missing, "top", "ADBE Gaussian Blur 2", expected).join("; "), /missing control ADBE Gaussian Blur 2-0001/);
  const extra = viewOf({ [ROOT]: prop("ADBE Gaussian Blur 2", true), [`${ROOT}/ADBE Gaussian Blur 2-0001`]: prop("ADBE Gaussian Blur 2-0001"), [`${ROOT}/ADBE Gaussian Blur 2-0002`]: prop("ADBE Gaussian Blur 2-0002") });
  assert.match(controlTreeDrift(extra, "top", "ADBE Gaussian Blur 2", expected).join("; "), /controls not in evidence: ADBE Gaussian Blur 2-0002/);
});

test("state- and build-dependent rows (Puppet pin groups, Roto Brush positional rows) are not drift, but a real missing control still is", () => {
  const pin = [{ m: "ADBE FreePin3 PosPin Atom", n: "Position Pins", t: "OneD" }, { m: "ADBE FreePin3 Outlines", n: "Auto-traced Shapes", g: 1 }, { m: "ADBE FreePin3 Outline Child", n: "Child", t: "OneD" }, { m: "ADBE FreePin3 Mesh Group", n: "Mesh", g: 0 }];
  const pinRoot = "ADBE Effect Parade/ADBE FreePin3", pinExpected = expectedControls("ADBE FreePin3", pin);
  const bare = viewOf({ [pinRoot]: prop("ADBE FreePin3", true), [`${pinRoot}/ADBE FreePin3 PosPin Atom`]: prop("ADBE FreePin3 PosPin Atom") });
  assert.deepEqual(controlTreeDrift(bare, "top", "ADBE FreePin3", pinExpected), [], "a fresh Puppet has no Outlines or Mesh Group yet");
  const noPin = viewOf({ [pinRoot]: prop("ADBE FreePin3", true) });
  assert.match(controlTreeDrift(noPin, "top", "ADBE FreePin3", pinExpected).join("; "), /missing control ADBE FreePin3 PosPin Atom/);
  const roto = [{ m: "ADBE Samurai-0001", n: "View", t: "OneD" }, { m: "/10", n: "", t: "OneD" }, { m: "/18", n: "", g: 1 }, { m: "/19", n: "", t: "OneD" }];
  const rotoRoot = "ADBE Effect Parade/ADBE Samurai", rotoExpected = expectedControls("ADBE Samurai", roto);
  const shifted = viewOf({ [rotoRoot]: prop("ADBE Samurai", true), [`${rotoRoot}/ADBE Samurai-0001`]: prop("ADBE Samurai-0001"), [`${rotoRoot}/%2F11`]: prop("/11"), [`${rotoRoot}/%2Fmk_quality`]: prop("/mk_quality") });
  assert.deepEqual(controlTreeDrift(shifted, "top", "ADBE Samurai", rotoExpected), [], "indexed rows shift between builds");
  const extra = viewOf({ [rotoRoot]: prop("ADBE Samurai", true), [`${rotoRoot}/ADBE Samurai-0001`]: prop("ADBE Samurai-0001"), [`${rotoRoot}/ADBE Samurai-0002`]: prop("ADBE Samurai-0002") });
  assert.match(controlTreeDrift(extra, "top", "ADBE Samurai", rotoExpected).join("; "), /controls not in evidence: ADBE Samurai-0002/);
});

test("the MOGRT cases save the project for the real export and keep an unsaved-refusal case", () => {
  const byId = (id: string) => allCases({ effectSweep: false }).find((liveCase) => liveCase.id === id);
  assert.equal(byId("mogrt.export")?.fixture.project, "saved");
  const refusal = byId("mogrt.unsaved-refused");
  assert.equal(refusal?.fixture.project, "unsaved");
  assert.deepEqual(refusal?.outcome, { kind: "host", code: "MOGRT_PROJECT_UNSAVED", mayMutate: undefined });
  const ids = allCases({ effectSweep: false }).map((liveCase) => liveCase.id);
  assert.ok(ids.indexOf("mogrt.unsaved-refused") < ids.indexOf("mogrt.export"), "the unsaved case must run before anything saves the project");
});

test("dialog-on-apply effects are never applied and the invented FXV fixtures are not in the sweep", () => {
  for (const matchName of ["ADBE Apply Color LUT", "ADBE Apply Color LUT2", "ADBE Basic Text2", "ADBE Numbers2", "ADBE Path Text", "mochaAECC"]) assert.ok(DIALOG_ON_APPLY.has(matchName), matchName);
  const sweep = allCases({ effectSweep: true }).filter((liveCase) => liveCase.id.startsWith("effects.sweep."));
  assert.equal(sweep.filter((liveCase) => liveCase.id.includes("FXV ")).length, 0);
  const dialog = sweep.filter((liveCase) => liveCase.outcome?.kind === "dialog");
  assert.ok(dialog.length >= 6);
  const { pack } = buildPack({ effectSweep: true, only: (id) => id.startsWith("effects.sweep.ADBE Basic Text2") });
  assert.equal(pack.cases[0]?.plannerOnly, true);
  assert.deepEqual(pack.cases[0]?.steps, []);
  const report: LiveReport = { schemaVersion: "0.1", kit: { generatedAt: "g", packDigest: "p", extyntVersion: "0" }, runtime: null, hostKey: null, startedAt: "s", finishedAt: null, cases: [], apiProbes: {}, runnerErrors: [] };
  const analysis = analyzeReport(report, dialog);
  assert.ok(analysis.effects.skipped.includes("ADBE Basic Text2"));
  assert.equal(analysis.effects.failed.length + analysis.effects.drift.length, 0);
  assert.equal(analysis.counts.fail + analysis.counts["not-run"] + analysis.counts["broken-case"], 0);
});

function dollyRecord(rerunOk: boolean): CaseRunRecord {
  const afterApply: DumpSections = { ...EMPTY, layers: { "9": { name: "cam", comp: "1" } }, props: { "9|ADBE Transform Group/ADBE Position": { mn: "ADBE Position", nm: "Position", pt: "P", n: 2 } } };
  return {
    id: "camera.dolly", status: "ran", tokens: { "@layer:cam": "9" }, caseCompId: "1", baseline: EMPTY, afterApply, afterRerun: afterApply, afterUndo: null,
    host: [{ phase: "apply", stepIndex: 0, ok: true, response: { ok: true }, durationMs: 1 }, { phase: "rerun", stepIndex: 0, ok: rerunOk, response: rerunOk ? { ok: true } : { ok: false, error: { code: "X", message: "refused" } }, durationMs: 1 }],
    undo: null, cleanup: "",
  };
}

const replayVerdict = (record: CaseRunRecord, cases: ReturnType<typeof allCases>) => analyzeReport({ schemaVersion: "0.1", kit: { generatedAt: "g", packDigest: "p", extyntVersion: "0" }, runtime: null, hostKey: null, startedAt: "s", finishedAt: null, cases: [record], apiProbes: {}, runnerErrors: [] }, cases).verdicts[0];

test("an idempotent replay and a refused replay are both safe", () => {
  const dolly = allCases().filter((liveCase) => liveCase.id === "camera.dolly");
  const judge = (record: CaseRunRecord) => replayVerdict(record, dolly);
  assert.equal(judge(dollyRecord(true))?.rerun?.observed, "same");
  assert.equal(judge(dollyRecord(true))?.status, "pass");
  assert.equal(judge(dollyRecord(false))?.status, "pass");
});

test("a changed replay fails the rerun contract", () => {
  const dolly = allCases().filter((liveCase) => liveCase.id === "camera.dolly");
  const judge = (record: CaseRunRecord) => replayVerdict(record, dolly);
  const changed = dollyRecord(true);
  changed.afterRerun = { ...EMPTY, layers: changed.afterApply?.layers ?? {}, props: { "9|ADBE Transform Group/ADBE Position": { mn: "ADBE Position", nm: "Position", pt: "P", n: 3 } } };
  const verdict = judge(changed);
  assert.equal(verdict?.status, "fail");
  assert.match(verdict?.failures.map((failure) => failure.detail).join(" ") ?? "", /expected same-or-rejected on rerun, observed changed/);
});

test("the corrected rerun contracts match what a real After Effects did", () => {
  const expectOf = (id: string) => allCases().find((liveCase) => liveCase.id === id)?.rerunExpect;
  assert.equal(expectOf("camera.dolly"), "same-or-rejected");
  assert.equal(expectOf("layer.retime.freeze"), "same-or-rejected");
  assert.equal(expectOf("project.cleanup.unused-footage"), "same-or-rejected");
  assert.equal(expectOf("footage.scene-edits"), "same-or-rejected");
  assert.equal(expectOf("layer.derive.split"), "rejected");
  assert.equal(expectOf("layer.retime.reverse"), "same");
});

test("a catalogued effect this host does not have installed is missing and skipped, never a failure", () => {
  const sweep = allCases({ effectSweep: true }).filter((liveCase) => liveCase.id === "effects.sweep.ADBE Unmult");
  const record: CaseRunRecord = { id: "effects.sweep.ADBE Unmult", status: "ran", tokens: {}, caseCompId: "1", baseline: EMPTY, afterApply: EMPTY, afterRerun: null, afterUndo: null, host: [{ phase: "apply", stepIndex: 0, ok: false, response: { ok: false, error: { code: "EFFECT_NOT_AVAILABLE", message: "EFFECT_NOT_AVAILABLE" } }, durationMs: 1 }], undo: null, cleanup: "" };
  const report = (installed: string[]): LiveReport => ({ schemaVersion: "0.1", kit: { generatedAt: "g", packDigest: "p", extyntVersion: "0" }, runtime: null, hostKey: null, startedAt: "s", finishedAt: null, cases: [record], apiProbes: { installedEffects: installed.map((matchName) => ({ matchName })) }, runnerErrors: [] });
  const absent = analyzeReport(report(["ADBE Blur"]), sweep);
  assert.deepEqual(absent.effects.missing, ["ADBE Unmult"]);
  assert.equal(absent.counts.fail, 0);
  assert.equal(absent.verdicts[0]?.status, "skipped");
  assert.equal(analyzeReport(report(["ADBE Unmult"]), sweep).counts.fail, 1);
});

test("the inline SVG case carries the converter fallback the product attaches", () => {
  const liveCase = allCases().find((entry) => entry.id === "project.inline-svg");
  const step = liveCase?.steps[0];
  const operation = step && "operations" in step ? step.operations[0] : undefined;
  assert.ok(isJsonObject(operation), "the case has a first operation");
  const layers = operation.fallbackLayers;
  assert.ok(Array.isArray(layers) && layers.length === 1);
  assert.deepEqual(operation.fallbackSize, [100, 100]);
});
