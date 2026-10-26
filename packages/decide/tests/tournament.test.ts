// Tests for the tournament: partitioning, batching of the first round, the final question, recursion and the offline fallback.
import assert from "node:assert/strict";
import test from "node:test";
import { partitionCandidates, tournamentChoice } from "../src/index.js";
import type { Answer, Candidate, DecisionModel, Question } from "../src/index.js";

const OPTIONS = { name: "thing", instructions: "Pick the thing.", noneMeaning: "none of them" };

function candidates(count: number): ReadonlyArray<Candidate> {
  return Array.from({ length: count }, (_, index) => {
    const number = String(index).padStart(4, "0");
    return { key: `EX ${number}`, names: [`EX ${number}`, `Example Effect ${number}`], group: `Group ${index % 7}`, title: `Example Effect ${number}` };
  });
}

function answerFor(question: Question, wanted: string): Answer {
  const labels = question.kind === "choice" ? question.labels.map((entry) => entry.label) : [];
  const label = labels.includes(wanted) ? wanted : "none";
  return { kind: "choice", label, confidence: 0.99, probabilities: Object.fromEntries(labels.map((name) => [name, name === label ? 0.99 : 0.01 / Math.max(1, labels.length - 1)])) };
}

function scripted(wanted: string): { model: DecisionModel; requests: number[] } {
  const requests: number[] = [];
  const model: DecisionModel = {
    id: "fake", tier: "decision-model", supports: new Set(["choice" as const]), calibrated: true, threshold: 0.7,
    async decide(_state, questions) {
      requests.push(questions.length);
      return { ok: true, answers: new Map(questions.map((question) => [question.id, answerFor(question, wanted)])), usage: { model: "fake", inputTokens: 1 } };
    },
  };
  return { model, requests };
}

test("every group holds at most the limit and every candidate lands in one group", () => {
  const groups = partitionCandidates(candidates(300), 40, (candidate) => candidate.group, (candidate) => candidate.key);
  assert.ok(groups.every((group) => group.length <= 40));
  assert.equal(groups.flat().length, 300);
  assert.equal(new Set(groups.flat().map((candidate) => candidate.key)).size, 300);
});

test("a group above the limit is cut into balanced chunks", () => {
  const same = candidates(100).map((candidate) => ({ ...candidate, group: "One" }));
  const sizes = partitionCandidates(same, 40, (candidate) => candidate.group, (candidate) => candidate.key).map((group) => group.length);
  assert.deepEqual(sizes, [34, 34, 32]);
});

test("a short list is one final question", async () => {
  const { model, requests } = scripted("EX 0003");
  const result = await tournamentChoice("example effect 0003", candidates(10), OPTIONS, { models: [model] });
  assert.deepEqual([result.key, result.rounds, requests.length], ["EX 0003", 1, 1]);
});

test("a long list asks its groups in one batch and then one final question", async () => {
  const { model, requests } = scripted("EX 0250");
  const result = await tournamentChoice("a synonym nothing matches", candidates(300), OPTIONS, { models: [model] });
  assert.equal(result.key, "EX 0250");
  assert.equal(result.rounds, 2);
  assert.equal(requests.length, 2);
  assert.equal(requests[0], result.questions - 1);
});

test("two thousand candidates recurse until the final question fits", async () => {
  const { model, requests } = scripted("EX 1999");
  const result = await tournamentChoice("a synonym nothing matches", candidates(2000), OPTIONS, { models: [model] });
  assert.equal(result.key, "EX 1999");
  assert.ok(result.shortlist.length <= 40);
  assert.ok(requests.length <= 4);
});

test("with no models the answer is the word search's at any size", async () => {
  const found = await tournamentChoice("effect 1234", candidates(2000), OPTIONS, {});
  assert.equal(found.key, "EX 1234");
  const missing = await tournamentChoice("blur", candidates(2000), OPTIONS, {});
  assert.equal(missing.key, "none");
});
