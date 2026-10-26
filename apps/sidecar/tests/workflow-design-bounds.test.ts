/**
 * The scene designer reports what its turns did, stays within a drawing budget, fails fast with a way out,
 * never blocks the owner's status, and the sidecar builds the remaining groups of a drawing itself.
 */
import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { MockProvider, type AgentStepInput, type AgentStepResult } from "@extynt/llm";
import { WORKFLOW_DESIGN_TOOL } from "../src/agent.js";
import { DESIGN_SVG_CHAR_BUDGET, WORKFLOW_OWNER } from "../src/workflow-orchestration.js";
import { awaitRunningSpecialist } from "../src/server-workflow-specialists.js";
import { continueDesignBuild } from "../src/server-workflow-design-continue.js";
import type { ToolArguments } from "../src/agent-types.js";
import type { JsonObject } from "@extynt/decode";
import { objectOf, payload, type ToolResult } from "../src/server-workflow-operation-json.js";
import { jsonFieldsOf } from "@extynt/mcp-server";
import type { AgentLogLine } from "../src/agent-types.js";
import { fieldOf, type JsonObject as LogLine } from "./http-json.js";
import { DESIGN_SVG, designerTurn, mutableSnapshot, seedDesign, settledDesigner, sidecarFor, token } from "./sidecar-fixture.js";

function dataOf(result: ToolResult): JsonObject {
  const found = payload(result);
  assert.ok(found);
  return found;
}

function childOf(object: JsonObject, key: string): JsonObject {
  const found = objectOf(object[key]);
  assert.ok(found);
  return found;
}

type Script = (step: AgentStepInput) => AgentStepResult | Promise<AgentStepResult>;

function drawings(...svgs: string[]): Script {
  return (step) => {
    const sent = step.messages.filter((message) => message.role === "tool").length;
    return svgs[sent] === undefined ? { text: "Built the scene as asked.", toolCalls: [] } : { text: "", toolCalls: [{ id: `build-${sent}`, name: "ae_build_drawing", arguments: { svg: svgs[sent] } }] };
  };
}

function setup(requestId: string, script: Script) {
  const provider = new MockProvider({ script });
  const sidecar = sidecarFor({ token, chatProvider: provider, workflowSpecialistProviders: { "visual-scene": provider }, quietAgentLog: true });
  sidecar.latest = { snapshot: mutableSnapshot(requestId), receivedAt: "2026-09-24T15:00:00.000Z", bytes: 1 };
  const lines: LogLine[] = [];
  const input = { requestId, message: "A planet with a ring", history: [], autoApply: false, workflowJobId: requestId, workflowGoalSummary: "A planet with a ring", workflowRole: WORKFLOW_OWNER, log: (line: AgentLogLine) => { lines.push(jsonFieldsOf(line)); } };
  return { sidecar, input, provider, lines };
}

async function launch(sidecar: ReturnType<typeof setup>["sidecar"], input: ReturnType<typeof setup>["input"]) {
  await sidecar.runAgentTool("ae_consult_specialist", { action: "launch", role: "visual-scene", instruction: "Design and draw the scene." }, input, {});
}

async function status(sidecar: ReturnType<typeof setup>["sidecar"], input: ReturnType<typeof setup>["input"]): Promise<JsonObject> {
  const result = await settledDesigner(sidecar, input, "wait");
  assert.equal(result.ok, true);
  return result.ok ? dataOf(result) : {};
}

function toolAnswer(provider: MockProvider, call: number): string {
  const tools = provider.stepInputs.at(-1)?.messages.filter((message) => message.role === "tool") ?? [];
  return String(tools[call]?.content);
}

test("1: every specialist turn is logged with its outcome, steps and cost", async () => {
  const { sidecar, input, lines } = setup("hd-log", (step) => ({ ...designerTurn(step), usage: { inputTokens: 500, outputTokens: 50 } }));
  await launch(sidecar, input);
  await status(sidecar, input);
  const line = lines.find((entry) => entry.event === "agent.specialist");
  assert.ok(line);
  assert.equal(line.outcome, "completed");
  assert.equal(line.role, "visual-scene");
  assert.equal(line.turn, 1);
  assert.equal(line.reason, null);
  assert.equal(line.steps, 2);
  assert.equal(line.inputTokens, 1000);
  assert.equal(line.outputTokens, 100);
  assert.equal(typeof line.ms, "number");
});

