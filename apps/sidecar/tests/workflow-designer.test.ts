/**
 * The visual-scene designer builds and checks its own drawing: it submits an SVG, the sidecar builds it through the owner's queue path
 * (admission, seal, receipts, budgets) into the job's composition, and the designer may look at one frame and redraw its own layers once.
 */
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockProvider, type AgentStepInput, type AgentStepResult } from "@extynt/llm";
import { planRisk } from "../src/host/plan-risk.js";
import { jobCreatedIds } from "../src/host/job-created-ids.js";
import { WORKFLOW_OWNER } from "../src/workflow-orchestration.js";
import type { AgentCallState } from "../src/server-chat-agent-types.js";
import type { ToolArguments } from "../src/agent-types.js";
import { operationsOf } from "../src/server-workflow-design-receipts.js";
import { objectOf, targetLayerId, textOf as textIn } from "../src/server-workflow-operation-json.js";
import { fieldOf, listOf, parseJson, recordOf, textOf, type JsonObject } from "./http-json.js";
import { chatTurn, DESIGN_SVG, mutableSnapshot, settledDesigner, sidecarFor, token } from "./sidecar-fixture.js";
import { builtDesignLayers } from "../src/server-workflow-design-build.js";
import { post, rigWith, step } from "./single-loop-rig.js";
import { present } from "./agent-test-support.js";

const REPORT = "Composition Main (comp-1). Layers: Ring Back, Planet, Ring Front. No departures.";
const PLANET_ONLY = '<svg viewBox="0 0 1920 1080"><g id="Planet"><circle cx="960" cy="560" r="170" fill="#4466dd"/></g></svg>';
const INTRUDER = '<svg viewBox="0 0 1920 1080"><g id="Original"><circle cx="960" cy="560" r="170" fill="#ff0000"/></g></svg>';

const BUILT_THREE = Array.from({ length: 3 }, () => ["create_layer", "draw_vector_shapes", "set_layer_property"]).flat();

const compositionOf = (operation: ReturnType<typeof operationsOf>[number]) => textIn(objectOf(operation.target)?.compositionId);

type ReferenceImage = { mediaType: string; base64: string; name: string };

type Action = { name: string; args: ToolArguments } | string;

function steps(...actions: Action[]): (input: AgentStepInput) => AgentStepResult {
  return (input) => {
    const done = input.messages.filter((message) => message.role === "tool").length;
    const action = actions[done];
    const usage = { inputTokens: 100, outputTokens: 10 };
    const raw = { reasoning_content: `thinking before step ${done + 1}` };
    if (typeof action === "string" || action === undefined) return { text: action ?? REPORT, toolCalls: [], usage, raw };
    return { text: "", toolCalls: [{ id: `call-${done}`, name: action.name, arguments: action.args }], usage, raw };
  };
}

const build = (svg = DESIGN_SVG): Action => ({ name: "ae_build_drawing", args: { svg } });
const check = (): Action => ({ name: "ae_check_drawing", args: {} });
const redraw = (svg: string): Action => ({ name: "ae_redraw_layers", args: { svg } });

function ownerScript(after: Array<{ name: string; args: ToolArguments }>, seen: { messages: AgentStepInput["messages"] }) {
  return (input: AgentStepInput): AgentStepResult => {
    seen.messages = input.messages;
    const done = input.messages.filter((message) => message.role === "tool").length;
    if (done === 0) return step("launch", "ae_consult_specialist", { action: "launch", role: "visual-scene", instruction: "Draw the planet and its ring in Main (comp-1), 1920x1080, 10 s." });
    const woken = input.messages.some((message) => message.role === "user" && /Sidecar wake event/.test(message.content));
    const next = woken ? after[done - 1] : undefined;
    return next ? step(`after-${done}`, next.name, next.args) : { text: "Done.", toolCalls: [] };
  };
}

