// What a turn may hand the panel: a plan card only for a sealed, finished turn, the in-panel tool surface, and the bounded retry of an unsatisfied workflow completion.
import assert from "node:assert/strict";
import test from "node:test";
import { agentToolSpecs, runAgent, type ToolArguments, type ToolResult } from "../src/agent.js";
import { IN_PANEL_AGENT_HIDDEN_TOOLS, planCardTools } from "@extynt/mcp-server";
import { MockProvider } from "@extynt/llm";
import { planTools, queueAdd, queueFinish, readCall, sealedTurn, toolMessages } from "./agent-test-support.js";
import type { AgentCallState, ChatAgentInput } from "../src/server-chat-agent-types.js";
import { WORKFLOW_OWNER } from "../src/workflow-orchestration.js";
import { fieldOf } from "./http-json.js";
import { mutableSnapshot, sidecarFor, token } from "./sidecar-fixture.js";

const PLAN_WRITING_TOOLS = new Set(planCardTools().map((definition) => definition.name));

test("a turn cut off by the step ceiling reports failed and hands the panel no plan card", async () => {
  for (const autoApply of [true, false]) {
    const tools = planTools();
    const provider = new MockProvider({ script: (input) => toolMessages(input.messages).length
      ? { text: "", toolCalls: [readCall(`read-${input.messages.length}`)] }
      : { text: "", toolCalls: [queueAdd("add-1")] } });
    const result = await runAgent(provider, { requestId: "req-step-limit", message: "Rename the layer", history: [], briefing: "briefing", maxSteps: 3, autoApply, callTool: tools.callTool });

    assert.equal(result.failure?.code, "STEP_LIMIT", "the turn ran out of steps");
    assert.equal(result.outcome, "failed", "a turn that ran out of steps finished nothing, whatever it queued on the way");
    assert.deepEqual(result.plans, [], "the panel applies whatever cards a reply carries, so an unfinished turn must carry none");
    assert.equal(result.answer, "", "no card-shaped answer may take the failure message's place");
    assert.equal(tools.store.size, 1, "the queued plan stays in the store");
  }
});

const droppedAfterSeal = (input: { messages: Parameters<typeof toolMessages>[0] }) => {
  const toolsCalled = toolMessages(input.messages).length;
  if (toolsCalled === 0) return { text: "", toolCalls: [queueAdd("add-1")] };
  if (toolsCalled === 1) return { text: "", toolCalls: [queueFinish("finish-1")] };
  throw new Error("the connection dropped");
};

test("a provider error after a seal withholds that turn's card too", async () => {
  const tools = planTools();
  const provider = new MockProvider({ script: droppedAfterSeal });
  const result = await runAgent(provider, { requestId: "req-provider-error", message: "Rename the layer", history: [], briefing: "briefing", callTool: tools.callTool });

  assert.equal(result.failure?.code, "PROVIDER_ERROR", "the step after the seal never answered");
  assert.equal(result.outcome, "failed");
  assert.deepEqual(result.plans, [], "one more failure kind, the same refusal");
  assert.notEqual(result.mutated, true, "without autoApply a seal applies nothing");
});

test("under autoApply a provider error after a seal keeps the applied card and marks the turn mutated", async () => {
  const tools = planTools();
  const provider = new MockProvider({ script: droppedAfterSeal });
  const result = await runAgent(provider, { requestId: "req-auto-error", message: "Rename the layer", history: [], briefing: "briefing", autoApply: true, callTool: tools.callTool });

  assert.equal(result.failure?.code, "PROVIDER_ERROR");
  assert.equal(result.mutated, true, "a fallback model must not rerun work the panel already applies");
  assert.equal(result.plans.length, 1, "the applied work keeps its card");
});

test("an unsatisfied workflow completion gets one repair cycle and accepts corrected evidence", async () => {
  const evidenceFor = (receiptId: string) => ({ goalDigest: "a".repeat(64), criterionIds: ["criterion-1"], evidence: [{ criterionId: "criterion-1", reference: { kind: "batch_receipt", batchId: "batch-1", receiptId } }] });
  const first = evidenceFor("missing");
  const corrected = evidenceFor("receipt-1");
  const provider = new MockProvider({ script: (input) => {
    const attempted = toolMessages(input.messages).length;
    return { text: "", toolCalls: [{ id: `complete-${attempted + 1}`, name: "ae_workflow_complete", arguments: attempted === 0 ? first : corrected }] };
  } });
  const seen: ToolArguments[] = [];
  const result = await runAgent(provider, {
    requestId: "req-workflow-completion-repair",
    message: "Finish the workflow once its evidence is valid.",
    history: [],
    briefing: "briefing",
    maxSteps: 4,
    stopAfterWorkflowCompletion: true,
    callTool: (_name, args) => {
      seen.push(args);
      return seen.length === 1
        ? { ok: false, error: { code: "COMPLETION_UNSATISFIED", message: "The receipt reference does not exist." } }
        : { ok: true, data: { completed: true } };
    },
  });

  assert.equal(result.failure, undefined, "the rejected proposal did not terminate the cycle");
  assert.equal(result.steps, 2, "the provider received the refusal and made one corrected proposal");
  assert.deepEqual(seen, [first, corrected], "the second proposal changed the rejected evidence");
  assert.deepEqual(result.tools.map(({ name, ok }) => ({ name, ok })), [
    { name: "ae_workflow_complete", ok: false },
    { name: "ae_workflow_complete", ok: true },
  ]);
});

