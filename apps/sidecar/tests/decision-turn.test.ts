// The turn decisions: whether a turn ended in prose, whether a first cycle answered the user and what a message to a stopped job means; each follows a confident model, falls back to its rule with no model or a failing one, and costs one request.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ENDED_IN_PROSE, type Question } from "@extynt/decide";
import { primeContinuation } from "../src/decision-continuation.js";
import { clearBook } from "../src/decision-book.js";
import { firstCycleOf, primeQuestionAnswered, questionAnswered } from "../src/decision-turn.js";
import { isWorkflowContinuationRequest } from "../src/server-workflow-continuation-ownership.js";
import { picked, scriptedModel, serviceOver, yesNo } from "./decision-fakes.js";
import { agentResult } from "./workflow-cycle-fixtures.js";
import type { DecisionSite } from "../src/decision-log.js";
const SITE: DecisionSite = { moment: "completion", jobId: null };

beforeEach(() => clearBook());

const PROSE = { answer: "Done, the glow is on the title.", sealed: false, failed: false, askedUser: false, refused: false };
const says = (value: boolean, confidence = 0.95) => (question: Question) => (question.kind === "binary" ? yesNo(value, confidence) : picked("resume"));

test("an ended-in-prose turn follows a confident model and logs one row under the spec id", async () => {
  const jev = scriptedModel(says(false));
  const { service, rows } = serviceOver([jev.model]);
  assert.equal(await service.settleBinary(ENDED_IN_PROSE, PROSE, SITE), false);
  assert.equal(jev.calls.length, 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.decision, "ended-in-prose");
});

test("an ended-in-prose turn is the rule's answer with no model, a failing model or an unsure one", async () => {
  assert.equal(await serviceOver([]).service.settleBinary(ENDED_IN_PROSE, PROSE, SITE), true);
  assert.equal(await serviceOver([scriptedModel(says(false), "timeout").model]).service.settleBinary(ENDED_IN_PROSE, PROSE, SITE), true);
  assert.equal(await serviceOver([scriptedModel(says(false, 0.5)).model]).service.settleBinary(ENDED_IN_PROSE, PROSE, SITE), true);
});

const answered = firstCycleOf(agentResult({ answer: "Sure, here is how fades work." }), 0, false);
const built = firstCycleOf(agentResult({ answer: "" }), 0, false);

test("a first cycle answers the question by the rule unless a confident model says otherwise", async () => {
  assert.equal(questionAnswered(answered), true);
  assert.equal(questionAnswered(built), false);
  const jev = scriptedModel(says(false, 0.97));
  await primeQuestionAnswered(serviceOver([jev.model]).service, answered);
  assert.equal(jev.calls.length, 1);
  assert.equal(questionAnswered(answered), false);
});

test("a first cycle is not asked with no model, on a later cycle, or when the model fails", async () => {
  const jev = scriptedModel(says(false, 0.97));
  await primeQuestionAnswered(serviceOver([]).service, answered);
  await primeQuestionAnswered(serviceOver([jev.model]).service, { ...answered, cycle: 1 });
  await primeQuestionAnswered(serviceOver([scriptedModel(says(false), "unavailable").model]).service, answered);
  assert.equal(jev.calls.length, 0);
  assert.equal(questionAnswered(answered), true);
});

test("a message to a stopped job counts as a continuation by its phrase or by a model's resume", async () => {
  assert.equal(isWorkflowContinuationRequest("Please continue."), true);
  assert.equal(isWorkflowContinuationRequest("mach bitte weiter"), false);
  const jev = scriptedModel(says(true));
  await primeContinuation(serviceOver([jev.model]).service, "mach bitte weiter");
  assert.equal(jev.calls.length, 1);
  assert.equal(isWorkflowContinuationRequest("mach bitte weiter"), true);
});

test("a continuation is not asked for a known phrase, with no model, or when the model fails", async () => {
  const jev = scriptedModel(says(true));
  await primeContinuation(serviceOver([jev.model]).service, "continue");
  await primeContinuation(serviceOver([]).service, "weiter");
  await primeContinuation(serviceOver([scriptedModel(says(true), "timeout").model]).service, "weiter");
  assert.equal(jev.calls.length, 0);
  assert.equal(isWorkflowContinuationRequest("weiter"), false);
});
