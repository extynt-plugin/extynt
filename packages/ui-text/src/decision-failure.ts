// Why a decision-model test failed, in words of the reader's language: the code the model library reports, never its English detail.
import type { UiKey } from "./catalogue.js";
import type { Translate } from "./translate.js";

/** The reasons a decision model can fail to answer (the model library's FailureReason), each with a sentence in every language. */
export const DECISION_FAILURE_CODES = [
  "unauthorized",
  "rejected",
  "backoff",
  "unavailable",
  "refused",
  "timeout",
  "malformed",
  "low-confidence",
  "disagreement",
  "state-too-large",
  "image-unavailable",
] as const;

/** One of the failure reasons. */
export type DecisionFailureCode = (typeof DECISION_FAILURE_CODES)[number];

const FAILURE_KEYS = {
  unauthorized: "settings.decision.failure.unauthorized",
  rejected: "settings.decision.failure.rejected",
  backoff: "settings.decision.failure.backoff",
  unavailable: "settings.decision.failure.unavailable",
  refused: "settings.decision.failure.refused",
  timeout: "settings.decision.failure.timeout",
  malformed: "settings.decision.failure.malformed",
  "low-confidence": "settings.decision.failure.low-confidence",
  disagreement: "settings.decision.failure.disagreement",
  "state-too-large": "settings.decision.failure.state-too-large",
  "image-unavailable": "settings.decision.failure.image-unavailable",
} as const satisfies Record<DecisionFailureCode, UiKey>;

/** The sentence for a failure code; without a code (a failure that is not one of the model's) the reason as the sidecar wrote it. */
export function decisionFailureText(say: Translate, code: DecisionFailureCode | undefined, reason: string): string {
  return code === undefined ? reason : say(FAILURE_KEYS[code]);
}
