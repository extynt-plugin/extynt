// Tests that persisted specialist handoffs decode to exact values, drop malformed state, and never widen workflow authority across a restart.

import { jsonOf } from "@extynt/mcp-server";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { decodeOrThrow, isJsonArray, isJsonObject, type JsonValue, jsonValue } from "@extynt/decode";
import { createInMemoryWorkflowStore } from "@extynt/workflow";
import { SidecarState } from "../src/server-state.js";
import { parseWorkflowHandoffs } from "../src/workflow-handoff-parse.js";
import { handoffAt, handoffBundle, handoffPayload, handoffRoles, handoffSession } from "./workflow-handoff-fixture.js";

function roundTrip(serialized: string): JsonValue { return decodeOrThrow(jsonValue, JSON.parse(serialized)); }

function withReplacement(node: JsonValue, path: readonly string[], replacement: JsonValue): JsonValue {
  const [key, ...rest] = path;
  if (key === undefined) return replacement;
  if (isJsonArray(node)) return node.map((child, index) => (index === Number(key) ? withReplacement(child, rest, replacement) : child));
  if (!isJsonObject(node)) throw new Error(`no container at ${key}`);
  return { ...node, [key]: withReplacement(node[key] ?? null, rest, replacement) };
}

function replaceAt(path: readonly string[], replacement: JsonValue): JsonValue {
  return withReplacement(roundTrip(JSON.stringify(handoffPayload())), path, replacement);
}

function directory(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), "extynt-handoff-parse-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function stateAt(t: TestContext, root: string): SidecarState {
  const state = new SidecarState({ token: "handoff-token", stateDirectory: root, now: () => new Date(handoffAt) });
  t.after(() => { state.collection.close(); state.workflowCoordinator.close(); });
  return state;
}

test("persisted v1 bundles and all transcript variants keep exact valid values", () => {
  for (const mode of ["delegated", "partial", "single-agent-fallback"] as const) {
    const bundle = handoffBundle(mode);
    const original = handoffPayload();
    original.orchestrations.job = bundle;
    const parsed = parseWorkflowHandoffs(roundTrip(JSON.stringify(original)));
    assert.ok(parsed);
    assert.deepEqual(parsed.orchestrations.get("job"), bundle);
    for (const role of handoffRoles) assert.deepEqual(parsed.sessions.get("job")?.get(role), handoffSession(role));
  }
});

test("empty fallback arrays and minimal untouched specialist sessions remain valid", () => {
  const bundle = handoffBundle("single-agent-fallback");
  bundle.specialists = [];
  bundle.unavailable = [];
  delete bundle.activity;
  const session = { role: "motion", turns: 0, messages: [] };
  const parsed = parseWorkflowHandoffs(jsonOf({ version: 1, orchestrations: { job: bundle }, sessions: { job: { motion: session } } }));
  assert.deepEqual(parsed?.orchestrations.get("job"), bundle);
  assert.deepEqual(parsed?.sessions.get("job")?.get("motion"), session);
});

test("handoff envelopes reject null, arrays, wrong versions, and array dictionaries", () => {
  const invalid = [null, [], 1, "v1", {}, { version: 2, orchestrations: {}, sessions: {} }, { version: 1, orchestrations: [], sessions: {} }, { version: 1, orchestrations: {}, sessions: [] }];
  for (const value of invalid) assert.equal(parseWorkflowHandoffs(value), undefined);
});

test("invalid required bundles are skipped while valid sessions remain intact", () => {
  const cases: Array<[string[], JsonValue]> = [
    [[], []], [["owner"], "execution"], [["mode"], "unknown"], [["specialists"], [null]],
    [["specialists", "0"], {}], [["unavailable", "0", "role"], "owner"], [["unavailable", "0", "reason"], 7],
    [["handoff", "submissionPolicy"], "specialist-only"], [["handoff", "requiredEvidenceKinds"], ["other"]],
    [["handoff", "sceneLayerManifest"], [7]], [["activity", "0", "status"], "sleeping"],
  ];
  for (const [path, value] of cases) {
    const parsed = parseWorkflowHandoffs(replaceAt(["orchestrations", "job", ...path], value));
    assert.equal(parsed?.orchestrations.size, 0, path.join("."));
    assert.equal(parsed?.sessions.get("job")?.size, 3);
  }
});

test("null messages, empty briefs, arrays, and invalid counters never fabricate sessions", () => {
  const cases: Array<[string[], JsonValue]> = [
    [[], []], [[], {}], [["turns"], "2"], [["turns"], 1.5], [["messages"], [null]], [["messages"], {}],
    [["messages", "0", "content"], {}], [["messages", "0", "role"], "system"],
    [["messages", "2", "toolCallId"], null], [["messages", "2", "name"], 7], [["brief"], {}],
    [["brief", "requirements"], [false]], [["activity", "reasoning"], []], [["error"], {}],
    [["generation"], "0"], [["ownerSeenTurn"], null], [["ownerWokenTurn"], []], [["role"], "execution"],
  ];
  for (const [path, value] of cases) {
    const parsed = parseWorkflowHandoffs(replaceAt(["sessions", "job", "motion", ...path], value));
    assert.equal(parsed?.sessions.get("job")?.has("motion"), false, path.join("."));
    assert.equal(parsed?.sessions.get("job")?.size, 2);
    assert.equal(parsed?.orchestrations.size, 1);
  }
});

