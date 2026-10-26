// The reviewer's pre-screen: the receipts' counts reach the decision, only a confident yes in the act band skips the review, and a request that needs its picture is always reviewed.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MockProvider, type AgentStepInput, type AgentStepResult } from "@extynt/llm";
import type { Question } from "@extynt/decide";
import { clearBook } from "../src/decision-book.js";
import { receiptsProveReview, screenCase } from "../src/decision-review.js";
import { picked, scriptedModel, serviceOver, yesNo } from "./decision-fakes.js";
import { present } from "./agent-test-support.js";
import type { JsonObject } from "./http-json.js";
import { post, rigWith, step } from "./single-loop-rig.js";

beforeEach(() => clearBook());

const PAD = "Keep every layer named and the timing exact, and leave the rest of the project alone.";
const LONG = (goal: string): string => `${goal}. ${`${PAD} `.repeat(5)}`;
const TIMING = { type: "set_layer_timing", target: { compositionId: "comp-1", layerId: "layer-1" }, inPoint: 0, outPoint: 2 };
const TRIM = (stage: string) => ({ stage, summary: "Trim", operations: [TIMING] });
const text = (value: string): AgentStepResult => ({ text: value, toolCalls: [], usage: { inputTokens: 500, outputTokens: 40 } });
const PLAN = JSON.stringify({ items: [{ id: "bar-01", title: "Title bar", spec: "Title in at 0s", kind: "build" }, { id: "bar-02", title: "Subtitle bar", spec: PAD, kind: "build" }, { id: "rev-1", title: "Review: bars", spec: "", kind: "review", covers: ["bar-01", "bar-02"] }] });

const state = {
  batches: { b1: { operationIds: ["o1", "o2"] }, b2: { operationIds: ["o3"] } },
  operations: { o1: { type: "set_layer_timing", outcome: "confirmed" }, o2: { type: "set_layer_property", outcome: "coerced_equivalent" }, o3: { type: "set_layer_property", outcome: "applied_unconfirmed" } },
};

test("the pre-screen counts exact, approximate and unconfirmed operations of the covered batches and lists their kinds once", () => {
  const screen = screenCase(state, { goal: "g", specs: ["s"], batchIds: ["b1", "b2"] });
  assert.deepEqual([screen.batches, screen.exact, screen.approximate, screen.unconfirmed], [2, 1, 1, 1]);
  assert.deepEqual(screen.operations, ["set_layer_timing", "set_layer_property"]);
});

const EXACT = { goal: "Rename the layers", specs: ["Layers renamed"], batches: 1, exact: 4, approximate: 0, unconfirmed: 0, operations: ["set_layer_name"] };

test("a confident yes in the act band proves the review; any doubt, a weak yes or a no leaves it to run", async () => {
  const yes = scriptedModel(() => yesNo(true));
  assert.equal(await receiptsProveReview(serviceOver([yes.model]).service, EXACT), true);
  assert.equal(await receiptsProveReview(serviceOver([scriptedModel(() => yesNo(true, 0.6)).model]).service, EXACT), false, "a weak yes is not enough for a high-stakes decision");
  assert.equal(await receiptsProveReview(serviceOver([scriptedModel(() => yesNo(false)).model]).service, EXACT), false);
  assert.equal(await receiptsProveReview(serviceOver([]).service, EXACT), false, "with no model the review runs");
  assert.equal(await receiptsProveReview(serviceOver([scriptedModel(() => yesNo(true), "unavailable").model]).service, EXACT), false, "a failed model leaves the review to run");
});

test("approximate or unconfirmed operations, or none exact, never reach the model", async () => {
  const yes = scriptedModel(() => yesNo(true));
  const { service } = serviceOver([yes.model]);
  for (const screen of [{ ...EXACT, approximate: 1 }, { ...EXACT, unconfirmed: 1 }, { ...EXACT, exact: 0 }]) assert.equal(await receiptsProveReview(service, screen), false);
  assert.equal(yes.calls.length, 0);
});

function screening(proven: boolean, waiver: boolean) {
  return scriptedModel((question: Question) => {
    if (question.id === "settled") return yesNo(proven);
    if (question.id === "visual-waiver") return yesNo(waiver);
    return question.kind === "binary" ? yesNo(false) : picked("none");
  });
}

async function runJob(t: test.TestContext, name: string, goal: string, models: ReadonlyArray<ReturnType<typeof screening>["model"]>) {
  const planner = new MockProvider({ script: () => text(PLAN) });
  const reviewer = new MockProvider({ script: () => text('{"verdict":"pass","fixes":[]}') });
  let index = 0;
  const actions: ReadonlyArray<[string, string, JsonObject?]> = [["a1", "ae_queue_add", TRIM("bar-01")], ["f1", "ae_queue_finish"], ["a2", "ae_queue_add", TRIM("bar-02")], ["f2", "ae_queue_finish"], ["done", "ae_workflow_complete"]];
  const users = new Set<string>();
  const script = (input: AgentStepInput): AgentStepResult => {
    for (const message of input.messages) if (message.role === "user" && typeof message.content === "string") users.add(message.content);
    const next = actions[index];
    index += 1;
    return next ? step(next[0], next[1], next[2] ?? {}) : { text: "Done.", toolCalls: [] };
  };
  const rig = await rigWith(t, script, name, [["set_layer_timing"], ["set_layer_timing"]], { workflowFreeRun: true, workflowSpecialistProviders: { planner, reviewer }, decisionModels: () => models });
  await post(rig.base, "/v1/chat", { requestId: `${name}-turn`, message: LONG(goal), history: [], autoApply: true });
  for (let attempt = 0; attempt < 600 && Object.values(rig.sidecar.workflowCoordinator.workflowStore.getState().jobs)[0]?.status === "active"; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 50));
  const checklist = present(present([...rig.sidecar.workflowSidecarActions.values()][0]).checklist);
  return { reviewer, result: present(present(checklist.reviews)["rev-1"]).result, users };
}

test("when the receipts prove the work and the visual waiver holds, the long job's review is left out and counted as passed", async (t) => {
  const ran = await runJob(t, "screen-skip", "build the title bar and the subtitle bar, in at 0s and out at 2s", [screening(true, true).model]);
  assert.equal(ran.reviewer.calls, 0);
  assert.equal(ran.result, "pass");
  assert.ok([...ran.users].some((message) => /review rev-1: pass \(the receipts prove the covered work/.test(message)));
});

test("a model that does not say the receipts prove the work leaves the review to run", async (t) => {
  const ran = await runJob(t, "screen-no", "build the title bar and the subtitle bar, in at 0s and out at 2s", [screening(false, true).model]);
  assert.equal(ran.reviewer.calls, 1);
  assert.equal(ran.result, "pass");
});

test("a request whose visual waiver is not granted keeps its review even when the model says the receipts prove it", async (t) => {
  const ran = await runJob(t, "screen-waiver", "build the title bar and the subtitle bar, in at 0s and out at 2s", [screening(true, false).model]);
  assert.equal(ran.reviewer.calls, 1);
});

test("with no decision model the review always runs", async (t) => {
  const ran = await runJob(t, "screen-none", "build the title bar and the subtitle bar, in at 0s and out at 2s", []);
  assert.equal(ran.reviewer.calls, 1);
});
