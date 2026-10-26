// The "system one" wire dialect: how questions are written into a request and how its answers are decoded and read back.
import { array, literal, number, object, optional, record, string, taggedUnion, union } from "@extynt/decode";
import type { Infer } from "@extynt/decode";
import { yesConfidence } from "./confidence.js";
import type { JsonValue } from "./json.js";
import type { Answer, Question } from "./port.js";

type WireQuestions = { readonly [id: string]: JsonValue };

const probabilities = record(string(), number());

const wireAnswer = taggedUnion("type", {
  choice: object({ type: literal("choice"), choice: string(), confidence: number(), probabilities }),
  score: object({ type: literal("score"), score: number(), confidence: number(), probabilities }),
  noul: object({ type: literal("noul"), noul: number({ min: 0, max: 1 }) }),
});

/** Decodes a successful reply; fields a vendor adds beyond these are ignored. */
export const wireReply = object({ answers: record(string(), wireAnswer), model: optional(string()), usage: optional(object({ input_tokens: number() })) });

/** Decodes a validation error body in the FastAPI style. */
export const wireProblem = object({ detail: array(object({ loc: array(union(string(), number())), msg: string() })) });

type WireAnswer = Infer<typeof wireAnswer>;

function wireQuestion(question: Question): JsonValue | null {
  switch (question.kind) {
    case "choice":
      return { type: "choice", instructions: question.instructions, criteria: Object.fromEntries(question.labels.map((entry) => [entry.label, entry.description])) };
    case "score":
      return { type: "score", instructions: question.instructions, criteria: [...question.levels] };
    case "binary":
      return { type: "noul", instructions: question.instructions, ...(question.criteria === undefined ? {} : { criteria: { true: question.criteria.true, false: question.criteria.false } }) };
    case "labels":
      return null;
  }
}

/** The questions keyed by id, or null when one is of a kind this dialect cannot ask. */
export function wireQuestions(questions: ReadonlyArray<Question>): WireQuestions | null {
  const wire: Record<string, JsonValue> = {};
  for (const question of questions) {
    const written = wireQuestion(question);
    if (written === null) return null;
    wire[question.id] = written;
  }
  return wire;
}

function scoreProbabilities(wire: Readonly<Record<string, number>>, levels: number): ReadonlyArray<number> | null {
  const ordered = Array.from({ length: levels }, (_, index) => wire[String(index)]);
  return ordered.every((value) => value !== undefined) ? ordered.map((value) => value ?? 0) : null;
}

function readScore(wire: Extract<WireAnswer, { readonly type: "score" }>, question: Question): Answer | null {
  if (question.kind !== "score") return null;
  const byLevel = scoreProbabilities(wire.probabilities, question.levels.length);
  return byLevel === null ? null : { kind: "score", expected: wire.score, confidence: wire.confidence, probabilities: byLevel };
}

function readAnswer(wire: WireAnswer, question: Question): Answer | null {
  switch (wire.type) {
    case "choice":
      return question.kind === "choice" ? { kind: "choice", label: wire.choice, confidence: wire.confidence, probabilities: wire.probabilities } : null;
    case "score":
      return readScore(wire, question);
    case "noul":
      return question.kind === "binary" ? { kind: "binary", probability: wire.noul, confidence: yesConfidence(wire.noul) } : null;
  }
}

/** The answer a decoded reply holds for the question, or null when it holds none or one that does not fit. */
export function answerFor(answers: Readonly<Record<string, WireAnswer>>, question: Question): Answer | null {
  const wire = Object.hasOwn(answers, question.id) ? answers[question.id] : undefined;
  return wire === undefined ? null : readAnswer(wire, question);
}
