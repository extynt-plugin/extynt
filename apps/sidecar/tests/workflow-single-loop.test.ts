/** One loop by default: scripted turns through the real sidecar with a host that applies batches and returns verified receipts. */
import type { JsonObject } from "@extynt/decode";
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { present } from "./agent-test-support.js";
import { readJson, textOf } from "./http-json.js";
import { chatTurn } from "./sidecar-fixture.js";
import { post, rigFor, step, toolCalls, type Script } from "./single-loop-rig.js";
import { jobFacts } from "./workflow-cycle-fixtures.js";

const SMOKE_OPS = [
  { type: "create_composition", newCompositionId: "__new__:smoke", name: "Smoke", width: 1920, height: 1080, durationSeconds: 10, frameRate: 30 },
  { type: "create_layer", target: { compositionId: "__new__:smoke", layerId: "__new__:red" }, layerType: "solid", name: "Red", color: [1, 0, 0] },
];

test("scenario 1: a comp with a solid is queued, sealed and answered in three provider calls", async (t) => {
  const script: Script = (input) => {
    const called = toolCalls(input);
    if (!called.includes("ae_queue_add")) return step("s1-add", "ae_queue_add", { summary: "Create Smoke comp with a red solid", operations: SMOKE_OPS });
    if (!called.includes("ae_queue_finish")) return step("s1-finish", "ae_queue_finish", {});
    return { text: "Made the Smoke comp with a red solid.", toolCalls: [] };
  };
  const rig = await rigFor(t, script, "single-loop-1", [["create_composition", "create_layer"]]);
  const reply = await chatTurn(rig.address, "make a 1920x1080 10 s comp named Smoke with a red solid", [], { autoApply: true });
  assert.equal(reply.ok, true, JSON.stringify(reply));
  assert.equal(rig.provider.calls, 3, "queue, finish, answer");
  assert.equal(rig.applied.length, 1, `the batch was applied: ${JSON.stringify(reply)}`);
  assert.deepEqual(jobFacts(rig).statuses, ["completed"], "the verified read-back closed the job");
  assert.equal(jobFacts(rig).observations, 0, "no frame was captured or observed");
  assert.equal(reply.answer, "Made the Smoke comp with a red solid.");
  assert.equal(reply.tools.some((tool) => ["ae_consult_specialist", "ae_capture_composition_frame", "ae_observe_frame"].includes(tool.name)), false, "no specialist and no capture");
});

test("scenario 1, next turn: undoing the last change takes two provider calls and removes the work", async (t) => {
  const first: Script = (input) => {
    const called = toolCalls(input);
    if (!called.includes("ae_queue_add")) return step("u1-add", "ae_queue_add", { summary: "Create Smoke comp with a red solid", operations: SMOKE_OPS });
    if (!called.includes("ae_queue_finish")) return step("u1-finish", "ae_queue_finish", {});
    return { text: "Made the Smoke comp with a red solid.", toolCalls: [] };
  };
  const rig = await rigFor(t, (input) => {
    if (input.messages.some((message) => message.role === "user" && message.content.includes("undo the last change"))) return toolCalls(input).includes("ae_undo_agent_work") ? { text: "Undid the Smoke comp.", toolCalls: [] } : step("u2-undo", "ae_undo_agent_work", {});
    return first(input);
  }, "single-loop-undo", [["create_composition", "create_layer"]]);
  const made = await chatTurn(rig.address, "make a 1920x1080 10 s comp named Smoke with a red solid", [], { autoApply: true });
  assert.equal(made.plans.length, 1, JSON.stringify(made));
  const before = rig.provider.calls;
  const undone = await chatTurn(rig.address, "undo the last change", [], { autoApply: true });
  assert.equal(rig.provider.calls - before, 2, `undo then answer: ${JSON.stringify(undone)}`);
  assert.deepEqual(rig.undone, [present(made.plans[0]).planId], "the panel was asked to take that batch back");
  assert.equal(rig.sidecar.workflowCoordinator.batchForPlan(present(made.plans[0]).planId)?.recovery.state, "undone");
  assert.equal(undone.answer, "Undid the Smoke comp.");
});

