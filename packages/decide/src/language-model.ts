// The model tier: the user's own language model, reached through a narrow port, asked to answer decision questions as JSON.
import { array, decodeJson, number, object, record, string, union } from "@extynt/decode";
import type { Infer } from "@extynt/decode";
import { yesConfidence } from "./confidence.js";
import { LanguageModelFailure } from "./language-failure.js";
import type { JsonValue } from "./json.js";
import type { Answer, DecisionImage, DecisionModel, DecisionOutcome, Failure, ModelTier, Question } from "./port.js";
import type { Bands, DecisionKind } from "./spec.js";

/** One structured-output request to a language model; `image` rides the request only when the model accepts images. */
export interface LanguageModelRequest {
  readonly system: string;
  readonly user: string;
  readonly schema: SchemaObject;
  readonly signal: AbortSignal;
  readonly image?: DecisionImage;
}

/** The only thing the model tier needs from a language model: JSON text back for a prompt. */
export interface LanguageModelPort {
  readonly id: string;
  completeJson(request: LanguageModelRequest): Promise<string>;
}

const SUPPORTED: ReadonlySet<DecisionKind> = new Set(["choice", "labels", "score", "binary"]);

const MODEL_THRESHOLD = 0.8;

/** The bands the model tier routes with: a user's language model is not calibrated, so its answers are taken only when it states high confidence and are checked below that. */
export const LANGUAGE_MODEL_BANDS: Bands = { verify: MODEL_THRESHOLD, act: 0.9 };

const SYSTEM_PROMPT = [
  "You answer decision questions about the given state.",
  'Reply with only a JSON object {"answers": {"<id>": <answer>}} holding one answer for every question id.',
  'A "binary" answer is {"probability": p}. A "choice" or "labels" answer is {"probabilities": {"<label>": p}} with one entry for every label.',
  'A "score" answer is {"probabilities": [p0, p1, ...]} with one entry for every level, in order. Every p is between 0 and 1.',
].join(" ");

const reply = object({
  answers: record(string(), union(
    object({ probability: number({ min: 0, max: 1 }) }),
    object({ probabilities: record(string(), number({ min: 0, max: 1 })) }),
    object({ probabilities: array(number({ min: 0, max: 1 })) }),
  )),
});

type Stated = Infer<typeof reply>["answers"][string];

function indexOfLargest(values: ReadonlyArray<number>): number {
  return values.reduce((best, value, index) => (value > (values[best] ?? -Infinity) ? index : best), 0);
}

function readScore(probabilities: ReadonlyArray<number>, levels: number): Answer | null {
  const total = probabilities.reduce((sum, probability) => sum + probability, 0);
  if (probabilities.length !== levels || total <= 0) return null;
  const normalised = probabilities.map((probability) => probability / total);
  const expected = normalised.reduce((sum, probability, level) => sum + probability * level, 0);
  return { kind: "score", expected, confidence: Math.max(...normalised), probabilities: normalised };
}

function readChoice(probabilities: Readonly<Record<string, number>>): Answer | null {
  const labels = Object.keys(probabilities);
  const total = Object.values(probabilities).reduce((sum, probability) => sum + probability, 0);
  const best = labels[indexOfLargest(Object.values(probabilities))];
  if (best === undefined || total <= 0) return null;
  return { kind: "choice", label: best, confidence: (probabilities[best] ?? 0) / total, probabilities };
}

function readLabels(probabilities: Readonly<Record<string, number>>): Answer {
  const confidence = Math.min(...Object.values(probabilities).map((probability) => yesConfidence(probability)));
  return { kind: "labels", confidence, probabilities };
}

function isList(probabilities: Readonly<Record<string, number>> | ReadonlyArray<number>): probabilities is ReadonlyArray<number> {
  return Array.isArray(probabilities);
}

function readStated(stated: Stated, question: Question): Answer | null {
  if ("probability" in stated) return question.kind === "binary" ? { kind: "binary", probability: stated.probability, confidence: yesConfidence(stated.probability) } : null;
  const probabilities = stated.probabilities;
  if (question.kind === "score") return isList(probabilities) ? readScore(probabilities, question.levels.length) : null;
  if (isList(probabilities) || question.kind === "binary") return null;
  return question.kind === "choice" ? readChoice(probabilities) : readLabels(probabilities);
}

/** A JSON schema: an object whose values are JSON. */
export type SchemaObject = { readonly [key: string]: JsonValue };

const PROBABILITY = { type: "number", minimum: 0, maximum: 1 } as const;