test("2: a failed designer answers ae_queue_design at once with its reason and the remedy", async () => {
  const { sidecar, input, lines } = setup("hd-failed", () => { throw new Error("the model is down"); });
  await launch(sidecar, input);
  const data = await status(sidecar, input);
  assert.equal(data.status, "failed");
  assert.match(String(data.reason), /model is down/);
  assert.match(String(data.remedy), /Relaunch/);
  const started = Date.now();
  const built = await sidecar.runAgentTool("ae_queue_design", {}, input, {});
  assert.ok(Date.now() - started < 1_000, "no wait");
  assert.equal(built.ok, false);
  assert.equal(built.ok ? "" : built.error.code, "DESIGN_FAILED");
  assert.match(built.ok ? "" : built.error.message, /data-repeat/);
  assert.equal(lines.find((entry) => entry.event === "agent.specialist")?.outcome, "failed");
});

test("3: a drawing past the character budget is refused with a data-repeat reason, and the designer redraws it smaller", async () => {
  const stars = Array.from({ length: 3000 }, (_, index) => `<path d="M ${index} 0 L ${index} 1" stroke="#fff"/>`).join("");
  const { sidecar, input, provider } = setup("hd-budget", drawings(`<svg viewBox="0 0 1920 1080"><g id="Stars">${stars}</g></svg>`, DESIGN_SVG));
  await launch(sidecar, input);
  const data = await status(sidecar, input);
  assert.equal(data.status, "sleeping");
  assert.match(toolAnswer(provider, 0), /DRAWING_TOO_LARGE.*data-repeat/s);
  assert.doesNotMatch(toolAnswer(provider, 1), /DRAWING_TOO_LARGE/);
  assert.ok(DESIGN_SVG_CHAR_BUDGET <= 24_000);
});

test("3: a drawing of drawn copies past the element budget is refused even under the character budget", async () => {
  const dots = Array.from({ length: 400 }, (_, index) => `<circle cx="${index}" cy="9" r="2" fill="#fff"/>`).join("");
  const { sidecar, input, provider } = setup("hd-elements", drawings(`<svg viewBox="0 0 1920 1080"><g id="Stars">${dots}</g></svg>`));
  await launch(sidecar, input);
  await status(sidecar, input);
  assert.match(toolAnswer(provider, 0), /drawn elements/);
});

test("3: the designer's role instructions require data-scatter for stars, data-repeat for rows and a budget, and name its tools", async () => {
  const { sidecar, input, provider } = setup("hd-rules", designerTurn);
  await launch(sidecar, input);
  await status(sidecar, input);
  const system = provider.stepInputs[0]?.system ?? "";
  assert.match(system, /ONE small <circle> in a group with data-scatter="N"/);
  assert.match(system, /data-repeat is only for regular rows, rings and spokes/);
  assert.match(system, /characters/);
  assert.match(system, /ae_build_drawing.*ae_check_drawing.*ae_redraw_layers/s);
  assert.deepEqual(provider.stepInputs[0]?.tools.map((tool) => tool.name), ["ae_build_drawing", "ae_check_drawing", "ae_redraw_layers"], "a small tool set and nothing else");
  assert.doesNotMatch(system, /exactly these fields|handoff/, "no JSON handoff is asked for");
});

