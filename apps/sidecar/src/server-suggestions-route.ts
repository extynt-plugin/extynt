// The panel's prompt-suggestion route: model-written prompts for the selected layers, always answered with a list that may be empty and says why.
import { object, string } from "@extynt/decode";
import type { ToolCallingProvider } from "@extynt/llm";

import { canRunAgent } from "./agent.js";
import type { HttpRoutesDeps } from "./server-http-state.js";
import { requirePairedPanel } from "./server-paired-panel.js";
import { uniformBody } from "./server-route-body.js";
import { bodyRoute, ok, type MountedRoute } from "./server-route-table.js";
import { habitsLine } from "./suggestion-prompt.js";
import type { SuggestionOutcome } from "./suggestion-service.js";

const SUGGESTIONS_BODY_LIMIT_BYTES = 1_024;
const MAX_FINGERPRINT_CHARS = 128;

type Reason = SuggestionOutcome["reason"] | "NO_MODEL" | "MOCK_MODEL" | "CHAT_BUSY" | "NO_SNAPSHOT" | "SELECTION_CHANGED";

interface SuggestionsAnswer {
  readonly ok: true;
  readonly suggestions: readonly string[];
  readonly source: SuggestionOutcome["source"];
  readonly reason: Reason;
  readonly writeAuthorizing: false;
  readonly retryAfterMs?: number;
  readonly usage?: SuggestionOutcome["usage"];
}

const INVALID_REQUEST = { status: 400, code: "INVALID_JSON", message: "The request must be a JSON object with a selectionFingerprint." } as const;
const selectionBody = object({ selectionFingerprint: string({ minLength: 1, maxLength: MAX_FINGERPRINT_CHARS }) });

function withoutSuggestions(reason: Reason): SuggestionsAnswer {
  return { ok: true, suggestions: [], source: "none", reason, writeAuthorizing: false };
}

function chosenProvider(deps: HttpRoutesDeps): ToolCallingProvider | undefined {
  const { chatProvider: primary, fallbackChatProvider: fallback } = deps.state;
  return canRunAgent(primary) ? primary : canRunAgent(fallback) ? fallback : undefined;
}

function offlineStandIn(deps: HttpRoutesDeps, provider: ToolCallingProvider): boolean {
  return provider.id === "mock" && deps.state.options.modelSettings !== undefined;
}

function answeredByModel(outcome: SuggestionOutcome): SuggestionsAnswer {
  return { ...withoutSuggestions(outcome.reason), suggestions: outcome.suggestions, source: outcome.source, ...(outcome.retryAfterMs === undefined ? {} : { retryAfterMs: outcome.retryAfterMs }), ...(outcome.usage ? { usage: outcome.usage } : {}) };
}

async function suggestionsFor(deps: HttpRoutesDeps, selectionFingerprint: string): Promise<SuggestionsAnswer> {
  const provider = chosenProvider(deps);
  if (!provider) return withoutSuggestions("NO_MODEL");
  if (offlineStandIn(deps, provider)) return withoutSuggestions("MOCK_MODEL");
  if (deps.state.activeChatTurn) return withoutSuggestions("CHAT_BUSY");
  const snapshot = deps.dispatch.normalizedLatest();
  if (!snapshot) return withoutSuggestions("NO_SNAPSHOT");
  if (snapshot.selectionFingerprint !== selectionFingerprint) return withoutSuggestions("SELECTION_CHANGED");
  const outcome = await deps.state.suggestions.suggest({ snapshot, selectionFingerprint, provider, habits: habitsLine(deps.state.collection.effectNotes), now: deps.state.now().getTime() });
  return answeredByModel(outcome);
}

/** `POST /v1/suggestions {selectionFingerprint}`: two to four short prompts the model writes for the selected layers. Paired panel only. It asks for nothing to be applied and changes no project, plan or setting. */
export const suggestionsRoutes: readonly MountedRoute[] = [
  bodyRoute({
    method: "POST",
    path: "/v1/suggestions",
    guard: requirePairedPanel("Suggestions require the paired panel instance."),
    body: uniformBody(selectionBody, SUGGESTIONS_BODY_LIMIT_BYTES, INVALID_REQUEST),
    handle: async ({ deps, body }) => ok(await suggestionsFor(deps, body.selectionFingerprint)),
  }),
];