async function jobWith(t: TestContext, designer: MockProvider, batches: string[][], options: { stateDirectory?: string; freeRun?: boolean; images?: readonly ReferenceImage[]; after?: Array<{ name: string; args: ToolArguments }> } = {}) {
  const seen: { messages: AgentStepInput["messages"] } = { messages: [] };
  const rig = await rigWith(t, ownerScript(options.after ?? [], seen), "designer-job", batches, { workflowSpecialistProviders: { "visual-scene": designer }, ...(options.freeRun ? { workflowFreeRun: true } : {}), ...(options.stateDirectory ? { stateDirectory: options.stateDirectory } : {}) });
  rig.bindCreated = true;
  await chatTurn(rig.address, "Draw a planet with a ring", [], { autoApply: true, ...(options.images ? { images: options.images } : {}) });
  return { rig, seen };
}

const ownerInput = (id: string, message: string, autoApply: boolean) => ({ requestId: id, message, history: [], autoApply, workflowJobId: id, workflowGoalSummary: message, workflowRole: WORKFLOW_OWNER });

function toolText(messages: AgentStepInput["messages"], call: number): string {
  return String(messages.filter((message) => message.role === "tool")[call]?.content).replace(/\n\[Budget:[^\]]*\]$/u, "");
}

function text(designer: MockProvider, call: number): string {
  return toolText(designer.stepInputs.at(-1)?.messages ?? [], call);
}

function answerIn(messages: AgentStepInput["messages"], call: number): JsonObject {
  const content = toolText(messages, call);
  const parsed = recordOf(parseJson(content), "");
  return parsed.data === undefined ? parsed : recordOf(parsed, "data");
}

function answer(designer: MockProvider, call: number): JsonObject {
  return answerIn(designer.stepInputs.at(-1)?.messages ?? [], call);
}

test("the designer builds its drawing into the job's composition and reports the layers with their ids", async (t) => {
  const designer = new MockProvider({ script: steps(build()) });
  const { rig } = await jobWith(t, designer, [["create_layer"]]);
  assert.equal(rig.applied.length, 1, "one sealed batch applied: the same queue path the owner's build takes");
  const plan = rig.sidecar.plans.get(present(rig.applied[0]));
  assert.ok(plan);
  const operations = operationsOf(plan);
  assert.deepEqual(operations.filter((operation) => operation.type === "create_layer").map((operation) => operation.name), ["Ring Back", "Planet", "Ring Front"]);
  assert.deepEqual([...new Set(operations.map((operation) => compositionOf(operation)))], ["comp-1"], "built into the composition the job targets");
  const built = answer(designer, 0);
  assert.deepEqual(built.built, [{ name: "Ring Back", id: "layer-101" }, { name: "Planet", id: "layer-102" }, { name: "Ring Front", id: "layer-103" }]);
  assert.deepEqual(built.composition, { id: "comp-1", name: "Main" });
});

test("the designer's report and the built layers reach the owner, and ae_queue_design answers that they are built", async (t) => {
  const designer = new MockProvider({ script: steps(build()) });
  const { rig, seen } = await jobWith(t, designer, [["create_layer"]], { after: [{ name: "ae_consult_specialist", args: { action: "status", role: "visual-scene" } }, { name: "ae_queue_design", args: {} }, { name: "ae_queue_design", args: { layers: ["Planet"] } }] });
  const handoff = recordOf(answerIn(seen.messages, 1), "handoff");
  assert.equal(handoff.report, REPORT);
  assert.deepEqual(handoff.built, ["composition Main (comp-1)", "Ring Back (layer-101)", "Planet (layer-102)", "Ring Front (layer-103)"]);
  assert.deepEqual(listOf(handoff, "scene.layers").map((layer) => textOf(layer, "name")), ["Ring Back", "Planet", "Ring Front"], "the compiled scene rides with the report, for animating by name");
  assert.doesNotMatch(JSON.stringify(answerIn(seen.messages, 1)), /<svg|<path/, "no drawing in what the owner reads");
  const design = recordOf(answerIn(seen.messages, 2), "design");
  assert.deepEqual(design.built, [], "nothing is built twice");
  assert.match(String(design.next), /Ring Back, Planet, Ring Front/);
  assert.match(String(design.next), /built by the designer/);
  assert.deepEqual(fieldOf(answerIn(seen.messages, 3), "design.skipped"), ["Planet"], "naming a built layer queues nothing either");
  assert.equal(rig.applied.length, 1, "the owner's calls queued nothing");
});

