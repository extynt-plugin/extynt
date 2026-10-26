// Tests for abstention: an offline answer below its spec's threshold is reported unsure in the escalate band, the confidence signals of the resolvers, and the retry of an unsure high-stakes answer on the user's model.
import assert from "node:assert/strict";
import test from "node:test";
import { REQUEST_PARTS, REQUEST_SCALE, binary, choice, controlChoice, decide, effectChoice, fontChoice, propertyChoice } from "../src/index.js";
import type { DecisionModel, Question } from "../src/index.js";
import { partsConfidence } from "../src/request-parts.js";
import { scaleConfidence } from "../src/request-shape.js";
import type { Request } from "./support.js";

const GUESS = choice({
  name: "guess",
  instructions: "Which?",
  labels: { alpha: null, beta: null },
  abstainBelow: 0.6,
  deterministic: (state: Request) => (state.text.length > 3 ? "alpha" : "beta"),
  deterministicConfidence: (state: Request) => state.text.length / 10,
});

test("an offline answer below the threshold is reported abstained, in the escalate band, with the same value", async () => {
  const unsure = await decide({ text: "abcde" }, GUESS);
  assert.deepEqual([unsure.label, unsure.source, unsure.band, unsure.abstained, unsure.confidence], ["alpha", "deterministic", "escalate", true, 0.5]);
});

test("an offline answer at or above the threshold is answered and carries its confidence", async () => {
  const sure = await decide({ text: "abcdefg" }, GUESS);
  assert.deepEqual([sure.label, sure.band, sure.abstained, sure.confidence], ["alpha", null, false, 0.7]);
});

test("a spec with no confidence function or no threshold never abstains and keeps confidence 1", async () => {
  const plain = await decide({ text: "a" }, NO_CONFIDENCE);
  assert.deepEqual([plain.confidence, plain.abstained, plain.band], [1, false, null]);
  const unbounded = await decide({ text: "a" }, NO_THRESHOLD);
  assert.deepEqual([unbounded.confidence, unbounded.abstained], [0.1, false]);
});

test("a confidence outside 0 to 1 is clamped", async () => {
  const wild = await decide({ text: "a" }, { ...GUESS, deterministicConfidence: () => 7 });
  assert.equal(wild.confidence, 1);
});

const IMPORTANT = binary({
  name: "important",
  instructions: "Is it important?",
  stakes: "high",
  abstainBelow: 0.8,
  deterministic: (state: Request) => state.text === "yes",
  deterministicConfidence: () => 0.4,
});

const NO_CONFIDENCE = choice({
  name: "no-confidence",
  instructions: "Which?",
  labels: { alpha: null, beta: null },
  abstainBelow: 0.6,
  deterministic: (state: Request) => (state.text.length > 3 ? "alpha" : "beta"),
});

const NO_THRESHOLD = choice({
  name: "no-threshold",
  instructions: "Which?",
  labels: { alpha: null, beta: null },
  deterministic: (state: Request) => (state.text.length > 3 ? "alpha" : "beta"),
  deterministicConfidence: (state: Request) => state.text.length / 10,
});

const ORDINARY = binary({
  name: "ordinary",
  instructions: "Is it important?",
  abstainBelow: 0.8,
  deterministic: (state: Request) => state.text === "yes",
  deterministicConfidence: () => 0.4,
});

function languageStub(answer: boolean): { readonly model: DecisionModel; readonly asked: Question[] } {
  const asked: Question[] = [];
  const model: DecisionModel = {
    id: "stub", tier: "model", supports: new Set(["binary"]), calibrated: false, threshold: 0.5, bands: { verify: 0.5, act: 0.9 },
    async decide(_state, questions) {
      asked.push(...questions);
      return { ok: true, answers: new Map(questions.map((question) => [question.id, { kind: "binary", probability: answer ? 0.99 : 0.01, confidence: 0.98 }])), usage: { model: "stub", inputTokens: 1 } };
    },
  };
  return { model, asked };
}

test("an unsure high-stakes answer is retried on the user's model even when the spec did not opt in", async () => {
  const { model, asked } = languageStub(true);
  const result = await decide({ text: "no" }, IMPORTANT, { models: [model] });
  assert.deepEqual([asked.length, result.source, result.value, result.abstained], [1, "model", true, false]);
});

test("a sure or ordinary answer is not retried on the user's model", async () => {
  const { model, asked } = languageStub(true);
  await decide({ text: "no" }, { ...IMPORTANT, deterministicConfidence: () => 0.9 }, { models: [model] });
  await decide({ text: "no" }, ORDINARY, { models: [model] });
  assert.equal(asked.length, 0);
});

test("when the retry fails the abstained offline answer stands", async () => {
  const failing: DecisionModel = { ...languageStub(true).model, async decide() { return { ok: false, failure: { reason: "unavailable", detail: "down" } }; } };
  const result = await decide({ text: "yes" }, IMPORTANT, { models: [failing] });
  assert.deepEqual([result.source, result.value, result.abstained, result.band, result.fallback?.reason], ["deterministic", true, true, "escalate", "unavailable"]);
});

