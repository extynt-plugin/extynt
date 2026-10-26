// The failures an agent turn ends on by itself, worded in the language of the translator the turn was given: stopped by the user, out of steps, out of room, or its last plan refused.
import type { Translate } from "@extynt/ui-text";
import { ENGLISH_FAILURE_TEXT } from "./failure-english.js";
import type { AgentFailure, AgentRunInput } from "./agent-types.js";

const TOKENS_PER_K = 1000;

/** The translator a turn speaks with: the one its caller handed in, else English. */
export function turnText(input: Pick<AgentRunInput, "translate">): Translate {
  return input.translate ?? ENGLISH_FAILURE_TEXT;
}

/** The failure of a turn somebody stopped: never retried and never handed to the fallback model. */
export function cancelledFailure(t: Translate): AgentFailure {
  return { code: "CANCELLED", message: t("failure.turn.cancelled") };
}

/** The failure of a turn that used every step it was allowed. */
export function stepLimitFailure(t: Translate, steps: number): AgentFailure {
  return { code: "STEP_LIMIT", message: t("failure.turn.stepLimit", { steps }) };
}

/** The failure of a turn whose context outgrew the model's input budget even after folding. */
export function contextLimitFailure(t: Translate, sizes: { readonly reduced: number; readonly budget: number }): AgentFailure {
  return { code: "CONTEXT_LIMIT", message: t("failure.turn.contextLimit", { size: Math.round(sizes.reduced / TOKENS_PER_K), budget: Math.round(sizes.budget / TOKENS_PER_K) }) };
}

/** The failure of a turn that ended with its last plan refused and nothing else to show. */
export function planRejectedFailure(t: Translate, last: AgentFailure): AgentFailure {
  return { code: last.code, message: t("failure.turn.planRejected", { reason: last.message }) };
}