test("manifest validation reaches positions, bounds, colors, and optional fields", () => {
  const cases: Array<[string[], JsonValue]> = [
    [["canvas"], [100]], [["order"], "top-to-bottom"], [["layers"], [null]],
    [["layers", "0", "position"], [0, "25"]], [["layers", "0", "bounds"], [0, 0, 10]],
    [["layers", "0", "colors"], [7]], [["layers", "0", "shapes"], "2"],
    [["layers", "0", "opacity"], null], [["layers", "0", "gradient"], []],
    [["layers", "0", "companion"], {}], [["layers", "0", "effects"], [false]], [["layers", "0", "blendMode"], 1],
    [["warnings"], [null]],
  ];
  for (const [path, value] of cases) {
    const parsed = parseWorkflowHandoffs(replaceAt(["sessions", "job", "visual-scene", "brief", "scene", ...path], value));
    assert.equal(parsed?.sessions.get("job")?.has("visual-scene"), false, path.join("."));
  }
});

test("drawing validation reaches shapes, paths, paints, ramps, clips, and effects", () => {
  const cases: Array<[string[], JsonValue]> = [
    [["svg"], {}], [["compositionId"], 1], [["compiledAt"], null], [["targetCompositionPlaceholder"], []],
    [["scene", "width"], "100"], [["scene", "layers"], [null]], [["scene", "warnings"], [false]],
    [["scene", "layers", "0", "anchor"], [0]], [["scene", "layers", "0", "opacity"], null],
    [["scene", "layers", "0", "shapes", "0", "paths", "0", "vertices"], [[0, "1"]]],
    [["scene", "layers", "0", "shapes", "0", "paths", "0", "inTangents"], [[0]]],
    [["scene", "layers", "0", "shapes", "0", "paths", "0", "closed"], "false"],
    [["scene", "layers", "0", "shapes", "0", "fill", "color"], [0, 1]],
    [["scene", "layers", "0", "shapes", "0", "fill", "rule"], "invalid"],
    [["scene", "layers", "0", "shapes", "0", "stroke", "cap"], "invalid"],
    [["scene", "layers", "0", "shapes", "0", "stroke", "width"], []],
    [["scene", "layers", "0", "ramp", "endColor"], [0, false, 1]],
    [["scene", "layers", "0", "clipPath", "paths"], [null]],
    [["scene", "layers", "0", "effect", "kind"], ["gaussian-blur"]],
    [["scene", "layers", "0", "effect", "blur", "stdDeviation"], {}],
    [["scene", "layers", "1", "effect", "shadow", "floodColor"], [0, 0]],
    [["scene", "layers", "2", "effect", "glow", "stdDeviation"], null],
  ];
  for (const [path, value] of cases) {
    const parsed = parseWorkflowHandoffs(replaceAt(["sessions", "job", "visual-scene", "design", ...path], value));
    assert.equal(parsed?.sessions.get("job")?.has("visual-scene"), false, path.join("."));
    assert.equal(parsed?.sessions.get("job")?.has("motion"), true);
  }
});

test("unexpected provider and live-process fields are never restored", () => {
  const original = handoffSession("motion");
  const injected = { ...original, pending: {}, controller: {}, messages: [{ role: "assistant", content: "Advisory reply", toolCalls: null, raw: { provider: "untrusted" } }] };
  const parsed = parseWorkflowHandoffs(jsonOf({ version: 1, orchestrations: {}, sessions: { job: { motion: injected } } }));
  const restored = parsed?.sessions.get("job")?.get("motion");
  assert.ok(restored);
  assert.equal(restored.pending, undefined);
  assert.equal(restored.controller, undefined);
  assert.deepEqual(restored.messages, [{ role: "assistant", content: "Advisory reply" }]);
});

test("real v1 writer and restart preserve handoffs without changing workflow authority", (t) => {
  const root = directory(t);
  const first = stateAt(t, root);
  const jobId = first.workflowCoordinator.openJob("handoff-restart", "Animate scene");
  first.workflowOrchestrations.set(jobId, handoffBundle());
  first.workflowSpecialistSessions.set(jobId, new Map(handoffRoles.map((role) => [role, handoffSession(role)])));
  first.persistWorkflowHandoffs();
  const before = first.workflowCoordinator.workflowStore.listEvents(jobId);
  first.workflowCoordinator.close();
  const restarted = stateAt(t, root);
  assert.deepEqual(restarted.workflowOrchestrations.get(jobId), first.workflowOrchestrations.get(jobId));
  assert.deepEqual(restarted.workflowSpecialistSessions.get(jobId), first.workflowSpecialistSessions.get(jobId));
  const after = restarted.workflowCoordinator.workflowStore.listEvents(jobId);
  assert.deepEqual(after.slice(0, before.length), before);
  assert.deepEqual(after.slice(before.length).map((event) => event.type), ["job.blocked"]);
  assert.equal(restarted.workflowCoordinator.workflowStore.getState().jobs[jobId]?.blocker, "workflow:interrupted-before-completion");
  assert.equal(restarted.workflowCoordinator.workflowStore.getState().activeJobId, null);
  assert.equal(restarted.workflowRuns.size, 0);
  assert.equal(restarted.readyPlans.length, 0);
  assert.equal(restarted.inFlight, undefined);
  assert.equal(restarted.approvalRecords.size, 0);
  assert.equal(restarted.receipts.length, 0);
  assert.equal(restarted.workflowContinuationQueue.size, 0);
});

