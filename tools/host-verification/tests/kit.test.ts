/** Tests that the generated kit is ES3 and keeps its ExtendScript grouped and quoted safely. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { executablePlanTypes } from "@extynt/capability-catalogue";
import { buildPack, renderRunner } from "../src/generate.js";
import { analyzeReport, judgeUndo, ledgerEntryOf } from "../src/analyze.js";
import { readReport } from "../src/cli.js";
import { allCases } from "../src/cases/index.js";
import { LAYER_PROPERTY_GROUPS } from "../src/cases/sweep.js";
import type { JsonObject, JsonValue } from "../src/json.js";
import { ambiguousGroupings } from "./fixtures/ambiguous-groupings.js";

const REPO = new URL("../../../../", import.meta.url).pathname;

test("every ExtendScript file groups ternaries and mixed && / || explicitly", () => {
  const files = execFileSync("git", ["ls-files", "*.jsx"], { cwd: REPO, encoding: "utf8" }).split("\n").filter(Boolean);
  assert.ok(files.includes("apps/panel/host/probe.jsx"));
  const problems = files.flatMap((name) => ambiguousGroupings(readFileSync(join(REPO, name), "utf8"), name));
  assert.deepEqual(problems, []);
});

const ES3_RESERVED_WORDS = new Set([
  "abstract", "boolean", "byte", "case", "catch", "char", "class", "const", "continue", "debugger",
  "default", "delete", "do", "double", "else", "enum", "export", "extends", "false", "final",
  "finally", "float", "for", "function", "goto", "if", "implements", "import", "in", "instanceof",
  "int", "interface", "long", "native", "new", "null", "package", "private", "protected", "public",
  "return", "short", "static", "super", "switch", "synchronized", "this", "throw", "throws",
  "transient", "true", "try", "typeof", "var", "void", "volatile", "while", "with",
]);
function reservedWordKeys(source: string, fileName: string): string[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES5, true, ts.ScriptKind.JS), found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && ES3_RESERVED_WORDS.has(node.name.text))
      found.push(`${fileName}:${file.getLineAndCharacterOfPosition(node.name.getStart(file)).line + 1} reserved word "${node.name.text}" as an object key — quote it`);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

test("no ExtendScript file uses an ES3 reserved word as an unquoted object key", () => {
  const files = execFileSync("git", ["ls-files", "*.jsx"], { cwd: REPO, encoding: "utf8" }).split("\n").filter(Boolean);
  const problems = files.flatMap((name) => reservedWordKeys(readFileSync(join(REPO, name), "utf8"), name));
  assert.deepEqual(problems, []);
});

test("the reserved-word guard catches an unquoted key and passes a quoted one", () => {
  assert.equal(reservedWordKeys("var a = { case: null };", "t.jsx").length, 1);
  assert.equal(reservedWordKeys('var a = { "case": null };', "t.jsx").length, 0);
  assert.equal(reservedWordKeys("var a = { ok: 1 }; a.case = 2;", "t.jsx").length, 0);
});

test("the guard catches both live AE grouping traps", () => {
  assert.equal(ambiguousGroupings('var x = a ? "p" : b ? "q" : "r";', "t.jsx").length, 1);
  assert.equal(ambiguousGroupings("var y = a === undefined || typeof a === \"number\" && a > 0;", "t.jsx").length, 1);
  assert.deepEqual(ambiguousGroupings('var z = a ? "p" : (b ? "q" : "r"); var w = a === undefined || (typeof a === "number" && a > 0);', "t.jsx"), []);
  assert.equal(ambiguousGroupings('var q = a && b ? "p" : "r";', "t.jsx").length, 1);
  assert.deepEqual(ambiguousGroupings('var q = (a && b) ? "p" : "r"; var s = a && (b ? "p" : "r");', "t.jsx"), []);
});

test("the pack has no broken cases and every executable plan type has an applying case", () => {
  const { pack, issues } = buildPack({ effectSweep: false, now: "2026-01-01T00:00:00Z" });
  assert.deepEqual(issues, []);
  const cases = allCases({ effectSweep: false });
  const applying = new Set(cases.filter((entry) => (entry.outcome?.kind ?? "applied") === "applied").flatMap((entry) => entry.verifies ?? entry.covers));
  assert.deepEqual(executablePlanTypes().filter((type) => !applying.has(type)), [], "every executable plan type needs a case that applies it");
  assert.ok(cases.some((entry) => entry.covers.includes("switch_project") && entry.outcome?.kind === "host"), "switch_project keeps its refusal case");
  for (const options of [{ effectSweep: false }, {}]) {
    const ordered = allCases(options);
    assert.equal(ordered[ordered.length - 1]?.id, "project.switch-open", "the applying switch_project case runs last");
    assert.equal(ordered.filter((entry) => entry.steps.some((step) => JSON.stringify(step).includes("switch_project") && !("rawCommand" in step))).length, 1, "no other case switches project");
  }
  assert.equal(new Set(pack.cases.map((entry) => entry.id)).size, pack.cases.length);
});

test("the effect sweep never tries to add layer property groups as effects", () => {
  const ids = new Set(allCases().map((entry) => entry.id));
  for (const group of LAYER_PROPERTY_GROUPS) assert.ok(![...ids].some((id) => id.endsWith(group)), group);
});

test("the generated script embeds the production adapter and parses", () => {
  const { pack } = buildPack({ effectSweep: false, now: "2026-01-01T00:00:00Z" });
  const script = renderRunner(pack);
  assert.ok(script.includes("function aeApplyPlan("));
  assert.ok(script.includes("current-case.json"));
  assert.doesNotThrow(() => new Function(script));
});

test("the generated script carries the JSON polyfill ahead of every JSON use (AE 25 has no native JSON)", () => {
  const { pack } = buildPack({ effectSweep: false, now: "2026-01-01T00:00:00Z" });
  const script = renderRunner(pack);
  const polyfill = script.indexOf("A global JSON for a script engine that has none");
  assert.ok(polyfill >= 0, "polyfill embedded");
  const afterPolyfill = script.slice(polyfill + 1);
  const codeBefore = script.slice(0, polyfill).split("\n").filter((line) => !line.startsWith("//") && !line.startsWith("var EXTYNT_LIVE_PACK"));
  assert.ok(!codeBefore.some((line) => /\bJSON\b/.test(line)), "no code uses JSON before the polyfill");
  assert.ok(afterPolyfill.includes('typeof JSON === "undefined"'), "the runner guard stays as a last resort");
  assert.ok(afterPolyfill.indexOf("JSON.parse(") > 0 && afterPolyfill.indexOf("JSON.stringify(") > 0);
});

test("undo is judged by what it left behind, not by how many steps it took", () => {
  const delta = (...keys: string[]) => ({ items: {}, comps: {}, layers: {}, props: Object.fromEntries(keys.map((key) => [key, null])), files: {} });
  const materials = "layer-1|ADBE Root Vectors Group/ADBE Vector Group/ADBE Vector Materials Group";
  const undo = (afterUndo: ReturnType<typeof delta>, extra: { overshot?: boolean; errors?: string[] } = {}) =>
    judgeUndo({ afterUndo, undo: { attempted: 1, errors: [], ...extra } });

  assert.deepEqual(undo(delta()).failures, []);
  assert.deepEqual(undo(delta(), { overshot: true }).failures, []);
  assert.deepEqual(undo(delta(materials), { overshot: true }).failures, []);
  const left = undo(delta("layer-1|ADBE Mask Parade/ADBE Mask Atom"), { overshot: true });
  assert.equal(left.verdict.ok, false);
  assert.equal(left.failures.length, 2);
  assert.match(left.failures[0] ?? "", /more undo steps than this plan opened/);
  assert.match(left.failures[1] ?? "", /undo left 1 difference\(s\)/);
  assert.equal(undo(delta(), { errors: ["no more undo"] }).verdict.ok, false);
});

test("readReport reads crashed and resumed progress files with raw newlines inside records", () => {
  const dir = mkdtempSync(join(tmpdir(), "extynt-progress-"));
  const header = JSON.stringify({ header: true, kit: { generatedAt: "x", packDigest: "d", extyntVersion: "0" }, runtime: null, hostKey: "h", startedAt: "s", apiProbes: {} });
  const record = (id: string, status: string) => JSON.stringify({ id, status, host: [], undo: { attempted: 0, errors: [] } }).replace('"errors":[]', '"errors":[\n\n]');
  writeFileSync(join(dir, "progress.jsonl"), [header, record("a", "ran"), record("b", "runner-error"), header.replace('"header":true', '"header":true,"resumed":true'), record("b", "host-crashed"), record("c", "ran"), ""].join("\n"));
  const report = readReport(dir);
  assert.deepEqual(report.cases.map((entry) => [entry.id, entry.status]), [["a", "ran"], ["b", "host-crashed"], ["c", "ran"]]);
  assert.equal(report.hostKey, "h");
});

interface ResumeKey { packDigest: string; extyntVersion: string; hostKey: string | null }
type ResumeRefusal = (progress: string, current: ResumeKey, lockAgeMs: number | null) => string | null;
interface RunnerHelpers { safe: (call: () => JsonValue, fallback: JsonValue) => JsonValue; iso: () => string; resumeRefusal?: ResumeRefusal }

function loadResumeRefusal(): ResumeRefusal {
  const source = readFileSync(new URL("../../runner/runner-report.jsx", import.meta.url), "utf8");
  const hv: RunnerHelpers = { safe: (call, fallback) => { try { return call(); } catch { return fallback; } }, iso: () => "t" };
  vm.runInNewContext(source, { EXTYNT_HV: hv, EXTYNT_LIVE_PACK: { kit: { packDigest: "pack-a", extyntVersion: "1.0" }, cases: [] } });
  const refusal = hv.resumeRefusal;
  assert.ok(refusal, "the runner defines resumeRefusal");
  return refusal;
}
const SESSION_HEADER = (hostKey: string | null, extra: JsonObject = {}, kit = { generatedAt: "g", packDigest: "pack-a", extyntVersion: "1.0" }): string => JSON.stringify({ header: true, ...extra, kit, runtime: null, hostKey, startedAt: "s", apiProbes: {} });
const AE26 = "26.2 (3) Windows/x86_64", AE25 = "25.1 (1) Windows/x86_64";
const NOW_HERE = { packDigest: "pack-a", extyntVersion: "1.0", hostKey: AE26 };

test("the runner resumes only a run recorded on this host by this kit build (B-21)", () => {
  const refusal = loadResumeRefusal();
  const record = '{"id":"layer.a","status":"ran","host":[]}';
  const reasonFor = (progress: string, now: ResumeKey): string => refusal(progress, now, null) ?? "";
  assert.equal(refusal([SESSION_HEADER(AE26), record, ""].join("\n"), NOW_HERE, null), null, "same host and kit, no lock: a crashed run resumes");
  assert.equal(refusal([SESSION_HEADER(AE26), record, SESSION_HEADER(AE26, { resumed: true }), ""].join("\n"), NOW_HERE, null), null, "a run resumed before on this host still resumes");
  assert.match(reasonFor([SESSION_HEADER(AE25), record, ""].join("\n"), NOW_HERE), /another host \(25\.1 \(1\) Windows\/x86_64; this host is 26\.2/, "the AE25 run is not offered on AE26");
  assert.match(reasonFor([SESSION_HEADER(AE26), record, SESSION_HEADER(AE25, { resumed: true }), ""].join("\n"), NOW_HERE), /another host/, "one foreign session in the file is enough");
  assert.match(reasonFor([SESSION_HEADER(null), record, ""].join("\n"), NOW_HERE), /another host/, "a progress file that never learned its host cannot be bound");
  assert.match(reasonFor([SESSION_HEADER(AE26), ""].join("\n"), { ...NOW_HERE, hostKey: null }), /another host/, "an unreadable current host refuses rather than guesses");
  assert.match(reasonFor([SESSION_HEADER(AE26, {}, { generatedAt: "g", packDigest: "pack-a", extyntVersion: "0.9" }), ""].join("\n"), NOW_HERE), /another kit build/);
  assert.match(reasonFor([SESSION_HEADER(AE26, {}, { generatedAt: "g", packDigest: "pack-b", extyntVersion: "1.0" }), ""].join("\n"), NOW_HERE), /another kit build/);
  assert.match(reasonFor(`${record}\n`, NOW_HERE), /no readable session header/);
  assert.match(reasonFor('{"header":true,"kit":', NOW_HERE), /no readable session header/);
});

test("the runner does not resume a run that is still going, but does resume one that went quiet (B-21)", () => {
  const refusal = loadResumeRefusal(), progress = `${SESSION_HEADER(AE26)}\n{"id":"layer.a","status":"ran","host":[]}\n`;
  assert.match(refusal(progress, NOW_HERE, 30_000) ?? "", /still running \(last activity 30 s ago\)/);
  assert.match(refusal(progress, NOW_HERE, 9 * 60_000) ?? "", /still running/);
  assert.match(refusal(progress, NOW_HERE, -5_000) ?? "", /still running/, "a lock from the future is not stale");
  assert.equal(refusal(progress, NOW_HERE, 11 * 60_000), null, "a crashed run's old lock does not block resuming it");
});

test("the runner keeps a heartbeat while a run goes, drops it when the session ends, and binds resume to the probed host (B-21)", () => {
  const report = readFileSync(new URL("../../runner/runner-report.jsx", import.meta.url), "utf8"), main = readFileSync(new URL("../../runner/runner.jsx", import.meta.url), "utf8");
  assert.match(report, /function breadcrumb\(id, phase\) \{ heartbeat\(\);/, "every phase refreshes the lock");
  assert.match(main, /H\.startRunLock\(/);
  assert.match(main, /finally \{[^}]*H\.releaseRunLock\(\);/);
  assert.match(main, /hostKey: H\.hostKey\(runtime\)/);
  assert.match(main, /H\.unfinishedRun\(current\)/);
  assert.ok(main.indexOf('mode === "VERIFY" && !app.newProject()') < main.indexOf("var session = startSession(mode)"), "the runtime probe runs in the throwaway project");
});

test("readReport refuses to credit a run that mixed hosts, and keeps the finished report's host honest (B-21)", () => {
  const dir = mkdtempSync(join(tmpdir(), "extynt-mixed-"));
  const record = JSON.stringify({ id: "a", status: "ran", host: [], undo: { attempted: 0, errors: [] } });
  writeFileSync(join(dir, "progress.jsonl"), [SESSION_HEADER(AE25), record, SESSION_HEADER(AE26, { resumed: true }), ""].join("\n"));
  const mixed = readReport(dir);
  assert.equal(mixed.hostKey, AE25);
  assert.equal(mixed.provenanceProblems?.length, 1);
  assert.ok(mixed.runnerErrors.some((error) => /different hosts/.test(error)));
  const analysis = analyzeReport(mixed);
  assert.deepEqual(analysis.provenanceProblems, mixed.provenanceProblems);
  assert.throws(() => ledgerEntryOf(analysis, "2026-10-18T00:00:00Z"), /mixes hosts or packs/);

  const clean = mkdtempSync(join(tmpdir(), "extynt-final-"));
  writeFileSync(join(clean, "progress.jsonl"), [SESSION_HEADER(AE26), record, ""].join("\n"));
  const finished = (hostKey: string) => JSON.stringify({ schemaVersion: "0.1", kit: { generatedAt: "g", packDigest: "pack-a", extyntVersion: "1.0" }, mode: "VERIFY", runtime: null, hostKey, startedAt: "s", finishedAt: "f", cases: [], apiProbes: {}, runnerErrors: [] });
  writeFileSync(join(clean, "live-report.json"), finished(AE26));
  assert.deepEqual(readReport(clean).provenanceProblems, []);
  writeFileSync(join(clean, "live-report.json"), finished(AE25));
  const foreignFinal = readReport(clean);
  assert.match(foreignFinal.provenanceProblems?.join(" ") ?? "", /live-report\.json is from host 25\.1/);
  assert.ok(foreignFinal.runnerErrors.some((error) => /live-report\.json is from host/.test(error)));
});
