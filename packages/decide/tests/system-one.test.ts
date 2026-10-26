// Tests for the system-one adapter: question mapping, batching, answer reading and every failure it reports.
import assert from "node:assert/strict";
import test from "node:test";
import { decide, decideAll, jevDecisionModel } from "../src/index.js";
import type { HttpFetch } from "../src/index.js";
import { EFFECTS, FEATURE, IS_SCENE, URGENCY, answersReply, fakeFetch, jsonReply, textReply } from "./support.js";

const STATE = { text: "add a glow now" };

function jevWith(fetch: HttpFetch) {
  return { models: [jevDecisionModel({ apiKey: "k", fetch, pause: async () => {}, jitter: () => 0 })] };
}

test("a batch of decisions becomes one request with each question in its own shape", async () => {
  const { fetch, calls } = fakeFetch(answersReply({}));
  await decideAll(STATE, { feature: FEATURE, urgency: URGENCY, scene: IS_SCENE }, jevWith(fetch));
  assert.equal(calls.length, 1);
  const questions = {
    feature: { type: "choice", instructions: FEATURE.instructions, criteria: { glow: "a soft light bloom", blur: null, none: null } },
    urgency: { type: "score", instructions: URGENCY.instructions, criteria: ["not urgent", "soon", "now"] },
    scene: { type: "noul", instructions: IS_SCENE.instructions },
  };
  assert.equal(calls[0]?.request.body, JSON.stringify({ model: "jev-latest", state: STATE, questions }));
  assert.equal(calls[0]?.url, "https://api.typesafe.ai/v1/systemone");
});

test("the request carries the bearer key and a JSON content type", async () => {
  const { fetch, calls } = fakeFetch(answersReply({}));
  await decideAll(STATE, { scene: IS_SCENE }, jevWith(fetch));
  assert.deepEqual(calls[0]?.request.headers, { "Content-Type": "application/json", Authorization: "Bearer k" });
});

test("choice, score and noul answers are read back with extra vendor fields ignored", async () => {
  const { fetch } = fakeFetch(answersReply({
    feature: { type: "choice", choice: "glow", confidence: 0.9, probabilities: { glow: 0.9, blur: 0.06, none: 0.04 }, x_p_max: 0.9 },
    urgency: { type: "score", score: 1.8, confidence: 0.85, legend: { "0": "a", "1": "b", "2": "c" }, probabilities: { "0": 0.05, "1": 0.15, "2": 0.8 } },
    scene: { type: "noul", noul: 0.1, certainty: "high" },
  }));
  const results = await decideAll(STATE, { feature: FEATURE, urgency: URGENCY, scene: IS_SCENE }, jevWith(fetch));
  assert.equal(results.feature.label, "glow");
  assert.equal(results.feature.source, "decision-model");
  assert.equal(results.feature.provider, "jev");
  assert.equal(results.urgency.level, 2);
  assert.equal(results.urgency.expected, 1.8);
  assert.equal(results.scene.value, false);
  assert.equal(results.scene.confidence, 0.8);
});

test("a multi-label decision fans out to one noul question per label and regroups the answers", async () => {
  const { fetch, calls } = fakeFetch(answersReply({ "effects::glow": { type: "noul", noul: 0.95 }, "effects::blur": { type: "noul", noul: 0.02 } }));
  const results = await decideAll(STATE, { effects: EFFECTS }, jevWith(fetch));
  const sent = calls[0]?.request.body ?? "";
  assert.equal(sent.includes('"effects::glow":{"type":"noul"'), true);
  assert.equal(sent.includes('"effects::blur":{"type":"noul"'), true);
  assert.deepEqual([...results.effects.labels], ["glow"]);
  assert.deepEqual(results.effects.probabilities, { glow: 0.95, blur: 0.02 });
  assert.equal(results.effects.source, "decision-model");
});

test("a choice falls back to normalised per-label noul answers when only yes or no is supported", async () => {
  const { fetch } = fakeFetch(answersReply({ "feature::glow": { type: "noul", noul: 0.9 }, "feature::blur": { type: "noul", noul: 0.05 }, "feature::none": { type: "noul", noul: 0.05 } }));
  const yesNoOnly = { ...jevDecisionModel({ apiKey: "k", fetch }), supports: new Set(["binary" as const]) };
  const results = await decideAll(STATE, { feature: FEATURE }, { models: [yesNoOnly] });
  assert.equal(results.feature.label, "glow");
  assert.equal(results.feature.confidence, 0.9);
});

test("a key is not sent when none is configured", async () => {
  const { fetch, calls } = fakeFetch(answersReply({}));
  const keyless = jevDecisionModel({ apiKey: "", fetch });
  await decideAll(STATE, { scene: IS_SCENE }, { models: [keyless] });
  assert.deepEqual(calls[0]?.request.headers, { "Content-Type": "application/json" });
});

