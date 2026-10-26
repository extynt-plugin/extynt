// Whether the user's words name Layer Styles, so the agent knows a plain drop shadow or glow effect is not what they asked for; read by the chat agent.
import { bookedYesNo } from "./decision-book.js";

/** The answers to whether the user named Layer Styles. */
export const LAYER_STYLE_LABELS = ["names-layer-style", "does-not-name"] as const;

type LayerStyleLabel = (typeof LAYER_STYLE_LABELS)[number];

const LAYER_STYLE_WORDS = /\blayer[- ]?styles?\b/i;

/** Whether the turn, or the job's goal across its continuations, names Layer Styles. */
export function decideLayerStyleRequest(input: { message: string; workflowGoalSummary?: string }): LayerStyleLabel {
  const text = `${input.workflowGoalSummary ?? ""}\n${input.message}`;
  const booked = bookedYesNo({ decision: "layer-style-request", text });
  if (booked !== undefined) return booked ? "names-layer-style" : "does-not-name";
  return LAYER_STYLE_WORDS.test(`${input.workflowGoalSummary ?? ""}\n${input.message}`) ? "names-layer-style" : "does-not-name";
}

/** Whether the user's words name Layer Styles; only then is a plain drop shadow or glow effect not what they asked for. */
export function requestNamesLayerStyle(input: { message: string; workflowGoalSummary?: string }): boolean {
  return decideLayerStyleRequest(input) === "names-layer-style";
}
