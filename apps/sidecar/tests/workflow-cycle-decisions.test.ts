/** The authoring loop's pure decisions: when a cycle may start, what an unsealed cycle becomes, how a completion settles, and how results and events fold into the run's state. */
import assert from "node:assert/strict";
import test from "node:test";
import type { AgentPlanCard } from "../src/agent.js";
import { MockProvider } from "@extynt/llm";
import { AUTOMATIC_CYCLE_CEILING, AUTOMATIC_WALL_CLOCK_MS, STALL_CYCLES, decideCycleStop, type ProgressMark } from "../src/server-workflow-cycle-budget.js";
import { decideAcceptance, decideMismatch, decideUnclosedStage } from "../src/server-workflow-cycle-batches.js";
import { decideCompletion, decideRefusal, decideUnsealed } from "../src/server-workflow-cycle-outcome.js";
import { initialCycleState, mergeAgentResult, reduceCycle, withStopReason } from "../src/server-workflow-cycle-state.js";
import { agentResult } from "./workflow-cycle-fixtures.js";

const MARK: ProgressMark = { progress: 0, progressCycle: 0, baseCycle: 0, startedAt: 0 };
const stopFacts = (fields: { cycle: number; mark?: ProgressMark; forcedRecheck?: boolean; elapsedMs?: number }) => ({ mark: MARK, forcedRecheck: false, ceiling: AUTOMATIC_CYCLE_CEILING, elapsedMs: 0, ...fields });
const card = (planId: string): AgentPlanCard => ({ planId, title: planId, operations: [], warnings: [], expressions: [], requiresAcknowledgement: false, autoApply: false });
const sealedResult = () => agentResult({ sealed: true, plans: [card("plan-1")] });

test("the first cycle always starts; stalled, ceiling and clock stops name their cycle counts", () => {
  assert.equal(decideCycleStop(stopFacts({ cycle: 0, elapsedMs: AUTOMATIC_WALL_CLOCK_MS })), null);
  assert.deepEqual(decideCycleStop(stopFacts({ cycle: STALL_CYCLES })), { kind: "stalled", cycles: STALL_CYCLES });
  assert.equal(decideCycleStop(stopFacts({ cycle: STALL_CYCLES - 1 })), null);
  const landing: ProgressMark = { ...MARK, progressCycle: AUTOMATIC_CYCLE_CEILING - 1 };
  assert.deepEqual(decideCycleStop(stopFacts({ cycle: AUTOMATIC_CYCLE_CEILING, mark: landing })), { kind: "ceiling", cycles: AUTOMATIC_CYCLE_CEILING });
  assert.deepEqual(decideCycleStop(stopFacts({ cycle: 3, mark: { ...MARK, progressCycle: 2 }, elapsedMs: AUTOMATIC_WALL_CLOCK_MS })), { kind: "clock", cycles: 3 });
});

test("a forced recheck and earlier rechecks do not count as stalled cycles", () => {
  assert.equal(decideCycleStop(stopFacts({ cycle: STALL_CYCLES, forcedRecheck: true })), null);
  assert.equal(decideCycleStop(stopFacts({ cycle: STALL_CYCLES, mark: { ...MARK, rechecks: 1 } })), null);
});

const unsealed = (fields: Partial<Parameters<typeof decideUnsealed>[0]>) => decideUnsealed({ current: agentResult(), cycle: 0, continuationRun: undefined, freeRun: false, ...fields });

test("an unsealed cycle advances when it sealed, blocks on its failure, releases an answered question, and otherwise feeds or blocks on prose", () => {
  assert.deepEqual(unsealed({ current: sealedResult() }), { kind: "advance" });
  const failure = { code: "PROVIDER_ERROR", message: "down" };
  assert.deepEqual(unsealed({ current: agentResult({ failure }) }), { kind: "block-failure", failure });
  assert.deepEqual(unsealed({ current: agentResult({ answer: "It is a title." }) }), { kind: "release-answered" });
  assert.deepEqual(unsealed({ current: agentResult({ askedUser: { question: "Which font?", kind: "question" } }) }), { kind: "release-answered" });
  assert.deepEqual(unsealed({}), { kind: "block-prose", continuationCycle: false });
  assert.deepEqual(unsealed({ cycle: 2 }), { kind: "block-prose", continuationCycle: true });
  assert.deepEqual(unsealed({ cycle: 2, freeRun: true }), { kind: "feed-prose" });
  assert.deepEqual(unsealed({ freeRun: true }), { kind: "block-prose", continuationCycle: false });
});

test("a completion is none, accepted, replaced by a sealed correction batch, or refused", () => {
  const refused = { accepted: false };
  assert.equal(decideCompletion(agentResult()), "none");
  assert.equal(decideCompletion(agentResult({ workflowCompletion: { accepted: true } })), "accepted");
  assert.equal(decideCompletion({ ...sealedResult(), workflowCompletion: refused }), "settle-new-batch");
  assert.equal(decideCompletion(agentResult({ workflowCompletion: refused })), "refused");
});