test("A: the designer's step carries no fixed turn budget, and the owner's wait ending does not stop it", async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let stopped = false;
  const { sidecar, input, provider } = setup("hd-wait", async (step) => { await gate; stopped = step.signal?.aborted === true; return designerTurn(step); });
  await launch(sidecar, input);
  assert.equal(fieldOf(provider.stepInputs[0], "timeoutMs"), undefined, "no fixed turn budget: the provider's stall window is the only timer");
  assert.equal(provider.stepInputs[0]?.forceStream, true, "the drawing streams");
  const deps = { state: sidecar, transport: { notifyChange: () => undefined } };
  const session = sidecar.workflowSpecialistSessions.get(sidecar.workflowCoordinator.jobIdForSeed(input.workflowJobId))?.get("visual-scene");
  assert.ok(session?.pending);
  await awaitRunningSpecialist(deps, input, session, 0.05);
  assert.ok(session.pending, "still drawing after the owner's wait ended");
  release();
  const data = await status(sidecar, input);
  assert.equal(data.status, "sleeping");
  assert.equal(stopped, false);
});

test("the designer's first status or wait returns at once while it works, and ae_queue_design does not wait for it", async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const { sidecar, input } = setup("hd-nonblocking", async (step) => { await gate; return designerTurn(step); });
  const launched = await sidecar.runAgentTool("ae_consult_specialist", { action: "launch", role: "visual-scene", instruction: "Draw." }, input, {});
  assert.match(String(fieldOf(launched.ok ? launched.data : undefined, "next")), /building its scene itself/);
  for (const action of ["status", "wait"]) {
    const started = Date.now();
    const reply = await sidecar.runAgentTool("ae_consult_specialist", { action, role: "visual-scene", waitSeconds: 240 }, input, {});
    const data = dataOf(reply);
    assert.ok(Date.now() - started < 1_000, `${action} must not block`);
    assert.equal(data.status, "running");
    assert.equal(data.handoff, undefined);
    const started2 = Date.now();
    const queued = await sidecar.runAgentTool("ae_queue_design", {}, input, {});
    assert.ok(Date.now() - started2 < 1_000, "ae_queue_design does not wait either");
    assert.equal(queued.ok ? "" : queued.error.code, "DESIGN_PENDING");
  }
  release();
  assert.equal((await status(sidecar, input)).status, "sleeping");
});

test("C: stars drawn as one open stroked path are sent back to be drawn as circles", async () => {
  const web = `<svg viewBox="0 0 1920 1080"><g id="Stars"><path d="M 1 1 L 50 90 L 300 20 L 80 400 L 700 100 L 20 800 L 900 5 L 40 40" fill="none" stroke="#fff" stroke-linecap="round"/></g></svg>`;
  const { sidecar, input, provider } = setup("hd-web", drawings(web, DESIGN_SVG));
  await launch(sidecar, input);
  const data = await status(sidecar, input);
  assert.equal(data.status, "sleeping");
  assert.match(toolAnswer(provider, 0), /DRAWING_INVALID.*Draw each star as a <circle>/s);
  assert.equal(provider.calls, 3, "two builds and the report");
});

test("D: a drawing that cannot compile is answered with the compiler's reason", async () => {
  const { sidecar, input, provider } = setup("hd-broken", drawings('<svg viewBox="0 0 1920 1080"><g id="Planet"><circle cx="960" cy="540" r="150" fill="#3355cc"></g></svg>'));
  await launch(sidecar, input);
  await status(sidecar, input);
  assert.match(toolAnswer(provider, 0), /did not compile \(SVG_INVALID\)/);
});

test("5 and 6: the designer's status is a compact summary: its report, the layers built and the compiled scene", async () => {
  const { sidecar, input } = setup("hd-read", designerTurn);
  await launch(sidecar, input);
  const summary = await status(sidecar, input);
  assert.equal(summary.stream, undefined, "the drawing is not echoed");
  assert.doesNotMatch(JSON.stringify(summary), /<svg|<path/);
  const handoff = childOf(summary, "handoff");
  assert.deepEqual(Object.keys(handoff).sort(), ["built", "report", "role", "scene"]);
  assert.equal(childOf(handoff, "scene").order, "bottom-to-top");
  assert.match(String(handoff.report), /Built Ring Back, Planet and Ring Front/);
});