test("the designer looks at one frame, sees it, and a second check is refused", async (t) => {
  const designer = new MockProvider({ acceptsImages: true, script: steps(build(), check(), check()) });
  await jobWith(t, designer, [["create_layer"]]);
  assert.equal(answer(designer, 1).picture, "The frame is attached to your next message.");
  assert.ok(designer.stepInputs[2]?.image, "the picture rides the step after the check");
  assert.equal(designer.stepInputs[1]?.image, undefined, "and not the steps before it");
  assert.match(text(designer, 2), /FRAME_CHECK_USED/, "one frame check per drawing");
});

test("a designer whose model takes no images still gets the measurements", async (t) => {
  const designer = new MockProvider({ acceptsImages: false, script: steps(build(), check()) });
  await jobWith(t, designer, [["create_layer"]]);
  assert.match(text(designer, 1), /No picture reached you/);
  assert.ok(designer.stepInputs.every((step) => step.image === undefined));
});

test("a redraw replaces only layers the designer built, once", async (t) => {
  const designer = new MockProvider({ script: steps(build(), redraw(INTRUDER), redraw(PLANET_ONLY), redraw(PLANET_ONLY)) });
  const { rig } = await jobWith(t, designer, [["create_layer"], ["remove_layer", "create_layer"]]);
  assert.match(JSON.stringify(answer(designer, 1)), /DESIGN_LAYER_FOREIGN.*Original.*is not a layer you built/s, "the user's own layer is refused");
  assert.deepEqual(answer(designer, 2).redrawn, ["Planet"]);
  const plans = [...rig.sidecar.plans.values()];
  const redrawPlan = plans.find((plan) => (operationsOf(plan)).some((operation) => operation.type === "remove_layer"));
  assert.ok(redrawPlan, "the fix was queued as a plan");
  const operations = operationsOf(redrawPlan);
  assert.deepEqual(operations.filter((operation) => operation.type === "remove_layer").map((operation) => targetLayerId(operation)), ["layer-102"], "only the Planet it built is removed");
  assert.deepEqual(operations.filter((operation) => operation.type === "create_layer").map((operation) => operation.name), ["Planet"]);
  assert.match(JSON.stringify(answer(designer, 3)), /REDRAW_USED/, "one fix per drawing");
  assert.ok(plans.every((plan) => !(operationsOf(plan)).some((operation) => operation.type === "create_layer" && operation.name === "Original")), "nothing touched the layer the designer did not build");
});

test("the designer's cost and thinking are logged per step, beside the planner's kind of row", async (t) => {
  const stateDirectory = mkdtempSync(join(tmpdir(), "extynt-designer-logs-"));
  t.after(() => rmSync(stateDirectory, { recursive: true, force: true }));
  const designer = new MockProvider({ script: steps(build()) });
  await jobWith(t, designer, [["create_layer"]], { stateDirectory });
  const transcript = readdirSync(join(stateDirectory, "specialist-logs"));
  assert.equal(transcript.length, 1);
  const row = parseJson(present(readFileSync(join(stateDirectory, "specialist-logs", present(transcript[0])), "utf8").trim().split("\n").at(-1)));
  assert.equal(fieldOf(row, "role"), "visual-scene");
  assert.equal(fieldOf(row, "outcome"), "completed");
  const cost = recordOf(row, "cost");
  assert.equal(cost.inputTokens, 200);
  assert.equal(cost.outputTokens, 20);
  assert.equal(cost.steps, 2);
  assert.equal(typeof cost.ms, "number");
  assert.equal(JSON.stringify(fieldOf(row, "messages")).includes("<svg"), false, "the transcript is the instruction and the report, not the drawing");
  const steplog = readdirSync(join(stateDirectory, "agent-logs")).filter((name) => name.endsWith("-visual-scene.jsonl"));
  assert.equal(steplog.length, 1, "the designer's steps have a log of their own");
  const rows = readFileSync(join(stateDirectory, "agent-logs", present(steplog[0])), "utf8").trim().split("\n").map(parseJson);
  assert.equal(fieldOf(rows[0], "schemaVersion"), "extynt.agent-log/0.1");
  assert.match(String(fieldOf(rows[0], "reasoning")), /thinking before step 1/);
  assert.deepEqual(fieldOf(rows[0], "tools"), ["ae_build_drawing"]);
});