const CTRL_OPS = [
  { type: "create_layer", target: { compositionId: "comp-1", layerId: "__new__:ctrl" }, layerType: "null", name: "Control" },
  { type: "set_layer_parent", target: { compositionId: "comp-1", layerId: "layer-1" }, parentLayerId: "__new__:ctrl" },
  { type: "set_expression", target: { compositionId: "comp-1", layerId: "__new__:ctrl", propertyPath: "ADBE Transform Group/ADBE Position" }, source: "wiggle(2, 30)", enabled: true },
];

test("scenario 2: a null, a parent link and a wiggle finish on their read-back, with no capture and no specialist", async (t) => {
  const rig = await rigFor(t, (input) => {
    const called = toolCalls(input);
    if (!called.includes("ae_queue_add")) return step("s2-add", "ae_queue_add", { summary: "Add a null, parent the title to it and wiggle it", operations: CTRL_OPS });
    if (!called.includes("ae_queue_finish")) return step("s2-finish", "ae_queue_finish", {});
    return { text: "Added Control, parented the title to it and set a wiggle.", toolCalls: [] };
  }, "single-loop-2", [["create_layer", "set_layer_parent", "set_expression"]]);
  const reply = await chatTurn(rig.address, "add a null and parent the title to it, then wiggle the null", [], { autoApply: true });
  assert.equal(reply.ok, true, JSON.stringify(reply));
  assert.equal(rig.provider.calls, 3, `queue, finish, answer: ${JSON.stringify(reply)}`);
  assert.deepEqual(jobFacts(rig).statuses, ["completed"], "the verified read-back closed the job");
  assert.equal(jobFacts(rig).observations, 0, "no capture and no observation");
  assert.equal(reply.tools.some((tool) => ["ae_consult_specialist", "ae_capture_composition_frame", "ae_observe_frame"].includes(tool.name)), false);
});

test("a read-back mismatch past the repair limit blocks the job, frees the chat lane and still allows undo", async (t) => {
  const timing = { type: "set_layer_timing", target: { compositionId: "comp-1", layerId: "layer-1" }, inPoint: 0, outPoint: 2 };
  const rig = await rigFor(t, (input) => {
    if (input.messages.some((message) => message.role === "user" && message.content.includes("undo the last change"))) return toolCalls(input).includes("ae_undo_agent_work") ? { text: "Undid it.", toolCalls: [] } : step("m-undo", "ae_undo_agent_work", {});
    if (input.messages.some((message) => message.role === "user" && message.content.includes("how are you"))) return { text: "Fine.", toolCalls: [] };
    const called = toolCalls(input);
    const adds = called.filter((name) => name === "ae_queue_add").length;
    return adds > called.filter((name) => name === "ae_queue_finish").length ? step(`m-finish-${adds}`, "ae_queue_finish", {}) : step(`m-add-${adds}`, "ae_queue_add", { summary: "Trim the title", operations: [timing] });
  }, "single-loop-mismatch", [["set_layer_timing"], ["set_layer_timing"], ["set_layer_timing"]]);
  rig.mismatch = true;
  const reply = await readJson(await post(rig.base, "/v1/chat", { requestId: "mismatch-turn", message: "trim the title to two seconds", history: [], autoApply: true }));
  assert.equal(textOf(reply, "outcome"), "failed", JSON.stringify(reply));
  assert.equal(textOf(reply, "failure.code"), "WORKFLOW_BATCH_BLOCKED");
  const store = rig.sidecar.workflowCoordinator.workflowStore;
  assert.deepEqual(Object.values(store.getState().jobs).map((job) => job.status), ["blocked"], "the exhausted job is terminal, not active");
  assert.equal(store.getState().activeJobId ?? null, null, "no job holds the chat lane");
  const next = await post(rig.base, "/v1/chat", { requestId: "after-block", message: "how are you", history: [], autoApply: true });
  assert.notEqual(next.status, 409, "the next chat turn is admitted");
  rig.mismatch = false;
  const undone = await chatTurn(rig.address, "undo the last change", [], { autoApply: true });
  assert.equal(undone.answer, "Undid it.", JSON.stringify(undone));
});