function objectSchema(properties: Readonly<Record<string, JsonValue>>): SchemaObject {
  return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
}

function answerSchema(question: Question): SchemaObject {
  if (question.kind === "binary") return objectSchema({ probability: PROBABILITY });
  if (question.kind === "score") return objectSchema({ probabilities: { type: "array", items: PROBABILITY, minItems: question.levels.length, maxItems: question.levels.length } });
  return objectSchema({ probabilities: objectSchema(Object.fromEntries(question.labels.map((entry) => [entry.label, PROBABILITY]))) });
}

/** The JSON schema of a reply to these questions: one answer of the right shape for every question id, nothing else allowed. */
export function replySchema(questions: ReadonlyArray<Question>): SchemaObject {
  return objectSchema({ answers: objectSchema(Object.fromEntries(questions.map((question) => [question.id, answerSchema(question)]))) });
}

function jsonObjectIn(text: string): string {
  const open = text.indexOf("{");
  const close = text.lastIndexOf("}");
  return open >= 0 && close > open ? text.slice(open, close + 1) : text;
}

function answersOf(text: string, questions: ReadonlyArray<Question>): DecisionOutcome {
  const parsed = decodeJson(jsonObjectIn(text), reply);
  if (!parsed.ok) return { ok: false, failure: { reason: "malformed", detail: parsed.error.message } };
  const answers = new Map<string, Answer>();
  for (const question of questions) {
    const stated = Object.hasOwn(parsed.value.answers, question.id) ? parsed.value.answers[question.id] : undefined;
    const answer = stated === undefined ? null : readStated(stated, question);
    if (answer !== null) answers.set(question.id, answer);
  }
  return { ok: true, answers, usage: { model: null, inputTokens: null } };
}

const IMAGE_PROMPT = "A picture of the frame is attached; questions about the frame are judged from it together with the state.";

function requestOf(state: JsonValue, questions: ReadonlyArray<Question>, signal: AbortSignal, image: DecisionImage | undefined): LanguageModelRequest {
  const base = { user: JSON.stringify({ state, questions }), schema: replySchema(questions), signal };
  return image === undefined ? { system: SYSTEM_PROMPT, ...base } : { system: `${SYSTEM_PROMPT} ${IMAGE_PROMPT}`, ...base, image };
}

async function ask(port: LanguageModelPort, request: LanguageModelRequest, questions: ReadonlyArray<Question>): Promise<DecisionOutcome> {
  const { signal } = request;
  try {
    const text = await port.completeJson(request);
    return answersOf(text, questions);
  } catch (error) {
    return { ok: false, failure: failureOf(error instanceof Error ? error : null, signal) };
  }
}

function failureOf(error: Error | null, signal: AbortSignal): Failure {
  if (error instanceof LanguageModelFailure) return { reason: error.reason, detail: error.message };
  const detail = error === null ? "The language model failed." : error.message;
  return { reason: signal.aborted ? "timeout" : "unavailable", detail };
}

/** How a language model sits in the resolver: its tier, whether its confidences are real probabilities, the bands it carries (null to let each spec's own apply), and whether it reads a picture right now (asked at each call, because a model's capabilities can be learned later). */
export interface LanguageModelOptions {
  readonly tier?: ModelTier;
  readonly calibrated?: boolean;
  readonly bands?: Bands | null;
  readonly acceptsImages?: () => boolean;
  readonly imageOnly?: boolean;
}

function optionalFields(options: LanguageModelOptions): { bands?: Bands; imageOnly?: boolean } {
  const bands = options.bands === undefined ? LANGUAGE_MODEL_BANDS : options.bands;
  return { ...(bands === null ? {} : { bands }), ...(options.imageOnly === true ? { imageOnly: true } : {}) };
}

/** A decision model backed by a language model; it answers every kind natively, so it is only asked for decisions that opt in. By default it is the user's own model: tier "model", uncalibrated, with the conservative bands. */
export function languageDecisionModel(port: LanguageModelPort, threshold: number = MODEL_THRESHOLD, options: LanguageModelOptions = {}): DecisionModel {
  const accepts = options.acceptsImages ?? ((): boolean => false);
  return {
    id: port.id,
    tier: options.tier ?? "model",
    supports: SUPPORTED,
    calibrated: options.calibrated ?? false,
    threshold,
    ...optionalFields(options),
    get acceptsImages() { return accepts(); },
    decide: (state, questions, signal, image) => ask(port, requestOf(state, questions, signal, image), questions),
  };
}