interface CompletionAnswer { readonly ok: boolean; readonly code?: string; readonly message?: string }

async function completeWithAnswers(requestId: string, answers: readonly CompletionAnswer[]) {
  const provider = new MockProvider({ script: (input) => ({ text: "", toolCalls: [{ id: `complete-${input.messages.length}`, name: "ae_workflow_complete", arguments: {} }] }) });
  let calls = 0;
  const result = await runAgent(provider, {
    requestId, message: "Finish the workflow.", history: [], briefing: "briefing", maxSteps: 6, stopAfterWorkflowCompletion: true,
    callTool: () => {
      const answer = answers[Math.min(calls, answers.length - 1)];
      calls += 1;
      return answer?.ok ? { ok: true, data: { completed: true } } : { ok: false, error: { code: answer?.code ?? "COMPLETION_EVIDENCE_MISSING", message: answer?.message ?? "" } };
    },
  });
  return { result, calls };
}

test("an identical completion call whose refusal changed keeps the turn alive: each new refusal is progress", async () => {
  const { result, calls } = await completeWithAnswers("req-completion-changing-refusal", [
    { ok: false, code: "REQUEST_COVERAGE_INCOMPLETE", message: "The request names features the project does not show yet." },
    { ok: false, code: "COMPLETION_EVIDENCE_MISSING", message: "Criterion goal-temporal needs a temporal observation." },
    { ok: true },
  ]);
  assert.equal(calls, 3, "the third proposal was still heard");
  assert.deepEqual(result.tools.map((tool) => tool.ok), [false, false, true]);
});

test("the same refusal to an identical completion call twice ends the turn as a bounded validation outcome", async () => {
  const { result, calls } = await completeWithAnswers("req-completion-same-refusal", [{ ok: false, code: "COMPLETION_EVIDENCE_MISSING", message: "Criterion goal-temporal needs a temporal observation." }]);
  assert.equal(calls, 2, "the repeat was the last proposal");
  assert.deepEqual(result.tools.map((tool) => tool.ok), [false, false]);
});

test("a turn that queues, seals and then answers keeps its card and reports planned", async () => {
  const tools = planTools();
  const provider = new MockProvider({ script: sealedTurn });
  const result = await runAgent(provider, { requestId: "req-clean", message: "Rename the layer", history: [], briefing: "briefing", callTool: tools.callTool });

  assert.equal(result.failure, undefined, "the turn ended by answering");
  assert.equal(result.outcome, "planned");
  assert.deepEqual(result.plans.map((plan) => plan.planId), ["plan-1"]);
});

test("every plan-writing tool the panel can call is offered, and a turn that sealed a plan reports planned", async () => {
  const names = [...PLAN_WRITING_TOOLS];
  assert.ok(names.includes("ae_queue_add"), "the tool that opens the queue writes a plan and must be marked");
  assert.ok(names.includes("ae_queue_finish"), "and so must the seal, whose sidecar-attached card is the panel's");
  const offered = new Set(agentToolSpecs().map((spec) => spec.name));
  for (const name of ["ae_queue_add", "ae_queue_fix", "ae_queue_finish"]) assert.ok(offered.has(name), `${name} must be offered to the in-panel agent, or its plan can never be carded`);

  for (const hidden of IN_PANEL_AGENT_HIDDEN_TOOLS) assert.ok(!offered.has(hidden), `${hidden} must not be offered to the in-panel agent`);
  const tools = planTools();
  const provider = new MockProvider({ script: sealedTurn });
  const result = await runAgent(provider, { requestId: "req-sealed", message: "Build the whole sequence", history: [], briefing: "briefing", callTool: tools.callTool });
  assert.equal(result.failure, undefined, "the turn ended by answering");
  assert.equal(result.outcome, "planned", "a plan that succeeded is legitimate work, not a failure");
  assert.deepEqual(result.plans.map((plan) => plan.planId), ["plan-1"], "the seal is carded");

  const draftTools = planTools();
  const draftProvider = new MockProvider({ script: (input) => toolMessages(input.messages).length
    ? { text: "Queued one operation. Say the word and I will finish it.", toolCalls: [] }
    : { text: "", toolCalls: [queueAdd("add-1")] } });
  const draft = await runAgent(draftProvider, { requestId: "req-draft", message: "Build the whole sequence", history: [], briefing: "briefing", callTool: draftTools.callTool });
  assert.equal(draft.outcome, "answered", "a queue that was never sealed has no plan to apply");
  assert.deepEqual(draft.plans, [], "an unsealed queue may not be carded");
});

