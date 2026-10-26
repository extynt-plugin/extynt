// The model-tier choice: when the user configured two different tool-calling models, a request the decision models confidently call simple runs on the fallback (the lighter one) first; with one model it changes nothing.
import { MODEL_TIER } from "@extynt/decide";
import type { ChatProvider } from "@extynt/llm";
import { canRunAgent } from "./agent.js";
import { bookedBand, bookedOneOf } from "./decision-book.js";
import { primeJobOpen } from "./decision-prime.js";
import type { SidecarState } from "./server-state.js";
import { workflowGoalText } from "./workflow-coordinator-types.js";

const ACT_BAND = "act";

interface TierOrder {
  readonly primary: ChatProvider;
  readonly fallback: ChatProvider | undefined;
}

function differ(primary: ChatProvider, fallback: ChatProvider): boolean {
  return primary.id !== fallback.id || primary.model !== fallback.model;
}

/** Puts the fallback first when both models can run an agent, they differ, and a model settled the request as fast-tier work in the act band; otherwise the order is unchanged. */
export async function tierOrder(state: Pick<SidecarState, "decisions">, providers: TierOrder, message: string): Promise<TierOrder> {
  const { primary, fallback } = providers;
  if (fallback === undefined || !state.decisions.hasModels() || !canRunAgent(primary) || !canRunAgent(fallback) || !differ(primary, fallback)) return providers;
  const text = workflowGoalText(message);
  await primeJobOpen(state.decisions, { request: text, message });
  const entry = { decision: MODEL_TIER.name, text };
  const fast = bookedOneOf(entry, ["fast"]) === "fast" && bookedBand(entry) === ACT_BAND;
  return fast ? { primary: fallback, fallback: primary } : providers;
}
