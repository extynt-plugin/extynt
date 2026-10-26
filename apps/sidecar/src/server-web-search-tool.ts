// The web_search tool the model calls: checks the queries, refuses a model that may train on them, and answers from the configured provider's own search.
import type { ToolResult } from "./agent.js";
import type { JsonObject } from "@extynt/decode";
import type { SidecarState } from "./server-state.js";
import { trainingRefusal } from "./training-policy.js";
import { formatWebSearch, parseSearchQueries, searchBackendFor, searchWeb, type SearchBackend } from "./web-search.js";

type SearchState = Pick<SidecarState, "options">;

function failure(code: string, message: string): ToolResult {
  return { ok: false, error: { code, message } };
}

/** The search endpoint of the primary model, or undefined when its service has no search of its own. */
export function webSearchBackend(state: SearchState): SearchBackend | undefined {
  return searchBackendFor(state.options.modelSettings?.resolve("primary"));
}

function queriesOf(args: JsonObject): string[] | ToolResult {
  try {
    return parseSearchQueries(args.queries);
  } catch (error) {
    return failure("INVALID_QUERIES", error instanceof Error ? error.message : "web_search needs a list of queries.");
  }
}

/** Runs the model's searches. Every failure comes back as a tool error rather than a thrown turn, and the answer is `data` because the agent loop hands the model nothing else. */
export async function searchTheWeb(state: SearchState, args: JsonObject, signal?: AbortSignal): Promise<ToolResult> {
  const queries = queriesOf(args);
  if (!Array.isArray(queries)) return queries;
  const refusal = trainingRefusal(state.options.modelSettings?.resolve("primary"));
  if (refusal) return failure(refusal.code, refusal.message);
  const outcome = await searchWeb({ backend: webSearchBackend(state), queries, ...(signal ? { signal } : {}) }, state.options.fetch ?? fetch);
  return outcome.ok ? { ok: true, data: formatWebSearch(outcome) } : failure(outcome.code, outcome.message);
}
