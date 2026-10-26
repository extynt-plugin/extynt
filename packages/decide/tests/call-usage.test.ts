// Tests for the per-call usage hook: each answered model call is reported once with the tokens it billed, and a failed call reports nothing.
import assert from "node:assert/strict";
import test from "node:test";
import { binary, decideAll, type Answer, type CallUsage, type DecisionModel, type JsonValue } from "../src/index.js";

function sure(): Answer {
  return { kind: "binary", probability: 0.95, confidence: 0.95 };
}

const PROBES = {
  alpha: binary<JsonValue>({ name: "probe-alpha", instructions: "Is it alpha?", deterministic: () => false }),
  beta: binary<JsonValue>({ name: "probe-beta", instructions: "Is it beta?", deterministic: () => false }),
};

function modelReturning(outcome: "answer" | "failure"): DecisionModel {
  return {
    id: "jev",
    tier: "decision-model",
    supports: new Set(["binary"]),
    calibrated: true,
    threshold: 0.5,
    async decide(_state, questions) {
      if (outcome === "failure") return { ok: false, failure: { reason: "unavailable", detail: "down" } };
      return { ok: true, answers: new Map<string, Answer>(questions.map((question) => [question.id, sure()])), usage: { model: "jev-1.14.0", inputTokens: 321 } };
    },
  };
}

test("an answered batch is reported once, with the tokens its call billed, however many questions it answered", async () => {
  const calls: CallUsage[] = [];
  await decideAll({ text: "glow" }, PROBES, { models: [modelReturning("answer")], onCall: (call) => { calls.push(call); } });
  assert.deepEqual(calls, [{ provider: "jev", model: "jev-1.14.0", inputTokens: 321 }]);
});

test("a failed call reports no usage", async () => {
  const calls: CallUsage[] = [];
  await decideAll({ text: "glow" }, PROBES, { models: [modelReturning("failure")], onCall: (call) => { calls.push(call); } });
  assert.deepEqual(calls, []);
});