test("a model that answers in prose after its second repair also settled mismatched leaves the job blocked, not active", async (t) => {
  const timing = { type: "set_layer_timing", target: { compositionId: "comp-1", layerId: "layer-1" }, inPoint: 0, outPoint: 2 };
  const rig = await rigFor(t, (input) => {
    if (input.messages.some((message) => message.role === "user" && message.content.includes("how are you"))) return { text: "Fine.", toolCalls: [] };
    const called = toolCalls(input);
    const adds = called.filter((name) => name === "ae_queue_add").length;
    if (adds === 2 && called.filter((name) => name === "ae_queue_finish").length === 2) return { text: "I could not get the timing to stick.", toolCalls: [] };
    return adds > called.filter((name) => name === "ae_queue_finish").length ? step(`p-finish-${adds}`, "ae_queue_finish", {}) : step(`p-add-${adds}`, "ae_queue_add", { summary: "Trim the title", operations: [timing] });
  }, "single-loop-prose", [["set_layer_timing"], ["set_layer_timing"]]);
  rig.mismatch = 2;
  const reply = await readJson(await post(rig.base, "/v1/chat", { requestId: "prose-turn", message: "trim the title to two seconds", history: [], autoApply: true }));
  assert.equal(textOf(reply, "outcome"), "failed", JSON.stringify(reply));
  assert.equal(textOf(reply, "failure.code"), "WORKFLOW_BATCH_BLOCKED");
  const store = rig.sidecar.workflowCoordinator.workflowStore;
  assert.deepEqual(Object.values(store.getState().jobs).map((job) => job.status), ["blocked"], "the exhausted job is terminal, not active");
  assert.equal(store.getState().activeJobId ?? null, null, "no job holds the chat lane");
  const next = await post(rig.base, "/v1/chat", { requestId: "after-prose", message: "how are you", history: [], autoApply: true });
  assert.notEqual(next.status, 409, "the next chat turn is admitted");
});

test("a model that answers in prose after the first mismatch without repairing leaves the job blocked, the lane free and undo working", async (t) => {
  const timing = { type: "set_layer_timing", target: { compositionId: "comp-1", layerId: "layer-1" }, inPoint: 0, outPoint: 2 };
  const rig = await rigFor(t, (input) => {
    const said = (text: string) => input.messages.some((message) => message.role === "user" && message.content.includes(text));
    if (said("undo the last change")) return toolCalls(input).includes("ae_undo_agent_work") ? { text: "Undid it.", toolCalls: [] } : step("n-undo", "ae_undo_agent_work", {});
    if (said("how are you")) return { text: "Fine.", toolCalls: [] };
    const called = toolCalls(input);
    if (!called.includes("ae_queue_add")) return step("n-add", "ae_queue_add", { summary: "Trim the title", operations: [timing] });
    if (!called.includes("ae_queue_finish")) return step("n-finish", "ae_queue_finish", {});
    return { text: "The title is trimmed.", toolCalls: [] };
  }, "single-loop-unrepaired", [["set_layer_timing"]]);
  rig.mismatch = 1;
  const reply = await readJson(await post(rig.base, "/v1/chat", { requestId: "unrepaired-turn", message: "trim the title to two seconds", history: [], autoApply: true }));
  assert.equal(textOf(reply, "failure.code"), "WORKFLOW_BATCH_BLOCKED", JSON.stringify(reply));
  assert.equal(textOf(reply, "failure.message").includes("no repair was queued"), true, JSON.stringify(reply));
  assert.equal(JSON.stringify(reply).includes("orchestrator is repairing"), false, "no orchestrator cycle will run in the single loop");
  const store = rig.sidecar.workflowCoordinator.workflowStore;
  assert.deepEqual(Object.values(store.getState().jobs).map((job) => job.status), ["blocked"], "the unrepaired job is blocked, not active");
  assert.equal(store.getState().activeJobId ?? null, null, "no job holds the chat lane");
  const next = await post(rig.base, "/v1/chat", { requestId: "after-unrepaired", message: "how are you", history: [], autoApply: true });
  assert.notEqual(next.status, 409, "the next chat turn is admitted");
  rig.mismatch = false;
  const undone = await chatTurn(rig.address, "undo the last change", [], { autoApply: true });
  assert.equal(undone.answer, "Undid it.", JSON.stringify(undone));
});