const FAILURES: ReadonlyArray<readonly [string, ReturnType<typeof fakeFetch>, string]> = [
  ["401", fakeFetch(textReply(401, "")), "unauthorized"],
  ["422", fakeFetch(jsonReply(422, { detail: [{ loc: ["body", "questions"], msg: "too many", type: "x" }] })), "rejected"],
  ["429", fakeFetch(textReply(429, "")), "backoff"],
  ["529", fakeFetch(textReply(529, "")), "backoff"],
  ["500", fakeFetch(textReply(500, "")), "unavailable"],
  ["a refused connection", fakeFetch(new Error("connect refused")), "unavailable"],
  ["an aborted request", fakeFetch(new DOMException("aborted", "AbortError")), "timeout"],
  ["a body that is not JSON", fakeFetch(textReply(200, "<html>")), "malformed"],
  ["a body of the wrong shape", fakeFetch(jsonReply(200, { answers: { scene: { type: "noul", noul: 4 } } })), "malformed"],
];

for (const [name, scripted, reason] of FAILURES) {
  test(`${name} falls back to the deterministic answer and reports ${reason}`, async () => {
    const results = await decideAll(STATE, { scene: IS_SCENE }, jevWith(scripted.fetch));
    assert.equal(results.scene.source, "deterministic");
    assert.equal(results.scene.provider, null);
    assert.equal(results.scene.fallback?.reason, reason);
    assert.equal(results.scene.fallback?.provider, "jev");
    assert.equal(scripted.calls.length, reason === "backoff" ? 2 : 1);
  });
}

test("a 422 reports the server's own explanation", async () => {
  const scripted = fakeFetch(jsonReply(422, { detail: [{ loc: ["body", "questions"], msg: "too many", type: "x" }] }));
  const results = await decideAll(STATE, { scene: IS_SCENE }, jevWith(scripted.fetch));
  assert.equal(results.scene.fallback?.detail, "body.questions: too many");
});

test("an answer of the wrong kind spoils only its own decision", async () => {
  const { fetch } = fakeFetch(answersReply({ scene: { type: "choice", choice: "x", confidence: 1, probabilities: { x: 1 } }, feature: { type: "choice", choice: "blur", confidence: 0.8, probabilities: { blur: 0.8, glow: 0.1, none: 0.1 } } }));
  const results = await decideAll(STATE, { scene: IS_SCENE, feature: FEATURE }, jevWith(fetch));
  assert.equal(results.scene.fallback?.reason, "malformed");
  assert.equal(results.feature.source, "decision-model");
});

test("a busy server is retried once after a jittered pause and a good second reply is used", async () => {
  const replies = [textReply(429, ""), answersReply({ only: { type: "noul", noul: 0.02 } })];
  const pauses: number[] = [];
  const fetch: HttpFetch = async () => replies.shift() ?? textReply(500, "");
  const model = jevDecisionModel({ apiKey: "k", fetch, pause: async (milliseconds) => { pauses.push(milliseconds); }, jitter: () => 0.5 });
  const result = await decide(STATE, IS_SCENE, { models: [model] });
  assert.deepEqual(pauses, [225]);
  assert.equal(result.source, "decision-model");
  assert.equal(result.value, false);
});

test("a 400 that names max_tokens_exceeded reports state-too-large", async () => {
  const { fetch } = fakeFetch(jsonReply(400, { error: { code: "max_tokens_exceeded" } }));
  const result = await decide(STATE, IS_SCENE, jevWith(fetch));
  assert.equal(result.fallback?.reason, "state-too-large");
});

test("any other 400 is a rejection", async () => {
  const { fetch } = fakeFetch(textReply(400, "bad"));
  const result = await decide(STATE, IS_SCENE, jevWith(fetch));
  assert.equal(result.fallback?.reason, "rejected");
});

test("criteria travel with a yes or no question and with each fanned-out label", async () => {
  const criteria = { true: "the request names a glow", false: "it does not" };
  const { fetch, calls } = fakeFetch(answersReply({}));
  await decideAll(STATE, { scene: { ...IS_SCENE, criteria }, effects: { ...EFFECTS, criteria } }, jevWith(fetch));
  const sent = calls[0]?.request.body ?? "";
  assert.equal(sent.includes('"scene":{"type":"noul","instructions":"Is the request a drawn scene?","criteria":{"true":"the request names a glow","false":"it does not"}}'), true);
  assert.equal(sent.includes('"effects::glow":{"type":"noul"'), true);
  assert.equal(sent.split('"criteria":{"true"').length - 1, 3);
});

test("the answering model and the input tokens are recorded on the result", async () => {
  const { fetch } = fakeFetch(jsonReply(200, { model: "jev-1.14.0", usage: { input_tokens: 321, output_tokens: 0 }, answers: { only: { type: "noul", noul: 0.99 } } }));
  const result = await decide(STATE, IS_SCENE, jevWith(fetch));
  assert.deepEqual([result.model, result.inputTokens, result.band], ["jev-1.14.0", 321, "act"]);
});

test("a yes or no answer's confidence is the distance of its probability from a coin flip", async () => {
  const { fetch } = fakeFetch(answersReply({ only: { type: "noul", noul: 0.85 } }));
  const result = await decide(STATE, IS_SCENE, jevWith(fetch));
  assert.ok(Math.abs(result.confidence - 0.7) < 1e-9);
});
