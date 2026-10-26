/** Tests that a live report is narrowed into typed records with safe defaults. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeOpenQuestions } from "../src/questions.js";
import { parseLiveReport, parseOpenQuestionsReport, parseProgressRecords, progressReport } from "../src/report-parse.js";

const PROP_DUMP = { "7|ADBE Mask Parade/ADBE Mask Atom": { mn: "ADBE Mask Atom", nm: "Mask 1", pt: "G", c: 4, extra: "dropped", mask: { mode: "ADD", inverted: false } } };

const REPORT = {
  schemaVersion: "0.1",
  kit: { generatedAt: "2026-01-01T00:00:00Z", packDigest: "d", extyntVersion: "0.9.0" },
  runtime: { appVersion: "26.2.1", buildNumber: "2", platform: "macOS", architecture: "arm64", os: "Test OS", locale: "en_US" },
  hostKey: "26.2.1 (2) TestOS/arm64",
  startedAt: "s", finishedAt: "f",
  apiProbes: { globals: { trackMatte: true } },
  runnerErrors: ["one error", 42, ""],
  cases: [{
    id: "mask.add", status: "ran", tokens: { "@layer:top": "7" }, caseCompId: "1",
    baseline: { items: {}, comps: {}, layers: {}, props: {}, files: {} },
    afterApply: { items: {}, comps: {}, layers: { "7": { name: "Top" } }, props: PROP_DUMP, files: {} },
    afterRerun: null, afterUndo: null,
    host: [{ phase: "apply", stepIndex: 0, ok: true, response: { ok: true }, durationMs: 5 }],
    undo: { attempted: 1, allowed: 1, restoredAfter: 1, overshot: false, errors: [] },
    cleanup: "removed 1 item(s)", ignoredByTheParser: "dropped",
  }],
};

type LiveReport = ReturnType<typeof parseLiveReport>;
type LiveReportCase = LiveReport["cases"][number];

function onlyCase(report: LiveReport): LiveReportCase {
  const record = report.cases[0];
  assert.ok(record, "the report carries a case");
  return record;
}

function assertReportIsNarrowed(report: LiveReport): void {
  assert.equal(report.kit.extyntVersion, "0.9.0");
  assert.equal(report.runtime?.locale, "en_US");
  assert.deepEqual(report.runnerErrors, ["one error"], "only string runner errors survive");
  assert.deepEqual(report.apiProbes, { globals: { trackMatte: true } });
}

function assertCaseStateIsNarrowed(record: LiveReportCase): void {
  assert.equal(record.status, "ran");
  assert.deepEqual(record.tokens, { "@layer:top": "7" });
  assert.equal(record.afterApply?.layers["7"]?.name, "Top");
}

function assertMaskCellIsNarrowed(record: LiveReportCase): void {
  const mask = record.afterApply?.props["7|ADBE Mask Parade/ADBE Mask Atom"]?.mask;
  assert.equal(mask?.mode, "ADD");
  assert.equal(mask?.inverted, false);
  assert.ok(!Object.hasOwn(mask ?? {}, "extra"), "a field the report model does not carry is not invented");
}

function assertCaseTailIsNarrowed(record: LiveReportCase): void {
  assert.equal(record.host[0]?.ok, true);
  assert.equal(record.undo?.attempted, 1);
  assert.equal(record.cleanup, "removed 1 item(s)");
  assert.ok(!("ignoredByTheParser" in record));
}

test("parseLiveReport narrows a finished report and drops unmodelled fields", () => {
  const report = parseLiveReport(JSON.stringify(REPORT));
  assertReportIsNarrowed(report);
  const record = onlyCase(report);
  assertCaseStateIsNarrowed(record);
  assertMaskCellIsNarrowed(record);
  assertCaseTailIsNarrowed(record);
});

test("parseLiveReport gives a malformed record safe defaults instead of a domain lie", () => {
  const report = parseLiveReport(JSON.stringify({ cases: [{}] }));
  assert.equal(report.runtime, null);
  assert.equal(report.hostKey, null);
  const record = onlyCase(report);
  assert.deepEqual([record.id, record.status, record.tokens, record.host, record.undo, record.baseline], ["", "runner-error", {}, [], null, null]);
  assert.throws(() => parseLiveReport("[]"), /expected one JSON object/);
});

test("parseProgressRecords survives raw newlines and a truncated record", () => {
  const header = JSON.stringify({ header: true, kit: { generatedAt: "g", packDigest: "p", extyntVersion: "0" }, runtime: null, hostKey: "h", startedAt: "s", apiProbes: {} });
  const record = (id: string, status: string) => JSON.stringify({ id, status, host: [] }).replace('"host":[]', '"host":[\n\n]');
  const lines = parseProgressRecords([header, record("a", "ran"), record("b", "bogus"), '{"id":"trunc","status":"r', ""].join("\n"));
  assert.equal(lines.length, 3, "the truncated record is skipped, not fatal");
  const report = progressReport(lines.find((line) => line.header === true) ?? {}, lines.filter((line) => line.header !== true));
  assert.equal(report.hostKey, "h");
  assert.equal(report.finishedAt, null);
  assert.deepEqual(report.cases.map((entry) => [entry.id, entry.status]), [["a", "ran"], ["b", "runner-error"]]);
  assert.deepEqual(report.runnerErrors, ["progress.jsonl: the run did not finish"]);
});

test("parseOpenQuestionsReport keeps probe data and feeds the analyzer", () => {
  const report = parseOpenQuestionsReport(JSON.stringify({
    schemaVersion: "0.1", kind: "extynt-open-questions", hostKey: "h", cleanup: "removed 9 item(s)",
    runtime: { appVersion: "26.2.1", buildNumber: "2", platform: "TestOS", architecture: "arm64", os: "Test OS", locale: null },
    questions: [{ id: "q1-parent-compensation-scope", title: "t", state: "answered", error: null, data: { cases: [] } }],
    probeErrors: [{ group: "Q1", error: "boom" }], errors: ["x"],
  }));
  assert.equal(report.cleanup, "removed 9 item(s)");
  assert.deepEqual(report.questions?.[0]?.data, { cases: [] });
  assert.deepEqual(report.probeErrors, [{ group: "Q1", error: "boom" }]);
  const result = analyzeOpenQuestions(report);
  assert.deepEqual(result.counts, { answered: 1, partial: 0, error: 0, unanswered: 0, missing: 4 });
  assert.throws(() => parseOpenQuestionsReport("null"), /expected one JSON object/);
});

const header = (hostKey: string | null, packDigest = "p", extyntVersion = "0") => ({ header: true, kit: { generatedAt: "g", packDigest, extyntVersion }, runtime: null, hostKey, startedAt: "s", apiProbes: {} });
const problemsOf = (sessions: ReturnType<typeof header>[]): string => progressReport(sessions[0] ?? header(null), [], sessions).provenanceProblems?.join(" ") ?? "";

test("progressReport accepts a resumed session on the same host", () => {
  const same = progressReport(header("25.1 (1) Windows/x86_64"), [], [header("25.1 (1) Windows/x86_64"), { ...header("25.1 (1) Windows/x86_64"), resumed: true }]);
  assert.deepEqual(same.provenanceProblems, []);
  assert.deepEqual(same.runnerErrors, ["progress.jsonl: the run did not finish"]);
});

test("progressReport flags sessions that ran on different hosts", () => {
  const hosts = progressReport(header("25.1 (1) Windows/x86_64"), [], [header("25.1 (1) Windows/x86_64"), header("26.2 (3) Windows/x86_64")]);
  assert.equal(hosts.provenanceProblems?.length, 1);
  assert.match(hosts.provenanceProblems?.[0] ?? "", /different hosts \(25\.1 \(1\) Windows\/x86_64 \| 26\.2 \(3\) Windows\/x86_64\)/);
  assert.ok(hosts.runnerErrors.some((error) => /different hosts/.test(error)), "the analyzer sees it as a runner error too");
  assert.match(problemsOf([header("h"), header(null)]), /different hosts \(h \| \(none\)\)/);
});

test("progressReport flags sessions that ran on different packs or kit versions", () => {
  assert.match(problemsOf([header("h", "p1"), header("h", "p2")]), /different packs/);
  assert.match(problemsOf([header("h", "p", "0.1"), header("h", "p", "0.2")]), /different kit versions/);
});
