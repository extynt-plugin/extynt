// Request scale and continuation: whether a request is small enough to be one item, and what a message sent to a stopped job means.
import { choice } from "./spec.js";
import type { ChoiceSpec } from "./spec.js";
import { continuationReading } from "./evidence-continuation.js";
import { isLongRequest, scaleConfidence } from "./request-shape.js";
import type { RequestText } from "./request-parts.js";

export { SMALL_REQUEST_MAX_CHARS, SMALL_REQUEST_MAX_THINGS } from "./request-shape.js";

/** What the continuation decision reads: the user's message to a job that has stopped. */
export type StoppedJobMessage = { readonly message: string };

const CONTINUATION_PHRASES: ReadonlySet<string> = new Set(["continue", "please continue", "continue please", "keep going", "go on", "resume", "carry on"]);

/** Whether the message is exactly one of the short phrases that re-authorise a stopped job. */
export function isContinuationPhrase(message: string): boolean {
  return CONTINUATION_PHRASES.has(message.trim().toLowerCase().replace(/[\s.!]+$/u, ""));
}

/** Whether a request is one small item or a long one with several sections, shots or deliverables, in any language. */
export const REQUEST_SCALE: ChoiceSpec<RequestText, "small" | "long"> = choice<RequestText, "small" | "long">({
  name: "request-scale",
  useModel: true,
  instructions: "A motion designer's request asks for work in After Effects. Decide whether it is one small item, a single thing to make or change, or a long request with several separate sections, shots, deliverables or named parts.",
  labels: {
    small: "one thing to make or change: one effect, one layer, one adjustment, or a few closely related values",
    long: "several separate sections, shots, deliverables or named parts that each need building and checking",
  },
  abstainBelow: 0.6,
  deterministic: (state) => (isLongRequest(state.request) ? "long" : "small"),
  deterministicConfidence: (state, answer) => scaleConfidence(state.request, answer === "long"),
});

/** What the user's message means for a job that stopped: carry on as it was, carry on with a change, or start something new; any language. */
export const CONTINUATION: ChoiceSpec<StoppedJobMessage, "resume" | "amend-and-resume" | "new-request"> = choice<StoppedJobMessage, "resume" | "amend-and-resume" | "new-request">({
  name: "continuation",
  instructions: "A job that builds a motion graphics request in After Effects stopped before it finished, and the user wrote a message. Decide what the message means for the stopped job.",
  labels: {
    resume: "the user only wants the stopped job to carry on as it was, with nothing added or changed",
    "amend-and-resume": "the user wants the stopped job to carry on and adds a correction, a detail or a change to what it builds",
    "new-request": "the user asks for something different, or asks a question, and does not want the stopped job carried on",
  },
  deterministic: (state) => continuationReading(state.message),
});
