// Tests for the model tier's reply schema, its conservative bands and the model-supplied bands taking priority in routing.
import assert from "node:assert/strict";
import test from "node:test";
import { LANGUAGE_MODEL_BANDS, REVIEW_PROVEN, decide, languageDecisionModel, replySchema } from "../src/index.js";
import type { DecisionModel, LanguageModelRequest, Question } from "../src/index.js";
import { IS_SCENE } from "./support.js";

const QUESTIONS: ReadonlyArray<Question> = [
  { id: "scene", kind: "binary", instructions: "Is it a scene?" },
  { id: "feature", kind: "choice", instructions: "Which?", labels: [{ label: "glow", description: null }, { label: "blur", description: null }] },
];

test("the reply schema is closed and names every question once", () => {
  const schema = replySchema(QUESTIONS);
  assert.deepEqual(schema.required, ["answers"]);
  assert.equal(schema.additionalProperties, false);
  assert.match(JSON.stringify(schema), /"scene"/);
  assert.match(JSON.stringify(schema), /"glow"/);
});

test("the language model tier asks with the schema and carries conservative bands", async () => {
  const seen: LanguageModelRequest[] = [];
  const model = languageDecisionModel({ id: "chat", completeJson: async (request) => { seen.push(request); return "{}"; } });
  assert.deepEqual(model.bands, LANGUAGE_MODEL_BANDS);
  assert.ok(LANGUAGE_MODEL_BANDS.act > LANGUAGE_MODEL_BANDS.verify);
  await model.decide({}, QUESTIONS, new AbortController().signal);
  assert.deepEqual(seen[0]?.schema, replySchema(QUESTIONS));
});

test("a model's own bands decide routing before the spec's: an 0.85 yes is verified, not acted on", async () => {
  const model: DecisionModel = {
    id: "stub", tier: "model", supports: new Set(["binary"]), calibrated: false, threshold: 0.5, bands: { verify: 0.5, act: 0.99 },
    decide: async () => ({ ok: true, answers: new Map([["scene", { kind: "binary", probability: 0.85, confidence: 0.85 }]]), usage: { model: null, inputTokens: null } }),
  };
  const result = await decide({ text: "x" }, { ...IS_SCENE, useModel: true }, { models: [model] });
  assert.notEqual(result.band, "act");
});

test("the review spec has no deterministic yes: with no model the work is always reviewed", async () => {
  assert.equal(REVIEW_PROVEN.deterministic({ goal: "g", specs: [], batches: 1, exact: 1, approximate: 0, unconfirmed: 0, operations: [] }), false);
});
