/** Tests that a run's traces are saved as JSONL per scenario, from sidecar log lines when no provider traffic was recorded. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "../src/cli-args.js";
import { runCommand } from "../src/cli-run.js";
import { scenarioById } from "../src/scenarios.js";
import type { ScenarioRun } from "../src/run-types.js";
import { recordsFromRun, saveRunTraces } from "../src/trace-save.js";

const scenario = scenarioById("title-ident-from-scratch");

const finishedRun: ScenarioRun = {
  scenario, failures: [], logLines: [],
  turns: [{
    index: 1, message: "make a title", factFailures: [], passed: true, logLines: [{ at: "2026-01-01T00:00:00.000Z", event: "tool" }],
    report: { status: 200, outcome: "done", steps: 2, answer: "Made it.", notes: [], tools: [], plans: [{ planId: "plan-1", title: "Title", operations: [] }] },
  }],
};

test("a run with no provider traffic yields the request, the sidecar log lines and the end of each turn", () => {
  assert.deepEqual(recordsFromRun(finishedRun).map((record) => record.kind), ["turn.start", "sidecar.log", "turn.end"]);
});

test("saved traces land under the run id, one file per scenario that ran", () => {
  const directory = mkdtempSync(join(tmpdir(), "traces-"));
  const skipped: ScenarioRun = { scenario: { ...scenario, id: "skipped-one" }, failures: [], logLines: [], skipped: "needs a live model" };
  const written = saveRunTraces({ directory, runId: "bench-1", runs: [finishedRun, skipped], traced: new Map() });
  assert.deepEqual(written, [join(directory, "bench-1", `${scenario.id}.jsonl`)]);
  assert.equal(readFileSync(written[0] ?? "", "utf8").trim().split("\n").length, 3);
  assert.equal(existsSync(join(directory, "bench-1", "skipped-one.jsonl")), false);
});

const OFFLINE_ARGS = ["run", "--scenario", "rename-selected-layer", "--quiet"];

test("--trace-dir chooses where a run saves its traces, and --no-trace saves none", async () => {
  const saved = mkdtempSync(join(tmpdir(), "cli-traces-"));
  await runCommand(parseArgs([...OFFLINE_ARGS, "--trace-dir", saved]));
  assert.equal(readdirSync(saved).length, 1, "one run folder under the chosen directory");
  const unsaved = mkdtempSync(join(tmpdir(), "cli-no-traces-"));
  await runCommand(parseArgs([...OFFLINE_ARGS, "--no-trace", "--trace-dir", unsaved]));
  assert.deepEqual(readdirSync(unsaved), []);
});