test("malformed advisory files restore no fabricated state and leave their bytes untouched", (t) => {
  const root = directory(t);
  const first = stateAt(t, root);
  const jobId = first.workflowCoordinator.openJob("handoff-malformed", "Advisory goal");
  first.workflowCoordinator.close();
  const payload = JSON.stringify({ version: 1, orchestrations: { [jobId]: [] }, sessions: { [jobId]: { motion: { role: "motion", turns: 1, messages: [null], brief: {} } } } });
  writeFileSync(join(root, "workflow-handoffs.json"), payload);
  const restarted = stateAt(t, root);
  assert.equal(restarted.workflowOrchestrations.size, 0);
  assert.equal(restarted.workflowSpecialistSessions.size, 0);
  assert.equal(readFileSync(join(root, "workflow-handoffs.json"), "utf8"), payload);
  assert.equal(restarted.workflowCoordinator.workflowStore.getState().jobs[jobId]?.status, "blocked");
  assert.equal(restarted.workflowCoordinator.workflowStore.getState().jobs[jobId]?.blocker, "workflow:interrupted-before-completion");
});

function driveJobTo(status: "open" | "active" | "blocked" | "cancelled", store: ReturnType<typeof createInMemoryWorkflowStore>, sidecar: SidecarState): void {
  if (status === "active") store.append({ type: "stage.opened", jobId: "job", stageId: "stage", eventId: "stage-opened", at: handoffAt, title: "Stage", purpose: "Prepare advisory context", successCriteria: [] });
  if (status === "blocked") sidecar.workflowCoordinator.blockJob("job", "advisory blocker");
  if (status === "cancelled") sidecar.workflowCoordinator.cancelJob("job");
}

test("eligible existing jobs alone restore advisory state", (t) => {
  for (const status of ["open", "active", "blocked", "cancelled"] as const) {
    const root = directory(t);
    const store = createInMemoryWorkflowStore();
    const first = new SidecarState({ token: "handoff-token", stateDirectory: root, workflowStore: store });
    store.append({ type: "job.opened", jobId: "job", eventId: "job-opened", at: handoffAt, engineId: "workflow-v1", title: "Open", goalSummary: "Advisory goal", successCriteria: [] });
    driveJobTo(status, store, first);
    assert.equal(store.getState().jobs.job?.status, status);
    const ids = ["job", "unknown-job"];
    writeFileSync(join(root, "workflow-handoffs.json"), JSON.stringify({ version: 1, orchestrations: Object.fromEntries(ids.map((id) => [id, handoffBundle()])), sessions: Object.fromEntries(ids.map((id) => [id, { motion: handoffSession("motion") }])) }));
    const before = store.serialize();
    const restored = new SidecarState({ token: "handoff-token", stateDirectory: root, workflowStore: store });
    if (status === "open" || status === "active") {
      assert.equal(store.getState().jobs.job?.status, "blocked");
      assert.equal(store.getState().jobs.job?.blocker, "workflow:interrupted-before-completion");
    } else assert.equal(store.serialize(), before);
    const expected = status === "cancelled" ? [] : ["job"];
    assert.deepEqual([...restored.workflowOrchestrations.keys()], expected);
    assert.deepEqual([...restored.workflowSpecialistSessions.keys()], expected);
    first.collection.close();
    restored.collection.close();
  }
});

test("handoff writes are coalesced, owner-only, and flushed when the store closes", async (t) => {
  const root = directory(t);
  const state = stateAt(t, root);
  const file = join(root, "workflow-handoffs.json");
  const jobId = state.workflowCoordinator.openJob("handoff-coalesce", "Animate scene");
  state.workflowOrchestrations.set(jobId, handoffBundle());
  state.workflowSpecialistSessions.set(jobId, new Map(handoffRoles.map((role) => [role, handoffSession(role)])));
  for (let update = 0; update < 50; update += 1) state.persistWorkflowHandoffs();
  assert.equal(existsSync(file), false, "an activity burst performs no synchronous write");
  await new Promise((resolve) => setTimeout(resolve, 450));
  assert.equal(existsSync(file), true, "one write lands shortly after the burst");
  assert.equal(statSync(file).mode & 0o777, 0o600, "specialist transcripts are owner-only");

  rmSync(file);
  state.persistWorkflowHandoffs();
  state.workflowCoordinator.close();
  assert.equal(existsSync(file), true, "stopping the sidecar flushes pending handoffs synchronously");
  assert.equal(statSync(file).mode & 0o777, 0o600);
});