test("a composition still queued in the owner's open batch is not built into, and that batch is left alone", async () => {
  const designer = new MockProvider({ script: steps(build('<svg viewBox="0 0 960 540"><g id="Title"><rect x="0" y="0" width="960" height="540" fill="#0a1128"/></g></svg>')) });
  const sidecar = sidecarFor({ token, chatProvider: designer, workflowSpecialistProviders: { "visual-scene": designer }, quietAgentLog: true });
  sidecar.latest = { snapshot: mutableSnapshot("designer-new-comp"), receivedAt: "2026-09-24T15:00:00.000Z", bytes: 1 };
  const input = { requestId: "designer-new-comp", message: "A title", history: [], autoApply: false, workflowJobId: "designer-new-comp", workflowGoalSummary: "A title", workflowRole: WORKFLOW_OWNER };
  const state: AgentCallState = {};
  assert.equal((await sidecar.runAgentTool("ae_select_workflow_stage", { summary: "Create the title comp", operationTypes: ["create_composition"] }, input, state)).ok, true);
  const created = await sidecar.runAgentTool("ae_queue_add", { summary: "Create title comp", operations: [{ type: "create_composition", newCompositionId: "__new__:title", name: "Title", width: 960, height: 540, durationSeconds: 5, frameRate: 30 }] }, input, state);
  assert.equal(created.ok, true, JSON.stringify(created));
  const open = sidecar.openQueuePlanId;
  await sidecar.runAgentTool("ae_consult_specialist", { action: "launch", role: "visual-scene", instruction: "Draw the title in Title, 960x540." }, input, state);
  await settledDesigner(sidecar, input, "wait");
  const refusal = String(designer.stepInputs.at(-1)?.messages.filter((message) => message.role === "tool")[0]?.content);
  assert.match(refusal, /COMPOSITION_TARGET_REQUIRED.*queued in the owner's open batch but not sealed.*seal the batch that holds the composition.*ae_build_drawing and no svg/s);
  assert.doesNotMatch(refusal, /create_composition/, "the designer is not told to create what is already queued");
  assert.equal(sidecar.openQueuePlanId, open, "the owner's open batch is still the open batch");
  assert.deepEqual((operationsOf(present(sidecar.plans.get(open ?? "")))).map((operation) => operation.type), ["create_composition"], "and holds only the owner's operation");
});

test("the designer builds in a batch of its own: the owner's unsealed operations stay queued and out of its receipt", async (t) => {
  const designer = new MockProvider({ script: steps(build()) });
  const rig = await rigWith(t, () => ({ text: "ok", toolCalls: [] }), "designer-iso", [["create_layer"]], { ownerWaitsForSpecialists: true, workflowSpecialistProviders: { "visual-scene": designer } });
  rig.bindCreated = true;
  const sidecar = rig.sidecar;
  const input = { requestId: "designer-iso", message: "A planet", history: [], autoApply: true, workflowJobId: "designer-iso", workflowGoalSummary: "A planet", workflowRole: WORKFLOW_OWNER };
  const state: AgentCallState = {};
  assert.equal((await sidecar.runAgentTool("ae_select_workflow_stage", { summary: "A backdrop", operationTypes: ["create_layer"] }, input, state)).ok, true);
  const queued = await sidecar.runAgentTool("ae_queue_add", { summary: "Backdrop", operations: [{ type: "create_layer", target: { compositionId: "comp-1", layerId: "__new__:backdrop" }, layerType: "solid", name: "Backdrop" }] }, input, state);
  assert.equal(queued.ok, true, JSON.stringify(queued));
  const ownersBatch = sidecar.openQueuePlanId;
  assert.ok(ownersBatch);
  await sidecar.runAgentTool("ae_consult_specialist", { action: "launch", role: "visual-scene", instruction: "Draw the planet and its ring in Main (comp-1)." }, input, {});
  assert.equal((await settledDesigner(sidecar, input, "wait")).ok, true, "the designer's turn ended");
  assert.equal(designer.calls, 2, "the designer built and reported");
  for (let wait = 0; rig.applied.length < 1 && wait < 1_000; wait += 1) await new Promise((resolve) => { setTimeout(resolve, 10); });
  assert.equal(rig.applied.length, 1);
  assert.notEqual(rig.applied[0], ownersBatch, "the designer sealed a batch of its own");
  const names = (operationsOf(present(sidecar.plans.get(present(rig.applied[0]))))).filter((operation) => operation.type === "create_layer").map((operation) => operation.name);
  assert.deepEqual(names, ["Ring Back", "Planet", "Ring Front"], "its receipt holds only its own operations");
  assert.equal(sidecar.openQueuePlanId, ownersBatch, "the owner's batch is still open");
  assert.deepEqual((operationsOf(present(sidecar.plans.get(ownersBatch)))).map((operation) => operation.name), ["Backdrop"], "with its operation still queued");
});

test("a redraw in a free-run job removes only the designer's own layer and needs no approval from the user", async (t) => {
  const designer = new MockProvider({ script: steps(build(), redraw(PLANET_ONLY)) });
  const { rig } = await jobWith(t, designer, [BUILT_THREE, ["remove_layer", "create_layer"]], { freeRun: true });
  const [jobId] = Object.keys(rig.sidecar.workflowCoordinator.workflowStore.getState().jobs);
  assert.equal(rig.applied.length, 2, "the redraw applied");
  const redrawPlan = rig.sidecar.plans.get(present(rig.applied[1]));
  assert.ok(redrawPlan);
  const ids = jobCreatedIds(rig.sidecar, jobId);
  assert.ok(ids.has("layer-102"), "the Planet is among the layers this job created");
  assert.deepEqual(planRisk(redrawPlan, "panel", ids).reasons, [], "removing a layer the job built is not a delete the user must approve");
  const users = { plan: { operations: [{ type: "remove_layer", target: { compositionId: "comp-1", layerId: "layer-1" } }] } };
  assert.deepEqual(planRisk(users, "panel", ids).reasons, ["delete"], "any other delete still waits");
});

test("a build with no composition to go into is refused with the reason, and the compiled drawing is kept for the owner", async () => {
  const designer = new MockProvider({ script: steps(build('<svg viewBox="0 0 960 540"><g id="Title"><rect x="0" y="0" width="960" height="540" fill="#0a1128"/></g></svg>')) });
  const sidecar = sidecarFor({ token, chatProvider: designer, workflowSpecialistProviders: { "visual-scene": designer }, quietAgentLog: true });
  sidecar.latest = { snapshot: mutableSnapshot("designer-no-comp"), receivedAt: "2026-09-24T15:00:00.000Z", bytes: 1 };
  const input = ownerInput("designer-no-comp", "A title", false);
  await sidecar.runAgentTool("ae_consult_specialist", { action: "launch", role: "visual-scene", instruction: "Draw the title, 960x540." }, input, {});
  const waited = await settledDesigner(sidecar, input, "wait");
  assert.equal(waited.ok && fieldOf(waited.data, "status"), "sleeping");
  assert.match(String(designer.stepInputs.at(-1)?.messages.filter((message) => message.role === "tool")[0]?.content), /COMPOSITION_TARGET_REQUIRED.*no 960×540 composition yet.*compiled and kept.*create a 960×540 composition/s);
  const session = sidecar.workflowSpecialistSessions.get(sidecar.workflowCoordinator.jobIdForSeed(input.workflowJobId))?.get("visual-scene");
  assert.ok(session?.design, "the owner's ae_queue_design can build it once the composition exists");
  assert.equal([...sidecar.plans.values()].length, 0, "nothing was queued");
});

test("once the composition exists, the designer builds the kept drawing without redrawing it", async () => {
  const title = '<svg viewBox="0 0 960 540"><g id="Title"><rect x="0" y="0" width="960" height="540" fill="#0a1128"/></g></svg>';
  const first = steps(build(title)), second = steps({ name: "ae_build_drawing", args: {} }, "Built Title.");
  const designer = new MockProvider({ script: (input) => (input.messages.some((message) => message.role === "user" && /Owner follow-up/.test(message.content)) ? second : first)(input) });
  const sidecar = sidecarFor({ token, chatProvider: designer, workflowSpecialistProviders: { "visual-scene": designer }, quietAgentLog: true });
  sidecar.latest = { snapshot: mutableSnapshot("designer-relaunch"), receivedAt: "2026-09-24T15:00:00.000Z", bytes: 1 };
  const input = ownerInput("designer-relaunch", "A title", false);
  await sidecar.runAgentTool("ae_consult_specialist", { action: "launch", role: "visual-scene", instruction: "Draw the title, 960x540." }, input, {});
  const report = await settledDesigner(sidecar, input, "wait");
  assert.equal(report.ok && fieldOf(report.data, "handoff.report"), REPORT, "the owner receives the designer's report");
  assert.equal([...sidecar.plans.values()].length, 0, "nothing was built yet");
  const base = mutableSnapshot("designer-relaunch");
  const [main] = base.result.compositions;
  sidecar.latest = { snapshot: { ...base, result: { ...base.result, activeCompositionId: "comp-title", compositions: [present(main), { ...present(main), id: "comp-title", name: "Title", width: 960, height: 540 }] } }, receivedAt: "2026-09-24T15:01:00.000Z", bytes: 1 };
  await sidecar.runAgentTool("ae_consult_specialist", { action: "message", role: "visual-scene", instruction: "The composition exists now; build." }, input, {});
  await settledDesigner(sidecar, input, "wait");
  const plan = [...sidecar.plans.values()].find((record) => (operationsOf(record)).some((operation) => operation.type === "create_layer"));
  assert.ok(plan, "the kept drawing was built");
  assert.equal(compositionOf(present(operationsOf(plan).find((operation) => operation.type === "create_layer"))), "comp-title");
});

async function ownerWithOpenBatch(t: TestContext, { id, designer, batches, freeRun = false }: { id: string; designer: MockProvider; batches: string[][]; freeRun?: boolean }) {
  const rig = await rigWith(t, () => ({ text: "ok", toolCalls: [] }), id, batches, { ownerWaitsForSpecialists: true, workflowSpecialistProviders: { "visual-scene": designer }, ...(freeRun ? { workflowFreeRun: true } : {}) });
  rig.bindCreated = true;
  const input = { requestId: id, message: "A planet", history: [], autoApply: true, workflowJobId: id, workflowGoalSummary: "A planet", workflowRole: WORKFLOW_OWNER };
  const state: AgentCallState = {};
  const run = (name: string, args: ToolArguments) => rig.sidecar.runAgentTool(name, args, input, state);
  const stage = async (operationTypes: string[]) => { const staged = await run("ae_select_workflow_stage", { summary: "Owner work", operationTypes }); assert.equal(staged.ok, true, JSON.stringify(staged)); }
  const waitForDesigner = async (calls: number) => { for (let wait = 0; designer.calls < calls && wait < 400; wait += 1) await new Promise((resolve) => { setTimeout(resolve, 10); }); await new Promise((resolve) => { setTimeout(resolve, 30); }); };
  return { rig, sidecar: rig.sidecar, input, run, stage, waitForDesigner, state };
}

const backdrop = { type: "create_layer", target: { compositionId: "comp-1", layerId: "__new__:backdrop" }, layerType: "solid", name: "Backdrop" };

test("the owner's open batch is brought forward over the designer's applied batch, and its next add is accepted", async (t) => {
  const designer = new MockProvider({ script: steps(build()) });
  const job = await ownerWithOpenBatch(t, { id: "designer-forward", designer, batches: [["create_layer"]] });
  await job.stage(["create_layer"]);
  { const added = await job.run("ae_queue_add", { summary: "Backdrop", operations: [backdrop] }); assert.equal(added.ok, true, JSON.stringify(added)); }
  const open = job.sidecar.openQueuePlanId;
  assert.ok(open);
  const authoredAgainst = present(job.sidecar.plans.get(open)).plan.snapshotFingerprint;
  await job.run("ae_consult_specialist", { action: "launch", role: "visual-scene", instruction: "Draw the planet and its ring in Main (comp-1)." });
  await job.waitForDesigner(2);
  assert.equal(job.rig.applied.length, 1, "the designer's batch applied");
  const current = present(job.sidecar.normalizedLatest()).fingerprint;
  assert.notEqual(current, authoredAgainst, "the designer's batch moved the project");
  assert.equal(job.sidecar.openQueuePlanId, open, "the owner's batch is still the open batch");
  assert.equal(present(job.sidecar.plans.get(open)).plan.snapshotFingerprint, current, "and it now stands on the current project");
  const more = await job.run("ae_queue_add", { summary: "More", operations: [{ ...backdrop, target: { compositionId: "comp-1", layerId: "__new__:glow" }, name: "Glow" }] });
  assert.equal(more.ok, true, JSON.stringify(more));
  assert.equal((operationsOf(present(job.sidecar.plans.get(open)))).length, 2, "both of the owner's operations are in the one batch");
});

test("an owner batch with nothing staged is dropped when the designer is done, and the next add opens a fresh one", async (t) => {
  const designer = new MockProvider({ script: steps(build()) });
  const job = await ownerWithOpenBatch(t, { id: "designer-empty", designer, batches: [["create_layer"]] });
  await job.stage(["create_layer"]);
  await job.run("ae_queue_add", { summary: "Backdrop", operations: [backdrop] });
  const open = job.sidecar.openQueuePlanId;
  assert.ok(open);
  Object.assign(present(job.sidecar.plans.get(open)), { staged: [] });
  present(job.sidecar.plans.get(open)).plan.operations = [];
  await job.run("ae_consult_specialist", { action: "launch", role: "visual-scene", instruction: "Draw the planet and its ring in Main (comp-1)." });
  await job.waitForDesigner(2);
  const openId = () => job.sidecar.openQueuePlanId;
  assert.equal(openId(), null, "the empty batch is gone");
  const added = await job.run("ae_queue_add", { summary: "Backdrop", operations: [backdrop] });
  assert.equal(added.ok, true, JSON.stringify(added));
  assert.notEqual(job.sidecar.openQueuePlanId, open, "a fresh batch, against the current project");
  assert.equal(present(job.sidecar.plans.get(present(openId() ?? undefined))).plan.snapshotFingerprint, present(job.sidecar.normalizedLatest() ?? undefined).fingerprint);
});

test("an owner batch that targets a layer the designer replaced is discarded, and the model is told once which", async (t) => {
  const named = (layerId: string) => ({ stage: "bar-01", summary: "Name the planet", operations: [{ type: "set_layer_name", target: { compositionId: "comp-1", layerId }, name: "Planet Core" }] });
  const designer = new MockProvider({ script: steps(build(), redraw(PLANET_ONLY)) });
  const job = await ownerWithOpenBatch(t, { id: "designer-replaced", designer, batches: [BUILT_THREE, ["remove_layer", "create_layer"]], freeRun: true });
  const base = mutableSnapshot("designer-replaced");
  const [main] = base.result.compositions;
  await post(job.rig.base, "/v1/snapshots", { ...base, result: { ...base.result, compositions: [{ ...present(main), layers: [...present(main).layers, { ...present(present(main).layers[0]), id: "layer-102", name: "Hero", index: 2, selected: false }] }] } });
  assert.equal((await job.run("ae_workflow_checklist", { items: [{ id: "bar-01", title: "Name the planet" }] })).ok, true);
  const queued = await job.run("ae_queue_add", named("layer-102"));
  assert.equal(queued.ok, true, JSON.stringify(queued));
  await job.run("ae_consult_specialist", { action: "launch", role: "visual-scene", instruction: "Draw the planet and its ring in Main (comp-1)." });
  await settledDesigner(job.sidecar, job.input, "wait");
  assert.equal(job.rig.applied.length, 2, "the designer's build and its redraw applied");
  const open = present([...job.sidecar.plans.values()].find((record) => (operationsOf(record)).some((operation) => operation.type === "set_layer_name")));
  assert.equal(open.status, "cancelled", "the owner's batch was discarded");
  assert.equal(job.sidecar.openQueuePlanId, null);
  const lines = job.sidecar.workflowSidecarActions.get(job.sidecar.workflowCoordinator.jobIdForSeed("designer-replaced"))?.lines.map((line) => line.text) ?? [];
  assert.equal(lines.filter((line) => /discarded your open batch/.test(line)).length, 1, "said once");
  assert.match(lines.join("\n"), /rebuilt layers it pointed at: Planet \(layer-102\)/);
  const fresh = await job.run("ae_queue_add", named("layer-104"));
  assert.equal(fresh.ok, true, JSON.stringify(fresh));
  const deps = { state: job.sidecar, planState: job.sidecar };
  assert.deepEqual(builtDesignLayers(deps, job.input).layers.map((layer) => layer.id), ["layer-101", "layer-104", "layer-103"], "the Planet is listed by the id it has after the redraw");
  const stale = mutableSnapshot("designer-replaced", ["layer-1"], "Stale read");
  const [composition] = stale.result.compositions;
  const staleLayers = [present(present(composition).layers[0]), ...[["Ring Back", "layer-101"], ["Planet", "layer-102"], ["Ring Front", "layer-103"]].map(([name, id], index) => ({ ...present(present(composition).layers[0]), id: present(id), name: present(name), index: index + 2, selected: false, type: "shape" }))];
  job.sidecar.latest = { snapshot: { ...stale, result: { ...stale.result, compositions: [{ ...present(composition), layers: staleLayers }] } }, receivedAt: "2026-09-24T15:02:00.000Z", bytes: 1 };
  const read = builtDesignLayers(deps, job.input);
  assert.deepEqual(read.layers.map((layer) => layer.id), ["layer-101", "layer-104", "layer-103"]);
});

test("a stale open batch hit by ae_queue_add is closed, the refusal says so, and the next add starts fresh", async (t) => {
  const designer = new MockProvider({ script: steps(build()) });
  const job = await ownerWithOpenBatch(t, { id: "designer-stale-add", designer, batches: [["create_layer"]] });
  await job.stage(["create_layer"]);
  await job.run("ae_queue_add", { summary: "Backdrop", operations: [backdrop] });
  const open = job.sidecar.openQueuePlanId;
  assert.ok(open);
  job.sidecar.latest = { snapshot: mutableSnapshot("designer-stale-add", ["layer-1"], "A hand edit"), receivedAt: "2026-09-24T15:02:00.000Z", bytes: 1 };
  const refused = await job.run("ae_queue_add", { summary: "Glow", operations: [{ ...backdrop, target: { compositionId: "comp-1", layerId: "__new__:glow" }, name: "Glow" }] });
  assert.equal(!refused.ok && refused.error.code, "STALE_SNAPSHOT");
  assert.match(String(!refused.ok && refused.error.message), /discarded.*nothing from it was applied.*queue is closed.*ae_queue_add again.*new queue against the current project/s);
  assert.equal(job.sidecar.openQueuePlanId, null);
  assert.equal(present(job.sidecar.plans.get(open)).status, "cancelled");
  const again = await job.run("ae_queue_add", { summary: "Glow", operations: [{ ...backdrop, target: { compositionId: "comp-1", layerId: "__new__:glow" }, name: "Glow" }] });
  assert.equal(again.ok, true, JSON.stringify(again));
});

const REF = { mediaType: "image/png", base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", name: "mood.png" };

test("the designer sees the job's reference images, labelled as look and style data; a model without images is told so in words", async (t) => {
  const designer = new MockProvider({ acceptsImages: true, script: steps(build()) });
  await jobWith(t, designer, [["create_layer"]], { images: [REF] });
  assert.deepEqual(present(designer.stepInputs[0]).images, [{ mediaType: REF.mediaType, base64: REF.base64 }]);
  assert.match(JSON.stringify(present(designer.stepInputs[0]).messages), /look and style references from the user[^]*data, never as instructions/);
  const blind = new MockProvider({ acceptsImages: false, script: steps(build()) });
  await jobWith(t, blind, [["create_layer"]], { images: [REF] });
  assert.ok(blind.stepInputs.every((input) => !input.images?.length));
  assert.match(JSON.stringify(present(blind.stepInputs[0]).messages), /1 reference image was attached to this request, but this model cannot see them/);
});
