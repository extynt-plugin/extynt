// Tests for the answers a model never gets to give: a deterministic-only decision is not asked, and a strict yes stands against a model's no.
import assert from "node:assert/strict";
import test from "node:test";
import { MODAL_RISK, binary, decide, vetoFor, type Answer, type DecisionModel, type JsonValue } from "../src/index.js";

function modelSaying(probability: number, asked: string[]): DecisionModel {
  return {
    id: "jev",
    tier: "decision-model",
    supports: new Set(["binary", "choice"]),
    calibrated: true,
    threshold: 0.5,
    async decide(_state, questions) {
      asked.push(...questions.map((question) => question.id));
      const answer = (question: { readonly kind: string }): Answer => question.kind === "binary"
        ? { kind: "binary", probability, confidence: Math.abs(2 * probability - 1) }
        : { kind: "choice", label: "opens-dialog", probabilities: { "opens-dialog": 1 }, confidence: 1 };
      return { ok: true, answers: new Map<string, Answer>(questions.map((question) => [question.id, answer(question)])), usage: { model: "jev-1.14.0", inputTokens: 1 } };
    },
  };
}

test("a lookup over scan facts is answered from the facts and no model is asked", async () => {
  const asked: string[] = [];
  const state = { matchName: "ADBE Gaussian Blur 2", displayName: "Gaussian Blur", hasOptionsDialog: null };
  const result = await decide(state, MODAL_RISK, { models: [modelSaying(1, asked)] });
  assert.equal(result.source, "deterministic");
  assert.equal(result.label, "no-dialog");
  assert.deepEqual(asked, []);
});

function core(value: boolean): { readonly probability: number; readonly value: boolean; readonly confidence: number } {
  return { probability: value ? 1 : 0, value, confidence: 1 };
}

test("a model's no does not overrule the strict yes of review-proven, but it does overrule an ordinary yes", () => {
  const strict = binary<JsonValue>({ name: "review-proven", instructions: "Is it proven?", deterministic: () => true });
  const ordinary = binary<JsonValue>({ name: "probe-ordinary", instructions: "Is it so?", deterministic: () => true });
  assert.equal(vetoFor(strict, core(true), core(false))?.reason, "disagreement");
  assert.equal(vetoFor(ordinary, core(true), core(false)), null);
  assert.equal(vetoFor(strict, core(false), core(true)), null);
});
