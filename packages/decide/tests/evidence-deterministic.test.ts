// Scores the offline tier of the evidence, continuation, waiver, review and turn decisions against the decision fixtures: each suite keeps its baseline and reaches 90%.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { array, boolean, decodeJson, number, object, string } from "@extynt/decode";
import type { Decoder } from "@extynt/decode";
import {
  ASKS_PICTURE_JUDGEMENT, CONTINUATION, ENDED_IN_PROSE, NEEDS_FRAME_EVIDENCE, NEEDS_MOTION_EVIDENCE, QUESTION_ANSWERED, REVIEW_PROVEN, VISUAL_WAIVER,
} from "../src/index.js";

function repositoryRoot(): string {
  let directory = import.meta.dirname;
  while (!existsSync(join(directory, "tools", "chat-tests"))) {
    const parent = dirname(directory);
    if (parent === directory) throw new Error("The repository root with tools/chat-tests was not found.");
    directory = parent;
  }
  return directory;
}

const FIXTURES = join(repositoryRoot(), "tools", "chat-tests", "fixtures", "decisions");

const EVIDENCE = object({ id: string(), goal: string(), temporal: boolean(), visual: boolean(), judgement: boolean() });
const CONTINUATION_ROW = object({ id: string(), message: string(), label: string() });
const WAIVER = object({
  id: string(), goal: string(), designed: boolean(), structuralOperations: boolean(), exactValuesOnly: boolean(), allConfirmed: boolean(), expected: boolean(),
});
const REVIEW = object({
  id: string(), goal: string(), specs: array(string()), batches: number(), exact: number(), approximate: number(), unconfirmed: number(),
  operations: array(string()), expected: boolean(),
});
const PROSE = object({ id: string(), answer: string(), sealed: boolean(), failed: boolean(), askedUser: boolean(), refused: boolean(), expected: boolean() });
const ANSWERED = object({ id: string(), answer: string(), askedUser: boolean(), cycle: number(), continuation: boolean(), authoredWork: boolean(), expected: boolean() });

type ReviewRow = {
  readonly goal: string; readonly specs: ReadonlyArray<string>; readonly batches: number; readonly exact: number;
  readonly approximate: number; readonly unconfirmed: number; readonly operations: ReadonlyArray<string>; readonly expected: boolean;
};

function rowsOf<T>(path: ReadonlyArray<string>, row: Decoder<T>): ReadonlyArray<T> {
  const decoded = decodeJson(readFileSync(join(FIXTURES, ...path), "utf8"), object({ cases: array(row) }));
  if (!decoded.ok) throw new Error(`Fixture ${path.join("/")} is malformed: ${decoded.error.message}`);
  return decoded.value.cases;
}

type Suite = { readonly name: string; readonly baseline: number; readonly correct: ReadonlyArray<boolean> };

function evidenceSuite(name: "temporal" | "visual" | "judgement", baseline: number): Suite {
  const spec = name === "temporal" ? NEEDS_MOTION_EVIDENCE : name === "visual" ? NEEDS_FRAME_EVIDENCE : ASKS_PICTURE_JUDGEMENT;
  const rows = rowsOf(["evidence-kinds.json"], EVIDENCE);
  return { name: `evidence-${name}`, baseline, correct: rows.map((row) => spec.deterministic({ goal: row.goal }) === row[name]) };
}

const SUITES: ReadonlyArray<Suite> = [
  evidenceSuite("temporal", 26),
  evidenceSuite("visual", 19),
  evidenceSuite("judgement", 29),
  { name: "continuation", baseline: 9, correct: rowsOf(["continuation.json"], CONTINUATION_ROW).map((row) => CONTINUATION.deterministic({ message: row.message }) === row.label) },
  {
    name: "visual-waiver",
    baseline: 15,
    correct: rowsOf(["visual-waiver.json"], WAIVER).map(({ goal, designed, structuralOperations, exactValuesOnly, allConfirmed, expected }) =>
      VISUAL_WAIVER.deterministic({ goal, designed, structuralOperations, exactValuesOnly, allConfirmed }) === expected),
  },
  { name: "review-proven-heldout", baseline: 5, correct: rowsOf(["heldout/review-proven.json"], REVIEW).map(scoreReview) },
  { name: "review-proven", baseline: 12, correct: rowsOf(["review-proven.json"], REVIEW).map(scoreReview) },
  { name: "ended-in-prose", baseline: 14, correct: rowsOf(["ended-in-prose.json"], PROSE).map(scoreProse) },
  { name: "question-answered", baseline: 14, correct: rowsOf(["question-answered.json"], ANSWERED).map(scoreAnswered) },
];

function scoreReview(row: ReviewRow): boolean {
  return REVIEW_PROVEN.deterministic(row) === row.expected;
}

type ProseRow = { readonly answer: string; readonly sealed: boolean; readonly failed: boolean; readonly askedUser: boolean; readonly refused: boolean; readonly expected: boolean };

type AnsweredRow = { readonly answer: string; readonly askedUser: boolean; readonly cycle: number; readonly continuation: boolean; readonly authoredWork: boolean; readonly expected: boolean };

function scoreProse({ expected, ...state }: ProseRow): boolean {
  return ENDED_IN_PROSE.deterministic(state) === expected;
}

function scoreAnswered({ expected, ...state }: AnsweredRow): boolean {
  return QUESTION_ANSWERED.deterministic(state) === expected;
}

for (const suite of SUITES) {
  test(`${suite.name} keeps its baseline and scores at least 90 percent`, () => {
    const correct = suite.correct.filter((ok) => ok).length;
    assert.ok(correct >= suite.baseline, `${suite.name}: ${correct} correct, baseline ${suite.baseline}`);
    assert.ok(correct * 10 >= suite.correct.length * 9, `${suite.name}: ${correct}/${suite.correct.length} correct`);
  });
}