const strayFix = { id: "stray-fix", name: "ae_queue_fix", arguments: { edits: [{ op: "remove", index: 0 }] } };

async function sealedThenStrayError(autoApply: boolean, carded = true) {
  const provider = new MockProvider({ script: (input) => {
    const called = toolMessages(input.messages).map((message) => message.name);
    if (!called.includes("ae_queue_add")) return { text: "", toolCalls: [queueAdd("add-1")] };
    if (!called.includes("ae_queue_finish")) return { text: "", toolCalls: [queueFinish("finish-1")] };
    if (!called.includes("ae_queue_fix")) return { text: "", toolCalls: [strayFix] };
    return { text: "Done.", toolCalls: [] };
  } });
  const callTool = (name: string): ToolResult => {
    if (name === "ae_queue_add") return { ok: true, data: { queued: 1 } };
    if (name === "ae_queue_finish") return { ok: true, ...(carded ? { sealedCard: { planId: "plan-1", presentation: { title: "Rename" }, plan: { operations: [{ type: "set_layer_name" }] } } } : {}), data: { sealed: true, operationCount: 1, undoGroups: 1, queued: 0 } };
    if (name === "ae_queue_fix") return { ok: false, error: { code: "NO_OPEN_QUEUE", message: "There is nothing queued to fix." } };
    return { ok: true, data: {} };
  };
  return runAgent(provider, { requestId: "req-sealed-then-error", message: "Rename the layer", history: [], briefing: "briefing", autoApply, callTool });
}

test("a trailing queue error after an auto-applied seal does not fail the turn", async () => {
  const result = await sealedThenStrayError(true);
  assert.equal(result.mutated, true, "under auto apply the seal applied the plan");
  assert.equal(result.failure, undefined, "the trailing error does not become the turn's failure");
  assert.equal(result.outcome, "planned");
  assert.equal(result.answer, "Done.");
});

test("a sealed batch with no card that auto applied is mutated, so a trailing queue error does not fail the turn", async () => {
  const result = await sealedThenStrayError(true, false);
  assert.equal(result.mutated, true, "the seal applied the batch");
  assert.equal(result.failure, undefined, "the trailing error is not the failure of an applied turn");
  assert.equal(result.outcome, "answered");
});

test("with autoApply off a sealed card is left for the user, so the turn is not marked mutated", async () => {
  const result = await sealedThenStrayError(false);
  assert.notEqual(result.mutated, true, "nothing was applied; the user presses Apply on the card");
  assert.equal(result.outcome, "planned", "the card is still offered");
});

test("a finish with nothing open is no seal: it queues nothing and attaches no card", async () => {
  const sidecar = sidecarFor({ token, chatProvider: new MockProvider({ answer: "test" }), quietAgentLog: true });
  sidecar.latest = { snapshot: mutableSnapshot("finish-nothing-open"), receivedAt: "2026-09-24T00:00:00.000Z", bytes: 1 };
  const input: ChatAgentInput = { requestId: "req-nothing-open", message: "Finish", history: [], autoApply: true, workflowJobId: "job-nothing-open", workflowGoalSummary: "Finish", workflowRole: WORKFLOW_OWNER };
  const state: AgentCallState = {};

  const result = await sidecar.runAgentTool("ae_queue_finish", {}, input, state);

  assert.equal(result.ok ? fieldOf(result.data, "sealed") : "refused", false, "the finish answers that nothing was open");
  assert.equal(sidecar.plans.size, 0, "nothing was sealed, so nothing is queued");
  assert.equal(result.ok && "sealedCard" in result, false, "no sealed card rides the reply");
});

test("an applied plan with no prose reply ends on a summary of what changed, not boilerplate", async () => {
  const tools = planTools();
  const provider = new MockProvider({ script: (input) => {
    const toolsCalled = toolMessages(input.messages).length;
    if (toolsCalled === 0) return { text: "", toolCalls: [queueAdd("add-1")] };
    if (toolsCalled === 1) return { text: "", toolCalls: [queueFinish("finish-1")] };
    return { text: "", toolCalls: [] };
  } });
  const result = await runAgent(provider, { requestId: "req-summary", message: "Rename the layer", history: [], briefing: "briefing", autoApply: true, callTool: (name, args) => {
    const result = tools.callTool(name, args);
    if (name === "ae_queue_finish") result.autoApply = true;
    return result;
  } });

  assert.equal(result.plans.length, 1);
  assert.ok(!result.answer.startsWith("Applying the plan"), "the boilerplate must not stand in for the summary");
  assert.ok(result.answer.includes(result.plans[0]?.title ?? "missing"), "the closing reply names what the plan did");
  assert.doesNotMatch(result.answer, /below/, "the cards sit above the reply, so it never points below");
});
