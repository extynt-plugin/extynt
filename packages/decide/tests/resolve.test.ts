// Tests for the resolver: tier order, thresholds, offline mode, refusals and the opt-in language model.
import assert from "node:assert/strict";
import test from "node:test";
import { decide, decideAll, jevDecisionModel, languageDecisionModel } from "../src/index.js";
import type { DecisionModel, LanguageModelPort } from "../src/index.js";
import { EFFECTS, FEATURE, IS_SCENE, answersReply, fakeFetch } from "./support.js";

const STATE = { text: "a glow scene" };

const CONFIDENT = { type: "choice", choice: "glow", confidence: 0.95, probabilities: { glow: 0.95, blur: 0.03, none: 0.02 } };

test("with no models every decision is deterministic, with no fallback and no network call", async () => {
  const { calls } = fakeFetch(answersReply({}));
  const results = await decideAll(STATE, { feature: FEATURE, effects: EFFECTS, scene: IS_SCENE });
  assert.equal(calls.length, 0);
  assert.equal(results.feature.label, "glow");
  assert.deepEqual([...results.effects.labels], ["glow"]);
  assert.equal(results.scene.value, true);
  assert.deepEqual([results.feature.source, results.feature.provider, results.feature.calibrated, results.feature.fallback], ["deterministic", null, null, null]);
});

test("a deterministic choice is one-hot with full confidence", async () => {
  const result = await decide(STATE, FEATURE);
  assert.deepEqual(result.probabilities, { glow: 1, blur: 0, none: 0 });
  assert.equal(result.confidence, 1);
});

test("an answer below the spec's threshold falls back with a low-confidence reason", async () => {
  const unsure = { ...CONFIDENT, confidence: 0.5 };
  const { fetch } = fakeFetch(answersReply({ only: unsure }));
  const result = await decide({ text: "blur" }, FEATURE, { models: [jevDecisionModel({ apiKey: "k", fetch })] });
  assert.equal(result.source, "deterministic");
  assert.equal(result.label, "none");
  assert.equal(result.fallback?.reason, "low-confidence");
});

test("a spec threshold overrides the provider's", async () => {
  const unsure = { ...CONFIDENT, confidence: 0.5 };
  const { fetch } = fakeFetch(answersReply({ only: unsure }));
  const lenient = { ...FEATURE, threshold: 0.4 };
  const result = await decide(STATE, lenient, { models: [jevDecisionModel({ apiKey: "k", fetch })] });
  assert.equal(result.source, "decision-model");
  assert.equal(result.calibrated, true);
});

test("a provider's own threshold applies to its answers", async () => {
  const unsure = { ...CONFIDENT, confidence: 0.75 };
  const { fetch } = fakeFetch(answersReply({ only: unsure }));
  const strict = jevDecisionModel({ apiKey: "k", fetch, threshold: 0.9 });
  const result = await decide(STATE, FEATURE, { models: [strict] });
  assert.equal(result.fallback?.reason, "low-confidence");
});

test("a provider that does not support a kind leaves that decision to the next tier", async () => {
  const { fetch, calls } = fakeFetch(answersReply({}));
  const choiceOnly: DecisionModel = { ...jevDecisionModel({ apiKey: "k", fetch }), supports: new Set(["choice" as const]) };
  const result = await decide(STATE, IS_SCENE, { models: [choiceOnly] });
  assert.equal(calls.length, 0);
  assert.equal(result.source, "deterministic");
  assert.equal(result.fallback, null);
});

test("a per-question refusal falls back only that decision", async () => {
  const refuser: DecisionModel = {
    ...jevDecisionModel({ apiKey: "k", fetch: fakeFetch(answersReply({})).fetch }),
    decide: async () => ({ ok: true, answers: new Map([["scene", { kind: "refusal", detail: "declined" }], ["feature", { kind: "choice", label: "blur", confidence: 0.9, probabilities: { blur: 0.9 } }]]), usage: { model: null, inputTokens: null } }),
  };
  const results = await decideAll(STATE, { scene: IS_SCENE, feature: FEATURE }, { models: [refuser] });
  assert.equal(results.scene.fallback?.reason, "refused");
  assert.equal(results.feature.label, "blur");
});

test("a provider that throws is a fallback, never an exception", async () => {
  const broken: DecisionModel = { ...jevDecisionModel({ apiKey: "k", fetch: fakeFetch(answersReply({})).fetch }), decide: async () => { throw new Error("boom"); } };
  const result = await decide(STATE, IS_SCENE, { models: [broken] });
  assert.equal(result.fallback?.reason, "unavailable");
  assert.equal(result.fallback?.detail, "boom");
});

test("a provider is given the timeout signal and a fired signal reads as a timeout", async () => {
  const slow: DecisionModel = { ...jevDecisionModel({ apiKey: "k", fetch: fakeFetch(answersReply({})).fetch }), decide: async (_state, _questions, signal) => { throw signal.reason; } };
  const result = await decide(STATE, IS_SCENE, { models: [slow], timeoutSignal: () => AbortSignal.abort() });
  assert.equal(result.fallback?.reason, "timeout");
});

function languagePort(text: string): { readonly port: LanguageModelPort; readonly prompts: string[] } {
  const prompts: string[] = [];
  return { prompts, port: { id: "local-llm", completeJson: async (request) => { prompts.push(request.user); return text; } } };
}

test("the language model is asked only about decisions that opt in", async () => {
  const { port, prompts } = languagePort('```json\n{"answers":{"scene":{"probability":0.9}}}\n```');
  const results = await decideAll(STATE, { scene: { ...IS_SCENE, useModel: true as const }, feature: FEATURE }, { models: [languageDecisionModel(port)] });
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0]?.includes('"feature"'), false);
  assert.deepEqual([results.scene.source, results.scene.provider, results.scene.calibrated], ["model", "local-llm", false]);
  assert.equal(results.feature.source, "deterministic");
});

test("a decision model is tried before the language model whatever the order", async () => {
  const { port } = languagePort('{"answers":{"only":{"probabilities":{"glow":0,"blur":1,"none":0}}}}');
  const { fetch } = fakeFetch(answersReply({ only: CONFIDENT }));
  const spec = { ...FEATURE, useModel: true as const };
  const result = await decide(STATE, spec, { models: [languageDecisionModel(port), jevDecisionModel({ apiKey: "k", fetch })] });
  assert.equal(result.source, "decision-model");
});

test("a failed decision model hands an opted-in decision to the language model and keeps the reason", async () => {
  const { port } = languagePort('{"answers":{"only":{"probabilities":{"glow":0,"blur":1,"none":0}}}}');
  const { fetch } = fakeFetch(new Error("down"));
  const spec = { ...FEATURE, useModel: true as const };
  const result = await decide(STATE, spec, { models: [jevDecisionModel({ apiKey: "k", fetch }), languageDecisionModel(port)] });
  assert.equal(result.source, "model");
  assert.equal(result.label, "blur");
  assert.equal(result.fallback?.provider, "jev");
});

test("a language model reply that is not the promised JSON is a malformed fallback", async () => {
  const { port } = languagePort("I think it is a glow.");
  const result = await decide(STATE, { ...IS_SCENE, useModel: true as const }, { models: [languageDecisionModel(port)] });
  assert.equal(result.fallback?.reason, "malformed");
});