test("4: after a clean settle the sidecar queues and seals the rest of the drawing itself", async () => {
  const { sidecar, input } = setup("hd-continue", designerTurn);
  seedDesign(sidecar, input.workflowJobId);
  const coordinator = sidecar.workflowCoordinator;
  const jobId = coordinator.jobIdForSeed(input.workflowJobId);
  const drawing = sidecar.workflowSpecialistSessions.get(jobId)?.get("visual-scene");
  assert.ok(drawing);
  const real = coordinator.workflowStore.getState();
  const settled = { lifecycle: "settled", execution: { state: "executed" }, verification: { state: "verified" } };
  const withBatch = (batch: typeof settled): typeof real => Object.assign({}, real, { jobs: Object.assign({}, real.jobs, { [jobId]: Object.assign({}, real.jobs[jobId], { batchIds: ["b1"] }) }), batches: { b1: batch } });
  mock.method(coordinator.workflowStore, "getState", () => withBatch(settled));
  const calls: string[] = [];
  const state = {};
  const deps = { state: sidecar, planState: sidecar };
  const run = async (name: string, args: ToolArguments) => {
    calls.push(name);
    return name === WORKFLOW_DESIGN_TOOL ? sidecar.runAgentTool(name, args, input, state) : { ok: true as const, tool: name, snapshotFingerprint: null, data: { sealed: true } };
  };
  const finished = { ok: true as const, tool: "ae_queue_finish", snapshotFingerprint: null, continuesLoop: true, data: { receipt: {} } };
  assert.equal(await continueDesignBuild(deps, { name: "ae_queue_finish", input, state, result: finished }, run), undefined, "an owner that never used ae_queue_design is left alone");
  assert.deepEqual(calls, []);
  drawing.designBuilt = ["Backdrop"];
  const continued = await continueDesignBuild(deps, { name: "ae_queue_finish", input, state, result: finished }, run);
  assert.deepEqual(calls, [WORKFLOW_DESIGN_TOOL, "ae_queue_finish"]);
  assert.ok(continued);
  const built = childOf(dataOf(continued), "sidecarBuilt");
  assert.deepEqual(built.layers, ["Ring Back", "Planet", "Ring Front"]);
  mock.method(coordinator.workflowStore, "getState", () => withBatch({ ...settled, verification: { state: "failed" } }));
  calls.length = 0;
  assert.equal(await continueDesignBuild(deps, { name: "ae_queue_finish", input, state, result: finished }, run), undefined);
  assert.equal(await continueDesignBuild(deps, { name: "ae_queue_add", input, state, result: finished }, run), undefined);
  assert.deepEqual(calls, []);
  mock.restoreAll();
});

test("a back-to-back second designer poll blocks until it finishes; a poll after another tool call returns at once", async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const { sidecar, input } = setup("hd-repeat-poll", async (step) => { await gate; return designerTurn(step); });
  await launch(sidecar, input);
  const poll = () => sidecar.runAgentTool("ae_consult_specialist", { action: "status", role: "visual-scene" }, input, {});
  const first = await poll();
  assert.equal(dataOf(first).status, "running", "the first poll returns at once");
  let settled = false;
  const second = poll().then((reply) => { settled = true; return reply; });
  await new Promise((resolve) => { setTimeout(resolve, 100); });
  assert.equal(settled, false, "the repeat poll is still waiting for the designer");
  release();
  const done = dataOf(await second);
  assert.equal(done.status, "sleeping", "it returns the finished result");
});

test("a designer poll after another owner tool call is a first poll again", async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const { sidecar, input } = setup("hd-poll-after-work", async (step) => { await gate; return designerTurn(step); });
  await launch(sidecar, input);
  const poll = () => sidecar.runAgentTool("ae_consult_specialist", { action: "status", role: "visual-scene" }, input, {});
  await poll();
  await sidecar.runAgentTool("ae_queue_design", {}, input, {});
  const started = Date.now();
  const again = await poll();
  assert.ok(Date.now() - started < 1_000, "no block after other work");
  assert.equal(dataOf(again).status, "running");
  release();
  assert.equal((await status(sidecar, input)).status, "sleeping");
});
