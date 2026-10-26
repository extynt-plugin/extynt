// Live check of the cycle-end decisions against the real Jev: whether a turn ended in prose, what a message to a stopped job means, and whether a first cycle answered a question, each with its expected answer, plus the fallback to the deterministic answers when the key is bad or the endpoint is unreachable.
import assert from "node:assert/strict";
import test, { beforeEach, describe } from "node:test";
import { CONTINUATION, ENDED_IN_PROSE, QUESTION_ANSWERED, type FirstCycle, type TurnEnd } from "@extynt/decide";
import { bookedText, clearBook } from "../src/decision-book.js";
import { primeContinuation } from "../src/decision-continuation.js";
import { primeQuestionAnswered, questionAnswered } from "../src/decision-turn.js";
import { primeJobOpen } from "../src/decision-prime.js";
import { requestedFeatures } from "../src/request-coverage.js";
import { isWorkflowContinuationRequest } from "../src/server-workflow-continuation-ownership.js";
import { SKIP, Suite, liveService } from "./decision-live-support.js";
import type { DecisionSite } from "../src/decision-log.js";
const SITE: DecisionSite = { moment: "completion", jobId: null };

beforeEach(() => clearBook());

const END = { sealed: false, failed: false, askedUser: false, refused: false };

const ENDINGS: ReadonlyArray<readonly [string, TurnEnd, boolean]> = [
  ["a report of the work", { ...END, answer: "I added a glow to the title and set its radius to 40." }, true],
  ["a short done", { ...END, answer: "Done." }, true],
  ["a question to the user", { ...END, answer: "Which of the two compositions should I use?", askedUser: true }, false],
  ["no words", { ...END, answer: "" }, false],
  ["a seal waiting on the host", { ...END, answer: "Waiting for After Effects to finish the render.", sealed: true }, false],
  ["a failure", { ...END, answer: "The plan failed: layer Title was not found.", failed: true }, false],
  ["a refusal", { ...END, answer: "I cannot do that.", refused: true }, false],
];

describe("live ended-in-prose", { skip: SKIP }, () => {
  const live = liveService();
  const suite = new Suite("cycle-end ended-in-prose", live.meter, 0.85);
  for (const [name, state, expected] of ENDINGS) {
    test(`a turn that ended with ${name} is ${expected ? "" : "not "}prose`, async () => {
      suite.check(await live.service.settleBinary(ENDED_IN_PROSE, state, SITE), expected, name);
    });
  }
  test("the ended-in-prose suite is timed", () => { suite.finish(); });
});

describe("live continuation", { skip: SKIP }, () => {
  const live = liveService();
  const suite = new Suite("cycle-end continuation", live.meter, 0.83);
  const CASES: ReadonlyArray<readonly [string, "resume" | "amend-and-resume" | "new-request"]> = [
    ["mach bitte weiter", "resume"],
    ["sigue por favor", "resume"],
    ["ok go ahead and finish it", "resume"],
    ["carry on but make the glow bigger this time", "amend-and-resume"],
    ["Forget that, make a new lower third instead", "new-request"],
    ["What does the Fast Box Blur effect do?", "new-request"],
  ];
  for (const [message, expected] of CASES) {
    test(`"${message}" means ${expected}`, async () => {
      await primeContinuation(live.service, message);
      const booked = bookedText({ decision: CONTINUATION.name, text: message });
      suite.check(booked ?? (isWorkflowContinuationRequest(message) ? "resume" : "new-request"), expected, message);
    });
  }
  test("a message the model reads as resume continues the job", async () => {
    await primeContinuation(live.service, "mach bitte weiter");
    assert.equal(isWorkflowContinuationRequest("mach bitte weiter"), true);
  });
  test("the continuation suite is timed", () => { suite.finish(); });
});

const FIRST = { cycle: 0, continuation: false };
const CYCLES: ReadonlyArray<readonly [string, FirstCycle, boolean]> = [
  ["a pure explanation", { ...FIRST, answer: "A track matte uses one layer's alpha or luma to cut out another layer.", askedUser: false, authoredWork: false }, true],
  ["a question back to the user", { ...FIRST, answer: "Do you want the glow on the title or the whole comp?", askedUser: true, authoredWork: false }, true],
  ["built work with a summary", { ...FIRST, answer: "I built the title, added a glow and keyed the opacity.", askedUser: false, authoredWork: true }, false],
  ["no words", { ...FIRST, answer: "", askedUser: false, authoredWork: false }, false],
  ["a continuation of earlier work", { ...FIRST, answer: "Resumed and finished the lower third.", askedUser: false, authoredWork: true, continuation: true }, false],
];

describe("live question-answered", { skip: SKIP }, () => {
  const live = liveService();
  const suite = new Suite("cycle-end question-answered", live.meter, 0.79);
  for (const [name, state, expected] of CYCLES) {
    test(`a first cycle with ${name} is ${expected ? "" : "not "}an answer`, async () => {
      await primeQuestionAnswered(live.service, state);
      suite.check(questionAnswered(state), expected, name);
    });
  }
  test("the question-answered suite is timed", () => { suite.finish(); });
});

describe("live fallback", { skip: SKIP }, () => {
  const request = "Add a soft glow to the title and a drop shadow";
  const failing: ReadonlyArray<readonly [string, Readonly<Record<string, string | undefined>>]> = [
    ["a bad key", { TYPESAFE_API_KEY: "not-a-real-key" }],
    ["an unreachable endpoint", { TYPESAFE_API_KEY: "not-a-real-key", TYPESAFE_BASE_URL: "http://127.0.0.1:9" }],
  ];
  for (const [name, environment] of failing) {
    test(`${name} falls back to the deterministic answers without throwing`, async () => {
      const live = liveService(environment);
      await primeJobOpen(live.service, { request, message: request });
      assert.deepEqual(requestedFeatures(request).map((feature) => feature.id), ["glow", "drop-shadow"]);
      assert.equal(await live.service.settleBinary(ENDED_IN_PROSE, { ...END, answer: "Done." }, SITE), true);
      await primeQuestionAnswered(live.service, { ...FIRST, answer: "", askedUser: false, authoredWork: false });
      assert.equal(questionAnswered({ ...FIRST, answer: "", askedUser: false, authoredWork: false }), QUESTION_ANSWERED.deterministic({ ...FIRST, answer: "", askedUser: false, authoredWork: false }));
      assert.ok(live.rows.every((row) => row.tier === "deterministic"), `${name}: a row came from a model`);
    });
  }
});
