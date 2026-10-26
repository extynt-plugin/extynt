// Tests for confidence routing: the act, verify and escalate bands, agreement, margins, stakes and the user's habits.
import assert from "node:assert/strict";
import test from "node:test";
import { choice, decide, jevDecisionModel } from "../src/index.js";
import { DEFAULT_VERIFY_MARGIN, STRONG_PREFERENCE } from "../src/route.js";
import { answersReply, fakeFetch } from "./support.js";
import type { Request } from "./support.js";

const BANDS = { verify: 0.5, act: 0.9 };

const PICK = choice({
  name: "pick",
  instructions: "Which one?",
  labels: { alpha: null, beta: null },
  bands: BANDS,
  deterministic: (state: Request) => (state.text === "a" ? "alpha" : "beta"),
});

function modelAnswering(label: string, confidence: number, alpha: number) {
  const { fetch } = fakeFetch(answersReply({ only: { type: "choice", choice: label, confidence, probabilities: { alpha, beta: 1 - alpha } } }));
  return { models: [jevDecisionModel({ apiKey: "k", fetch })] };
}

test("a confident answer is taken in the act band even against the deterministic answer", async () => {
  const result = await decide({ text: "a" }, PICK, modelAnswering("beta", 0.95, 0.02));
  assert.deepEqual([result.label, result.source, result.band], ["beta", "decision-model", "act"]);
});

test("an unsure answer is dropped in the escalate band", async () => {
  const result = await decide({ text: "a" }, PICK, modelAnswering("beta", 0.3, 0.4));
  assert.deepEqual([result.label, result.source, result.band, result.fallback?.reason], ["alpha", "deterministic", "escalate", "low-confidence"]);
});

test("in the verify band agreement takes the model's answer", async () => {
  const result = await decide({ text: "a" }, PICK, modelAnswering("alpha", 0.7, 0.8));
  assert.deepEqual([result.label, result.source, result.band], ["alpha", "decision-model", "verify"]);
});

test("in the verify band a disagreement is settled by the model's lead over the deterministic answer", async () => {
  const clear = await decide({ text: "a" }, PICK, modelAnswering("beta", 0.7, 0.1));
  assert.equal(clear.source, "decision-model");
  const close = await decide({ text: "a" }, PICK, modelAnswering("beta", 0.7, 0.5 - DEFAULT_VERIFY_MARGIN / 2));
  assert.deepEqual([close.source, close.label, close.band, close.fallback?.reason], ["deterministic", "alpha", "verify", "disagreement"]);
});

test("a high-stakes decision never takes a disagreeing answer in the verify band", async () => {
  const result = await decide({ text: "a" }, { ...PICK, stakes: "high" }, modelAnswering("beta", 0.7, 0.01));
  assert.deepEqual([result.source, result.fallback?.reason], ["deterministic", "disagreement"]);
});

test("a close call goes to the label the user habitually picks", async () => {
  const habitual = { ...PICK, preference: { beta: 2 } };
  const result = await decide({ text: "a" }, habitual, modelAnswering("beta", 0.7, 0.45));
  assert.deepEqual([result.source, result.label], ["decision-model", "beta"]);
  const other = await decide({ text: "a" }, { ...PICK, preference: { alpha: 2 } }, modelAnswering("beta", 0.7, 0.45));
  assert.equal(other.source, "deterministic");
});

test("a strong habit that matches the model's pick lifts a verify-band answer to act", async () => {
  const strong = { ...PICK, preference: { beta: STRONG_PREFERENCE, alpha: 1 } };
  const result = await decide({ text: "a" }, strong, modelAnswering("beta", 0.7, 0.45));
  assert.deepEqual([result.source, result.band], ["decision-model", "act"]);
});

test("without bands the spec or provider threshold alone separates taken from dropped", async () => {
  const plain = choice({ name: "plain", instructions: "?", labels: { alpha: null, beta: null }, deterministic: (state: Request) => (state.text === "a" ? "alpha" : "beta") });
  const taken = await decide({ text: "a" }, plain, modelAnswering("beta", 0.8, 0.1));
  assert.deepEqual([taken.source, taken.band], ["decision-model", "act"]);
  const dropped = await decide({ text: "a" }, plain, modelAnswering("beta", 0.6, 0.1));
  assert.equal(dropped.fallback?.reason, "low-confidence");
});

const GUARDED = choice<Request, "alpha" | "beta">({
  name: "guarded",
  instructions: "Which one?",
  labels: { alpha: null, beta: null },
  guarded: ["beta"],
  bands: BANDS,
  deterministic: (state: Request) => (state.text === "a" ? "alpha" : "beta"),
});

test("a guarded label is taken only in the act band", async () => {
  const sure = await decide({ text: "a" }, GUARDED, modelAnswering("beta", 0.95, 0.02));
  assert.deepEqual([sure.label, sure.source, sure.band], ["beta", "decision-model", "act"]);
  const unsure = await decide({ text: "a" }, GUARDED, modelAnswering("beta", 0.7, 0.1));
  assert.deepEqual([unsure.label, unsure.source, unsure.band], ["alpha", "deterministic", "verify"]);
});

test("an unguarded label is still settled by the model's lead in the verify band", async () => {
  const result = await decide({ text: "a" }, GUARDED, modelAnswering("alpha", 0.7, 0.9));
  assert.deepEqual([result.label, result.source], ["alpha", "decision-model"]);
});

test("a confident model answer that leaves the user's habit is not taken when the deterministic answer sits on the habit", async () => {
  const habitual = { ...PICK, preference: { alpha: 4 } };
  const held = await decide({ text: "a" }, habitual, modelAnswering("beta", 0.95, 0.02));
  assert.deepEqual([held.label, held.source, held.band], ["alpha", "deterministic", "verify"]);
  const elsewhere = await decide({ text: "b" }, habitual, modelAnswering("alpha", 0.95, 0.98));
  assert.deepEqual([elsewhere.label, elsewhere.source], ["alpha", "decision-model"]);
  const named = await decide({ text: "b" }, habitual, modelAnswering("beta", 0.95, 0.02));
  assert.deepEqual([named.label, named.source], ["beta", "decision-model"]);
});