test("a refused completion is fed back in free run, keeps finished host work as planned, and otherwise blocks", () => {
  assert.equal(decideRefusal({ freeRun: true, hostWorkCompleted: false }), "feedback");
  assert.equal(decideRefusal({ freeRun: true, hostWorkCompleted: true }), "feedback");
  assert.equal(decideRefusal({ freeRun: false, hostWorkCompleted: true }), "preserve-host-work");
  assert.equal(decideRefusal({ freeRun: false, hostWorkCompleted: false }), "block");
});

test("merging a cycle's result adds traces and usage, replaces cards by plan id and takes the cycle's findings", () => {
  const first = agentResult({ steps: 2, answer: "one", usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3, cachedInputTokens: 0 }, notes: ["a"] });
  const second = agentResult({ steps: 3, answer: "two", sealed: true, usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, cachedInputTokens: 5 }, notes: ["b"], failure: { code: "X", message: "y" } });
  const alone = mergeAgentResult(undefined, first);
  assert.notEqual(alone, first);
  assert.deepEqual(alone, first);
  const merged = mergeAgentResult(first, second);
  assert.equal(merged.steps, 5);
  assert.equal(merged.answer, "two");
  assert.equal(merged.sealed, true);
  assert.deepEqual(merged.notes, ["a", "b"]);
  assert.deepEqual(merged.usage, { inputTokens: 11, outputTokens: 22, totalTokens: 33, cachedInputTokens: 5 });
  assert.deepEqual(merged.failure, { code: "X", message: "y" });
  assert.equal(first.steps, 2, "the earlier result is not changed");
});

test("a stop says why first and keeps the model's notes; a first-cycle prose answer and a repeat are left alone", () => {
  const stopped = withStopReason(agentResult({ failure: { code: "WORKFLOW_CYCLE_LIMIT", message: "paused" }, answer: "Notes." }));
  assert.equal(stopped.answer, "Stopped: paused\n\nThe model's notes:\nNotes.");
  assert.equal(withStopReason(stopped), stopped);
  const prose = agentResult({ failure: { code: "WORKFLOW_NO_BATCH", message: "none" }, answer: "Hi" });
  assert.equal(withStopReason(prose), prose);
  const other = agentResult({ failure: { code: "PROVIDER_ERROR", message: "x" }, answer: "Hi" });
  assert.equal(withStopReason(other), other);
});

test("events fold into a new state without changing the old one", () => {
  const start = initialCycleState({ used: new MockProvider(), jobId: null, continuation: null, orchestration: undefined, feedback: undefined });
  const tracked = reduceCycle(start, { kind: "job-tracked", jobId: "job-1" });
  assert.equal(tracked.jobId, "job-1");
  assert.equal(start.jobId, null);
  const withFeedback = reduceCycle(reduceCycle(tracked, { kind: "feedback-appended", cycle: 1, message: "a" }), { kind: "feedback-appended", cycle: 1, message: "b" });
  assert.deepEqual(withFeedback.feedback, { cycle: 1, message: "a\n\nb" });
  assert.equal(reduceCycle(withFeedback, { kind: "feedback-appended", cycle: 2, message: "c" }).feedback?.message, "c");
  assert.equal(reduceCycle(withFeedback, { kind: "feedback-taken" }).feedback, undefined);
  const failed = reduceCycle(tracked, { kind: "failed", failure: { code: "WORKFLOW_BLOCKED", message: "no" }, seed: "blank" });
  assert.equal(failed.aggregate?.outcome, "failed");
  const finalized = reduceCycle(failed, { kind: "finalized" });
  assert.equal(finalized.aggregate?.answer, "Stopped: no");
  assert.equal(reduceCycle(start, { kind: "finalized" }).aggregate, undefined);
});

test("a read-back mismatch is repaired, blocked when the turn ended without one, or blocked when repairs are spent", () => {
  assert.equal(decideMismatch({ repairable: true, endedUnrepaired: false }), "repair");
  assert.equal(decideMismatch({ repairable: true, endedUnrepaired: true }), "block-unrepaired");
  assert.equal(decideMismatch({ repairable: false, endedUnrepaired: false }), "block-limit");
});

test("a stage the engine cannot close carries on in free run or past an accepted mismatch, and otherwise blocks", () => {
  assert.equal(decideUnclosedStage({ hasMismatch: true, accepted: true, freeRun: false }), "carry-on");
  assert.equal(decideUnclosedStage({ hasMismatch: true, accepted: false, freeRun: true }), "block-mismatch");
  assert.equal(decideUnclosedStage({ hasMismatch: false, accepted: false, freeRun: true }), "carry-on");
  assert.equal(decideUnclosedStage({ hasMismatch: false, accepted: false, freeRun: false }), "block-failed");
});

test("free run accepts an unrepaired mismatch only after newer batches verified or a cycle already blocked on it", () => {
  assert.equal(decideAcceptance({ freeRun: false, alreadyAccepted: true, later: 3, blockedBefore: true }), "refuse");
  assert.equal(decideAcceptance({ freeRun: true, alreadyAccepted: true, later: 0, blockedBefore: false }), "already");
  assert.equal(decideAcceptance({ freeRun: true, alreadyAccepted: false, later: 0, blockedBefore: false }), "refuse");
  assert.equal(decideAcceptance({ freeRun: true, alreadyAccepted: false, later: 1, blockedBefore: false }), "accept");
  assert.equal(decideAcceptance({ freeRun: true, alreadyAccepted: false, later: 0, blockedBefore: true }), "accept");
});
