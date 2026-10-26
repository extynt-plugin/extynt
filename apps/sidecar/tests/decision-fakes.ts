// Test doubles for the decision tier: a scripted decision model that records every request it receives, and a decision service over it with a log kept in memory.
import type { Answer, DecisionImage, DecisionKind, DecisionModel, JsonValue, Question } from "@extynt/decide";
import type { DecisionLog, DecisionLogRow } from "../src/decision-log.js";
import { DecisionService } from "../src/decision-service.js";

/** One request the scripted model received. */
export interface ModelCall {
  readonly state: JsonValue;
  readonly questions: ReadonlyArray<Question>;
  readonly image: DecisionImage | undefined;
}

/** A decision model whose answers a script gives, with the requests it saw. */
export interface ScriptedModel {
  readonly model: DecisionModel;
  readonly calls: ModelCall[];
}

const ALL_KINDS: ReadonlySet<DecisionKind> = new Set(["choice", "labels", "score", "binary"]);

/** A confident yes or no answer. */
export function yesNo(value: boolean, confidence = 0.95): Answer {
  return { kind: "binary", probability: value ? confidence : 1 - confidence, confidence };
}

/** A confident pick of one label. */
export function picked(label: string, confidence = 0.95): Answer {
  return { kind: "choice", label, confidence, probabilities: { [label]: confidence } };
}

/** A confident answer for a labels question: the given labels apply, every other label does not. */
export function applying(applies: ReadonlySet<string>, labels: ReadonlyArray<string>, confidence = 0.95): Answer {
  return { kind: "labels", confidence, probabilities: Object.fromEntries(labels.map((label) => [label, applies.has(label) ? confidence : 1 - confidence])) };
}

/** A model that answers each question with the script, or fails the whole request when the script is an error. */
export function scriptedModel(script: (question: Question) => Answer, failure?: "timeout" | "unavailable", acceptsImages?: true): ScriptedModel {
  const calls: ModelCall[] = [];
  const model: DecisionModel = {
    id: "scripted",
    tier: "decision-model",
    supports: ALL_KINDS,
    calibrated: true,
    threshold: 0.5,
    ...(acceptsImages === undefined ? {} : { acceptsImages }),
    async decide(state, questions, _signal, image) {
      calls.push({ state, questions, image });
      if (failure !== undefined) return { ok: false, failure: { reason: failure, detail: "scripted failure" } };
      return { ok: true, answers: new Map(questions.map((question) => [question.id, script(question)])), usage: { model: "scripted", inputTokens: 1 } };
    },
  };
  return { model, calls };
}

/** A decision service over the given models whose log rows are collected. */
export function serviceOver(models: ReadonlyArray<DecisionModel>): { readonly service: DecisionService; readonly rows: DecisionLogRow[] } {
  const rows: DecisionLogRow[] = [];
  const log: DecisionLog = { record: (batch) => { rows.push(...batch); } };
  return { service: new DecisionService({ models: () => models, log, now: () => new Date(0) }), rows };
}

/** A model of the user's own language-model tier, answering like `scriptedModel`: it is asked only for what the offline tier abstains on. */
export function scriptedChatModel(script: (question: Question) => Answer, failure?: "timeout" | "unavailable"): ScriptedModel {
  const scripted = scriptedModel(script, failure);
  return { model: { ...scripted.model, id: "scripted-chat", tier: "model", calibrated: false }, calls: scripted.calls };
}