const TIMING = { type: "set_layer_timing", target: { compositionId: "comp-1", layerId: "layer-1" }, inPoint: 0, outPoint: 2 };
const REFUSED = "refusedBeforeApply";

function trimScript(refusals: string[]): Script {
  return (input) => {
    if (input.messages.some((message) => message.role === "user" && message.content.includes("how are you"))) return { text: "Fine.", toolCalls: [] };
    const tools = input.messages.filter((message) => message.role === "tool");
    const finishes = tools.filter((message) => message.name === "ae_queue_finish");
    refusals.splice(0, refusals.length, ...finishes.map((message) => message.content).filter((content) => content.includes(REFUSED)));
    const adds = tools.filter((message) => message.name === "ae_queue_add").length;
    if (adds > finishes.length) return step(`t-finish-${adds}`, "ae_queue_finish", {});
    if (adds > 0 && !finishes.at(-1)?.content.includes(REFUSED)) return { text: "Trimmed the title to two seconds.", toolCalls: [] };
    return step(`t-add-${adds}`, "ae_queue_add", { summary: "Trim the title", operations: [TIMING] });
  };
}

test("a stale refusal before apply goes back to the model, which re-queues and finishes the job in the same turn", async (t) => {
  const refusals: string[] = [];
  const rig = await rigFor(t, trimScript(refusals), "single-loop-stale", [["set_layer_timing"], ["set_layer_timing"]]);
  rig.stale = { first: 1 };
  const reply = await readJson(await post(rig.base, "/v1/chat", { requestId: "stale-turn", message: "trim the title to two seconds", history: [], autoApply: true }));
  assert.notEqual(textOf(reply, "outcome"), "failed", JSON.stringify(reply));
  assert.equal(textOf(reply, "answer"), "Trimmed the title to two seconds.");
  assert.equal(rig.applied.length, 2, "the refused batch and the re-queued one both reached the host");
  assert.equal(refusals.length, 1, "the model was shown the refusal once");
  assert.match((refusals[0] ?? ""), /The project changed between approval and apply/, "the host message is quoted");
  assert.match((refusals[0] ?? ""), /queue the batch again/);
  assert.deepEqual(jobFacts(rig).statuses, ["completed"], "the second batch verified and closed the job");
});

test("any refusal that provably ran nothing goes back to the model with the host's own fix", async (t) => {
  const refusals: string[] = [];
  const rig = await rigFor(t, trimScript(refusals), "single-loop-refused", [["set_layer_timing"], ["set_layer_timing"]]);
  rig.stale = { first: 1, hostError: { code: "LAYER_STYLES_UNSUPPORTED", message: "LAYER_STYLES_UNSUPPORTED: Layer Style menu commands are not available in this After Effects session. Use ensure_effect instead." } };
  const reply = await readJson(await post(rig.base, "/v1/chat", { requestId: "refused-turn", message: "trim the title to two seconds", history: [], autoApply: true }));
  assert.notEqual(textOf(reply, "outcome"), "failed", JSON.stringify(reply));
  assert.equal(refusals.length, 1, "the model was shown the refusal once");
  assert.match((refusals[0] ?? ""), /Use ensure_effect instead/, "the host message is quoted");
  assert.match((refusals[0] ?? ""), /changing what hostMessage names/);
  assert.doesNotMatch((refusals[0] ?? ""), /project moved/, "a refusal that is not stale is not explained as one");
  assert.deepEqual(jobFacts(rig).statuses, ["completed"]);
});

const LOOP_ERROR = { code: "EXPRESSION_INVALID", message: "EXPRESSION_INVALID: Expression Disabled\nError at line 1 in property `Scale' of layer 8 (`Rings') in comp `Ident'. \r\nError: This property has no keyframes\n\n\t\n?\tloopOut(\"pingpong\")\n\t (previous expression restored)" };

