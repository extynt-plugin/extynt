/** The benchmark scenarios, project facts, multi-turn plumbing, the per-role ledger and real-plugin endpoint handling. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readPluginEndpoint } from "@extynt/host-native";
import { compositionAsset } from "../src/assets.js";
import { ledgerRow, ledgerSummary, readLedger, appendLedger } from "../src/benchmark-ledger.js";
import { applyOperationsToFixture } from "../src/fake-host.js";
import { fixtureSnapshotFromProbe } from "../src/fake-host-probe.js";
import { turnUsage } from "../src/ledger-usage.js";
import { installPluginEndpoint } from "../src/plugin-endpoint.js";
import { parsePrompt } from "../src/prompts.js";
import { factFailures } from "../src/project-facts.js";
import { runScenarios, type ScenarioRun } from "../src/run.js";
import { scenarioById } from "../src/scenarios.js";
import type { SidecarHandle } from "../src/sidecar-client.js";
import { jsonObject } from "../src/wire-reads.js";
import { parseWire } from "./test-support.js";
import type { WireObject } from "../src/wire-types.js";

const NULL_PARENT_OPERATIONS = [
  { type: "create_layer", target: { compositionId: "comp-main", layerId: "__new__:ctrl" }, layerType: "null", name: "Wiggle Null" },
  { type: "set_layer_parent", target: { compositionId: "comp-main", layerId: "layer-title" }, parentLayerId: "__new__:ctrl" },
  { type: "set_expression", target: { compositionId: "comp-main", layerId: "__new__:ctrl", propertyPath: "ADBE Transform Group/ADBE Position" }, source: "wiggle(2, 30)", enabled: true },
];

test("the benchmark scenarios exist with the shapes the harness depends on", () => {
  assert.equal(scenarioById("smoke-red-solid-then-undo").asset, "empty-ident");
  assert.deepEqual(scenarioById("smoke-red-solid-then-undo").followUps, ["undo the last change"]);
  assert.equal(scenarioById("smoke-red-solid-then-undo").facts?.length, 2);
  assert.equal(scenarioById("null-parent-wiggle").asset, "summer-launch");
  assert.equal(scenarioById("rocket-orbit").asset, "empty-portrait-6s");
  assert.match(compositionAsset("empty-portrait-6s").description, /1620x1350, 6s/);
  scenarioById("title-slide-and-fade");
  scenarioById("title-ident-from-scratch");
});

test("a prompt body splits into turns and rejects unknown facts", () => {
  const text = "---\nid: two-turns\nasset: empty-ident\nfacts: [[\"no-composition:X\"],[]]\n---\nfirst\n--- next turn ---\nsecond\n";
  const { scenario } = parsePrompt(text);
  assert.equal(scenario.message, "first");
  assert.deepEqual(scenario.followUps, ["second"]);
  assert.throws(() => parsePrompt(text.replace("no-composition:X", "bogus:X")), /known project facts/);
});

test("project facts see the parent, the expression and the null on the fake host", () => {
  const initial = fixtureSnapshotFromProbe(compositionAsset("summer-launch").probe);
  const facts = ["parent-is-null:layer-title", "parent-null-expression:layer-title:wiggle"];
  assert.equal(factFailures(facts, { snapshot: initial, initial }).length, 2);
  const result = applyOperationsToFixture({ snapshot: initial, operations: NULL_PARENT_OPERATIONS });
  assert.deepEqual(result.verdicts.filter((verdict) => !verdict.ok), []);
  assert.deepEqual(factFailures(facts, { snapshot: result.snapshot, initial }), []);
  assert.equal(factFailures(["parent-null-expression:layer-title:shake"], { snapshot: result.snapshot, initial }).length, 1);
  assert.equal(factFailures(["compositions-unchanged"], { snapshot: result.snapshot, initial }).length, 0);
});

test("comp-with-solid and no-composition track a created and an undone comp", () => {
  const initial = fixtureSnapshotFromProbe(compositionAsset("empty-ident").probe);
  const built = applyOperationsToFixture({ snapshot: initial, operations: [
    { type: "create_composition", newCompositionId: "__new__:c", name: "Smoke", width: 1920, height: 1080, durationSeconds: 10, frameRate: 30 },
    { type: "create_layer", target: { compositionId: "__new__:c", layerId: "__new__:s" }, layerType: "solid", name: "Red", color: [1, 0, 0], size: [1920, 1080] },
  ] });
  assert.deepEqual(built.verdicts.filter((verdict) => !verdict.ok), []);
  assert.deepEqual(factFailures(["comp-with-solid:Smoke"], { snapshot: built.snapshot, initial }), []);
  assert.equal(factFailures(["no-composition:Smoke"], { snapshot: built.snapshot, initial }).length, 1);
  assert.equal(factFailures(["comp-with-solid:Smoke", "no-composition:Smoke"], { snapshot: initial, initial }).length, 1);
});

test("usage is main-only with a step-derived call count before the sidecar reports roles, and per role after", () => {
  const before = turnUsage({ usage: { inputTokens: 1000, cachedInputTokens: 400, outputTokens: 50 }, turnRow: undefined, steps: 7 });
  assert.deepEqual(before, { roles: { main: { calls: 7, freshInputTokens: 600, cachedInputTokens: 400, outputTokens: 50 } }, callsBasis: "steps" });
  const none = turnUsage({ usage: undefined, turnRow: undefined, steps: undefined });
  assert.equal(none.callsBasis, "none");
  assert.equal(none.roles.main?.calls, null);
  const after = turnUsage({
    usage: {
      inputTokens: 10,
      byRole: {
        main: { calls: 3, inputTokens: 100, cachedInputTokens: 60, outputTokens: 5 },
        motion: { calls: 1, inputTokens: 20, cachedInputTokens: 0, outputTokens: 2 },
      },
    },
    turnRow: undefined,
    steps: 9,
  });
  assert.equal(after.callsBasis, "reported");
  assert.deepEqual(after.roles.motion, { calls: 1, freshInputTokens: 20, cachedInputTokens: 0, outputTokens: 2 });
  assert.equal(after.roles.main?.freshInputTokens, 40);
  const fromLog = turnUsage({ usage: undefined, turnRow: { modelCalls: 4, inputTokens: 5, outputTokens: 1, cachedInputTokens: 0 }, steps: 2 });
  assert.equal(fromLog.roles.main?.calls, 4);
});

function twoTurnRun(): ScenarioRun {
  const report = (answer: string, usage: WireObject, steps: number) => ({ status: 200, outcome: "planned", steps, answer, notes: [], tools: [], plans: [], usage, durationMs: 1500 });
  const one = report("built", { inputTokens: 1000, cachedInputTokens: 250, outputTokens: 80, totalTokens: 1080 }, 5);
  const two = report("undone", { inputTokens: 500, cachedInputTokens: 0, outputTokens: 20, totalTokens: 520, byRole: { main: { calls: 2, inputTokens: 400, cachedInputTokens: 0, outputTokens: 15 }, motion: { calls: 1, inputTokens: 100, cachedInputTokens: 0, outputTokens: 5 } } }, 3);
  return {
    scenario: scenarioById("smoke-red-solid-then-undo"), logLines: [], failures: ["turn 2: no-composition:Smoke: composition \"Smoke\" still exists"],
    report: { ...two, durationMs: 3000 },
    turns: [
      { index: 1, message: "a", report: one, logLines: [], factFailures: [], passed: true },
      { index: 2, message: "b", report: two, logLines: [], factFailures: ["no-composition:Smoke: composition \"Smoke\" still exists"], passed: false },
    ],
  };
}

test("a ledger row records pass/fail, calls, fresh/cached/output tokens and wall time per role and per turn", () => {
  const row = ledgerRow(twoTurnRun(), { runId: "r", evidenceMode: "headless-fixture-readback" }, { git: null, dirty: null });
  assert.equal(row.schemaVersion, "0.2");
  assert.equal(row.turns.length, 2);
  assert.deepEqual(row.turns.map((turn) => turn.passed), [true, false]);
  assert.deepEqual(row.turns.map((turn) => turn.wallMs), [1500, 1500]);
  assert.deepEqual(row.turns[0]?.usageByRole.main, { calls: 5, freshInputTokens: 750, cachedInputTokens: 250, outputTokens: 80 });
  assert.deepEqual(row.usageByRole.main, { calls: 7, freshInputTokens: 1150, cachedInputTokens: 250, outputTokens: 95 });
  assert.deepEqual(row.modelCalls, { total: 8, byRole: { main: 7, motion: 1 }, basis: "reported" });
  assert.equal(row.timing.totalMs, 3000);
  const path = join(mkdtempSync(join(tmpdir(), "ledger-")), "l.jsonl");
  appendLedger(path, [row]);
  assert.equal(readLedger(path)[0]?.runtime.evidenceMode, "headless-fixture-readback");
  const summary = ledgerSummary(readLedger(path));
  assert.match(summary, /smoke-red-solid-then-undo: FAIL, 8 call\(s\) \[reported\], 3\.0s/);
  assert.match(summary, /turn 2: FAIL/);
  assert.match(summary, /motion: 1 call\(s\)/);
});

test("a schema 0.1 ledger row still reads, as one main-only turn with unknown calls", () => {
  const row = ledgerRow(twoTurnRun(), { runId: "r", evidenceMode: "planning-only" }, { git: null, dirty: null });
  const { modelCalls: _calls, usageByRole: _roles, turns: _turns, ...legacy } = row;
  const path = join(mkdtempSync(join(tmpdir(), "ledger-")), "old.jsonl");
  writeFileSync(path, `${JSON.stringify({ ...legacy, schemaVersion: "0.1" })}\n`);
  const [read] = readLedger(path);
  assert.equal(read?.modelCalls.total, null);
  assert.equal(read?.usageByRole.main?.freshInputTokens, 500);
});

test("installPluginEndpoint copies native.json without a pid that discovery would call stale", () => {
  const directory = mkdtempSync(join(tmpdir(), "endpoint-"));
  const source = join(directory, "remote-native.json");
  writeFileSync(source, JSON.stringify({ port: 49152, token: "t0ken", pid: 2147483646, aeVersion: "26.5" }));
  assert.equal(readPluginEndpoint(source).ok, false, "the original is rejected as stale here");
  const target = installPluginEndpoint(source, join(directory, "state"));
  assert.ok(!("pid" in jsonObject(parseWire(readFileSync(target, "utf8")), "the installed endpoint")));
  const found = readPluginEndpoint(target);
  assert.equal(found.ok && found.endpoint.port, 49152);
  assert.throws(() => installPluginEndpoint(join(directory, "missing.json"), join(directory, "state")), /--plugin-endpoint/);
});

function idleWorkflowServer(): ReturnType<typeof createServer> {
  return createServer((_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        projection: {
          resumeSupported: false,
          activeJobId: null,
          activeDispatchLease: null,
          jobs: [],
          stages: [],
          batches: [],
          providerFailures: [],
          divergences: [],
          continuation: null,
        },
      }),
    );
  });
}

type Sent = Array<{ requestId: string; message: string; history?: Array<{ role: string; content: string }> }>;

function stubSidecar(port: number, sent: Sent): SidecarHandle {
  return {
    port, token: "x", isolatedHome: tmpdir(), seeded: [], profileSource: tmpdir(), logLines: [],
    publishSnapshot: async () => ({ status: 200, body: {} }),
    chat: async (body) => { sent.push(body); return { status: 200, body: { outcome: "answered", answer: `reply ${sent.length}`, steps: 2, plans: [], tools: [], notes: [], usage: { inputTokens: 10, outputTokens: 1, cachedInputTokens: 0, totalTokens: 11 } } }; },
    progress: async () => null, catalogue: async () => null, latestStamp: async () => ({ epoch: 1, revision: 1 }),
    patchPrefs: async () => undefined, callTool: async () => ({}), stop: async () => undefined,
  };
}

function assertTwoTurnRun(run: ScenarioRun | undefined, sent: Sent): void {
  assertSecondTurnSent(sent);
  assertTwoTurnReport(run);
}

function assertSecondTurnSent(sent: Sent): void {
  assert.equal(sent.length, 2);
  assert.equal(sent[1]?.message, "undo the last change");
  assert.deepEqual(sent[1]?.history, [{ role: "user", content: "make a 1920x1080 10 s comp named Smoke with a red solid" }, { role: "assistant", content: "reply 1" }]);
}

function assertTwoTurnReport(run: ScenarioRun | undefined): void {
  assert.equal(run?.turns?.length, 2);
  assert.equal(run?.report?.steps, 4);
  assert.ok(run?.skippedChecks?.some((note) => /skipped on real plugin/.test(note)));
  assert.deepEqual(run?.failures.filter((failure) => /^turn \d: /.test(failure)), [], "skipped facts must not fail the run");
}

test("a two-turn scenario sends the first turn as history and records both turns on a real-plugin run", async () => {
  const server = idleWorkflowServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const sent: Sent = [];
  const handle = stubSidecar(typeof address === "object" && address ? address.port : 0, sent);
  try {
    const [run] = await runScenarios(["smoke-red-solid-then-undo"], { kind: "live", environment: {} }, { quiet: true, pluginEndpoint: "unused.json", start: async () => handle });
    assertTwoTurnRun(run, sent);
  } finally {
    server.close();
  }
});