const INSTALLED = [
  { matchName: "ADBE Gaussian Blur 2", displayName: "Gaussian Blur", category: "Blur & Sharpen" },
  { matchName: "ADBE Box Blur2", displayName: "Box Blur", category: "Blur & Sharpen" },
  { matchName: "ADBE Glo2", displayName: "Glow", category: "Stylize" },
];

test("an effect named outright is answered with high confidence, and a clear pick beats an ambiguous one", async () => {
  const named = await decide({ phrase: "glow" }, effectChoice(INSTALLED));
  const vague = await decide({ phrase: "blur" }, effectChoice(INSTALLED));
  assert.equal(named.label, "ADBE Glo2");
  assert.ok(named.confidence > vague.confidence, `${named.confidence} should exceed ${vague.confidence}`);
  assert.equal(named.abstained, false);
});

test("an effect request whose words no candidate holds is not a confident pick of a near candidate", async () => {
  const result = await decide({ phrase: "directional streak blur" }, effectChoice(INSTALLED));
  assert.ok(result.abstained || result.label === "none", `${result.label} at ${result.confidence}`);
});

test("a request that denies the effect is a decisive none", async () => {
  const result = await decide({ phrase: "no glow" }, effectChoice(INSTALLED));
  assert.deepEqual([result.label, result.abstained], ["none", false]);
});

test("words that match nothing give a milder none than a request with no content words", async () => {
  const unknown = await decide({ phrase: "zzqx wobble" }, effectChoice(INSTALLED));
  const empty = await decide({ phrase: "the" }, effectChoice(INSTALLED));
  assert.ok(unknown.confidence < empty.confidence);
});

test("a control or property that is the only candidate holding the words is answered", async () => {
  const controls = [{ matchName: "ADBE Gaussian Blur 2-0001", displayName: "Blurriness", valueType: "slider" }, { matchName: "ADBE Gaussian Blur 2-0002", displayName: "Blur Dimensions", valueType: "menu" }];
  const control = await decide({ phrase: "blurriness", effect: "Gaussian Blur" }, controlChoice(controls));
  assert.deepEqual([control.label, control.abstained], ["ADBE Gaussian Blur 2-0001", false]);
  const properties = [{ key: "opacity", title: "Opacity", group: "Transform" }, { key: "scale", title: "Scale", group: "Transform" }];
  const property = await decide({ phrase: "opacity", target: "layer" }, propertyChoice(properties));
  assert.deepEqual([property.label, property.abstained], ["opacity", false]);
});

test("a font named exactly is more sure than a family that only shares a word with the request", async () => {
  const installed = [{ family: "Helvetica Neue", style: "Regular", postScriptName: "HelveticaNeue" }, { family: "Roboto", style: "Regular", postScriptName: "Roboto-Regular" }];
  const exact = await decide({ phrase: "Roboto" }, fontChoice("Roboto", installed));
  const sibling = await decide({ phrase: "Helvetica" }, fontChoice("Helvetica", installed));
  assert.ok(exact.confidence > sibling.confidence, `${exact.confidence} should exceed ${sibling.confidence}`);
});

test("a request-parts reading is less sure the more mentioned features a cue refuses and the more it asks", () => {
  const plain = partsConfidence("Add a glow to the title", ["glow"]);
  const contested = partsConfidence("Add a glow but no blur and without a drop shadow", ["glow"]);
  const crowded = partsConfidence("glow blur shadow ramp wiggle camera null parent markers", ["glow", "blur", "drop-shadow", "ramp", "wiggle", "camera", "null", "parent", "markers"]);
  assert.equal(plain, 1);
  assert.ok(contested < plain && crowded < plain);
});

test("request-parts and request-scale carry the confidence of their reading", async () => {
  const parts = await decide({ request: "Add a glow to the title" }, REQUEST_PARTS);
  assert.deepEqual([[...parts.labels], parts.confidence, parts.abstained], [["glow"], 1, false]);
  const scale = await decide({ request: "Add a glow to the title" }, REQUEST_SCALE);
  assert.deepEqual([scale.label, scale.abstained], ["small", false]);
});

test("a request one signal short of long is an unsure small, and agreeing signals make a sure long", () => {
  const nearlyLong = "Build the intro. Build the middle part.\nThen the ending.";
  assert.ok(scaleConfidence(nearlyLong, false) < 0.6);
  const clearlyLong = "Build five sections: intro, three product features, and a closing card, each in its own composition.\n1. Intro\n2. Features\n3. Card";
  assert.ok(scaleConfidence(clearlyLong, true) >= 0.85);
  assert.equal(scaleConfidence("Add a glow to the title", false), 0.95);
});