test("a host rejection that was rolled back goes to the model with the operation, the host message and the resend instruction", async (t) => {
  const refusals: string[] = [];
  const rig = await rigFor(t, trimScript(refusals), "single-loop-rolled-back", [["set_layer_timing"], ["set_layer_timing"]]);
  rig.stale = { first: 1, hostError: LOOP_ERROR, failedAt: { index: 0, operation: "set_layer_timing", rolledBack: true } };
  const reply = await readJson(await post(rig.base, "/v1/chat", { requestId: "rolled-back-turn", message: "trim the title to two seconds", history: [], autoApply: true }));
  assert.notEqual(textOf(reply, "outcome"), "failed", JSON.stringify(reply));
  assert.equal(textOf(reply, "answer"), "Trimmed the title to two seconds.");
  assert.equal(rig.applied.length, 2, "the rejected batch and the corrected resend both reached the host");
  assert.equal(refusals.length, 1, "the model was shown the rejection once");
  assert.match((refusals[0] ?? ""), /operation 1 of 1 \(set_layer_timing on layer layer-1/, "named by position, type and target");
  assert.match((refusals[0] ?? ""), /This property has no keyframes/, "After Effects' own message is quoted");
  assert.match((refusals[0] ?? ""), /nothing from this batch was applied/);
  assert.match((refusals[0] ?? ""), /Resend the whole batch corrected/);
  assert.deepEqual(jobFacts(rig).statuses, ["completed"], "the resent batch verified and closed the job");
});

test("host rejections that roll back are corrected at most twice, then the job blocks", async (t) => {
  const rig = await rigFor(t, trimScript([]), "single-loop-rolled-back-bound", [["set_layer_timing"], ["set_layer_timing"], ["set_layer_timing"], ["set_layer_timing"]]);
  rig.stale = { first: 99, hostError: LOOP_ERROR, failedAt: { index: 0, operation: "set_layer_timing", rolledBack: true } };
  const reply = await readJson(await post(rig.base, "/v1/chat", { requestId: "rolled-back-bound-turn", message: "trim the title to two seconds", history: [], autoApply: true }));
  assert.equal(textOf(reply, "outcome"), "failed", JSON.stringify(reply));
  assert.equal(textOf(reply, "failure.code"), "WORKFLOW_BATCH_BLOCKED");
  assert.match(textOf(reply, "failure.message"), /rolled back/);
  assert.equal(rig.applied.length, 3, "the first rejection plus two corrected resends, then the block");
  assert.equal(rig.sidecar.workflowCoordinator.workflowStore.getState().activeJobId ?? null, null, "no job holds the chat lane");
});

test("a host failure whose rollback is not proven still blocks the job", async (t) => {
  const refusals: string[] = [];
  const rig = await rigFor(t, trimScript(refusals), "single-loop-unclean", [["set_layer_timing"], ["set_layer_timing"]]);
  rig.stale = { first: 1, mayHaveMutated: true, hostError: LOOP_ERROR, failedAt: { index: 0, operation: "set_layer_timing", rolledBack: false } };
  const reply = await readJson(await post(rig.base, "/v1/chat", { requestId: "unclean-turn", message: "trim the title to two seconds", history: [], autoApply: true }));
  assert.equal(textOf(reply, "outcome"), "failed", JSON.stringify(reply));
  assert.equal(textOf(reply, "failure.code"), "WORKFLOW_BATCH_BLOCKED");
  assert.equal(refusals.length, 0, "the model was never told to resend");
  assert.equal(rig.applied.length, 1, "no second batch was queued");
});

test("stale refusals past the retry bound block the job with a project-kept-changing message and free the chat lane", async (t) => {
  const rig = await rigFor(t, trimScript([]), "single-loop-stale-bound", [["set_layer_timing"], ["set_layer_timing"], ["set_layer_timing"], ["set_layer_timing"]]);
  rig.stale = { first: 99 };
  const reply = await readJson(await post(rig.base, "/v1/chat", { requestId: "stale-bound-turn", message: "trim the title to two seconds", history: [], autoApply: true }));
  assert.equal(textOf(reply, "outcome"), "failed", JSON.stringify(reply));
  assert.equal(textOf(reply, "failure.code"), "WORKFLOW_BATCH_BLOCKED");
  assert.match(textOf(reply, "failure.message"), /project kept changing/);
  assert.equal(rig.applied.length, 3, "the first refusal plus two retries, then the block");
  const store = rig.sidecar.workflowCoordinator.workflowStore;
  assert.deepEqual(Object.values(store.getState().jobs).map((job) => job.status), ["blocked"]);
  assert.equal(store.getState().activeJobId ?? null, null, "no job holds the chat lane");
  const next = await post(rig.base, "/v1/chat", { requestId: "after-stale", message: "how are you", history: [], autoApply: true });
  assert.notEqual(next.status, 409, "the next chat turn is admitted");
});

test("a rejection that may have mutated still blocks the job instead of being handed back", async (t) => {
  const refusals: string[] = [];
  const rig = await rigFor(t, trimScript(refusals), "single-loop-stale-mutated", [["set_layer_timing"], ["set_layer_timing"]]);
  rig.stale = { first: 1, mayHaveMutated: true };
  const reply = await readJson(await post(rig.base, "/v1/chat", { requestId: "stale-mutated-turn", message: "trim the title to two seconds", history: [], autoApply: true }));
  assert.equal(textOf(reply, "outcome"), "failed", JSON.stringify(reply));
  assert.equal(textOf(reply, "failure.code"), "WORKFLOW_BATCH_BLOCKED");
  assert.equal(refusals.length, 0, "the model was never told to retry");
  assert.equal(rig.applied.length, 1, "no second batch was queued");
  const store = rig.sidecar.workflowCoordinator.workflowStore;
  assert.equal(store.getState().activeJobId ?? null, null, "no job holds the chat lane");
  const next = await post(rig.base, "/v1/chat", { requestId: "after-mutated", message: "how are you", history: [], autoApply: true });
  assert.notEqual(next.status, 409, "the next chat turn is admitted");
});

const PROVED = "\"proved\"";

async function finishResultFor(t: TestContext, goal: string, snapshotId: string): Promise<string> {
  let finish = "";
  const rig = await rigFor(t, (input) => {
    const tools = input.messages.filter((message) => message.role === "tool");
    const finished = tools.find((message) => message.name === "ae_queue_finish");
    if (finished) { finish = finished.content; return { text: "Done.", toolCalls: [] }; }
    return tools.some((message) => message.name === "ae_queue_add") ? step("p-finish", "ae_queue_finish", {}) : step("p-add", "ae_queue_add", { summary: "Retime the title", operations: [TIMING] });
  }, snapshotId, [["set_layer_timing"]]);
  const reply = await chatTurn(rig.address, goal, [], { autoApply: true });
  assert.equal(reply.ok, true, JSON.stringify(reply));
  return finish;
}

test("a read-back that covers every evidence kind the job needs tells the model no frame check is needed", async (t) => {
  const finish = await finishResultFor(t, "Animate the selected title so it slides in from the left and fades up over the first half second, then holds on screen until the end of the composition.", "single-loop-proved");
  assert.ok(finish.includes(PROVED), `the slide-and-fade job is proved by its read-back: ${finish}`);
  assert.ok(finish.includes("no frame capture or observation is needed"), finish);
});

test("a goal that asks how it looks gets no proved note, since its read-back does not cover the picture", async (t) => {
  const finish = await finishResultFor(t, "Make the title look better", "single-loop-judged");
  assert.ok(finish.length > 0, "the batch settled inside the finish call");
  assert.equal(finish.includes(PROVED), false, `a judgement goal still needs its frame: ${finish}`);
});

const LONG_GOAL = `${"Build a 10-second title ident in this empty comp, from scratch. Work in coherent stages and check what actually landed before building a later stage on it. ".repeat(2)}Art direction: deep indigo-to-black backdrop.
- The word "SIGNAL", centred, on a text layer with an outer glow.
- Per-letter reveal with out-expo easing from 0.8s.`;

test("a long request keeps its whole text, line breaks included, as the job's goal, and its criteria come from all of it", async (t) => {
  const rig = await rigFor(t, (input) => {
    const called = toolCalls(input);
    if (!called.includes("ae_queue_add")) return step("g-add", "ae_queue_add", { summary: "Create Smoke comp with a red solid", operations: SMOKE_OPS });
    if (!called.includes("ae_queue_finish")) return step("g-finish", "ae_queue_finish", {});
    return { text: "Built the backdrop.", toolCalls: [] };
  }, "single-loop-long-goal", [["create_composition", "create_layer"]]);
  await chatTurn(rig.address, LONG_GOAL, [], { autoApply: true });
  const [job] = Object.values(rig.sidecar.workflowCoordinator.workflowStore.getState().jobs);
  assert.ok(job, "the request opened a job");
  assert.ok(job.goalSummary.includes('- The word "SIGNAL", centred'), `the tail of the request is in the goal: ${job.goalSummary}`);
  assert.ok(job.goalSummary.includes("glow.\n- Per-letter"), "the request's list keeps its line breaks");
  assert.deepEqual(job.successCriteria.map((criterion) => criterion.criterionId), ["goal-visual", "goal-temporal"], "the glow and the easing in the tail set the evidence the job needs");
});

function repairScript(finishes: string[], second: JsonObject): Script {
  return (input) => {
    const tools = input.messages.filter((message) => message.role === "tool");
    const sealed = tools.filter((message) => message.name === "ae_queue_finish");
    finishes.splice(0, finishes.length, ...sealed.map((message) => message.content));
    const adds = tools.filter((message) => message.name === "ae_queue_add").length;
    if (adds > sealed.length) return step(`rp-finish-${adds}`, "ae_queue_finish", {});
    if (adds === 0) return step("rp-add-0", "ae_queue_add", { summary: "Trim the title", operations: [TIMING] });
    if (adds === 1) return step("rp-add-1", "ae_queue_add", { summary: "Trim the title, corrected", operations: [second] });
    return { text: "Trimmed the title to two seconds.", toolCalls: [] };
  };
}

test("a read-back mismatch hands the model the operation, expected against observed and what to resend, and the corrected batch completes the job", async (t) => {
  const finishes: string[] = [];
  const rig = await rigFor(t, repairScript(finishes, { ...TIMING, outPoint: 2.0 }), "single-loop-repair", [["set_layer_timing"], ["set_layer_timing"]]);
  rig.mismatch = 1;
  const reply = await readJson(await post(rig.base, "/v1/chat", { requestId: "repair-turn", message: "trim the title to two seconds", history: [], autoApply: true }));
  assert.notEqual(textOf(reply, "outcome"), "failed", JSON.stringify(reply));
  assert.equal(textOf(reply, "answer"), "Trimmed the title to two seconds.");
  assert.equal(rig.applied.length, 2, "the mismatched batch and the corrected resend both reached the host");
  assert.match((finishes[0] ?? ""), /operation 1 \(set_layer_timing on layer layer-1; layer-timing-mismatch: expected 2, observed 0\)/, "named by position, type, target and values");
  assert.match((finishes[0] ?? ""), /rest of the batch stands/);
  assert.match((finishes[0] ?? ""), /Queue only corrected versions of that operation/);
  assert.deepEqual(jobFacts(rig).statuses, ["completed"], "the verified correction closed the job although the first batch stays mismatched");
});

test("an unrelated verified batch does not launder a mismatch: the job blocks with the repair message", async (t) => {
  const finishes: string[] = [];
  const rig = await rigFor(t, repairScript(finishes, { type: "set_layer_name", target: { compositionId: "comp-1", layerId: "layer-1" }, name: "Other" }), "single-loop-repair-other", [["set_layer_timing"], ["set_layer_name"]]);
  rig.mismatch = 1;
  const reply = await readJson(await post(rig.base, "/v1/chat", { requestId: "repair-other-turn", message: "trim the title to two seconds", history: [], autoApply: true }));
  assert.match(finishes[1] ?? "", /operation 1 \(set_layer_timing/, "the model was told again, after the unrelated batch, that the mismatch stands");
  assert.equal(textOf(reply, "outcome"), "failed", JSON.stringify(reply));
  assert.equal(textOf(reply, "failure.code"), "WORKFLOW_BATCH_BLOCKED");
  assert.match(textOf(reply, "failure.message"), /did not read back as requested/);
  assert.match(textOf(reply, "failure.message"), /operation 1 \(set_layer_timing/);
  assert.deepEqual(jobFacts(rig).statuses, ["blocked"]);
});
