// Web search through the key and model the reader already configured: DeepSeek exposes no search endpoint of its own, so the search runs inside a Messages turn on its Anthropic-compatible surface and no host or model is pinned here.
import { decodeOrThrow } from "@extynt/decode";
import type { JsonObject, JsonValue } from "@extynt/decode";
import { searchReplyDecoder, type SearchDialect, type WebSource } from "./web-search-payloads.js";

const SEARCH_TOOL_TYPE = "web_search_20250305";
const ANTHROPIC_VERSION = "2023-06-01";
const ANSWER_INSTRUCTION = "Answer in at most three sentences, and name the source you relied on.";
const DEFAULT_MAX_USES = 4;
const MAX_USES = 8;
const MAX_QUERIES = 4;
const MAX_QUERY_CHARS = 400;
const MAX_RESULTS = 8;
const SEARCH_TIMEOUT_MS = 90_000;
const ANSWER_CHARS = 700;
const ERROR_DETAIL_CHARS = 200;

/** Where one search goes: the dialect to speak, the endpoint, the key and the model that runs it. */
export interface SearchBackend {
  readonly dialect: SearchDialect;
  readonly endpoint: string;
  readonly apiKey: string;
  readonly model: string;
}

/** The part of a resolved model slot that decides whether and where a search can run. */
export interface SearchSlot {
  readonly format: string;
  readonly baseUrl: string;
  readonly apiKey: string | undefined;
  readonly model: string;
  readonly service: { readonly id: string };
}

interface WebSearchResult {
  readonly ok: true;
  readonly queries: readonly string[];
  readonly answer: string;
  readonly sources: readonly WebSource[];
  readonly searched: number;
}

/** A search's result, or the code and sentence for why it produced none. */
export type WebSearchOutcome = WebSearchResult | { readonly ok: false; readonly code: string; readonly message: string };

interface WebSearchRequest {
  readonly backend: SearchBackend | undefined;
  readonly queries: readonly string[];
  readonly maxResults?: number | undefined;
  readonly maxUses?: number | undefined;
  readonly signal?: AbortSignal | undefined;
}

interface WebSearchToolSpec {
  readonly name: string;
  readonly description: string;
  readonly parameters: {
    readonly type: "object";
    readonly properties: { readonly queries: { readonly type: "array"; readonly items: { readonly type: "string" }; readonly description: string } };
    readonly required: readonly string[];
    readonly additionalProperties: false;
  };
}

interface UsableSlot {
  readonly apiKey: string;
  readonly model: string;
  readonly base: string;
  readonly format: string;
  readonly serviceId: string;
}

const BACKEND_BUILDERS: Readonly<Record<string, (slot: UsableSlot) => SearchBackend>> = {
  deepseek: (slot) => ({ dialect: "anthropic", endpoint: `${/\/anthropic\/v1$/.test(slot.base) ? slot.base : `${slot.base}/anthropic/v1`}/messages`, apiKey: slot.apiKey, model: slot.model }),
  openai: (slot) => ({ dialect: "openai", endpoint: `${slot.base}/responses`, apiKey: slot.apiKey, model: slot.model }),
};

function usableSlot(slot: SearchSlot | undefined): UsableSlot | undefined {
  if (!slot?.apiKey || !slot.model) return undefined;
  const base = slot.baseUrl.replace(/\/+$/, "");
  return base ? { apiKey: slot.apiKey, model: slot.model, base, format: slot.format, serviceId: slot.service.id } : undefined;
}

/**
 * The search endpoint for a configured slot, or undefined when this build has no dialect for it.
 *
 * Derived, never pinned: a slot already speaking the Messages API searches there; DeepSeek's chat
 * base gets its Anthropic-compatible sibling appended (the chat base does not serve search); OpenAI
 * uses its Responses API. A service that offers neither gets no backend, so the tool is not offered.
 */
export function searchBackendFor(slot: SearchSlot | undefined): SearchBackend | undefined {
  const usable = usableSlot(slot);
  if (!usable) return undefined;
  if (usable.format === "anthropic") return { dialect: "anthropic", endpoint: `${usable.base}/messages`, apiKey: usable.apiKey, model: usable.model };
  return BACKEND_BUILDERS[usable.serviceId]?.(usable);
}

function searchPrompt(question: string): string {
  return `${question}\n\n${ANSWER_INSTRUCTION}`;
}

function anthropicSearchBody(backend: SearchBackend, question: string, maxUses: number): JsonObject {
  return {
    model: backend.model,
    max_tokens: 4096,
    messages: [{ role: "user", content: searchPrompt(question) }],
    tools: [{ type: SEARCH_TOOL_TYPE, name: "web_search", max_uses: maxUses }],
  };
}

function openAiSearchBody(backend: SearchBackend, question: string): JsonObject {
  return { model: backend.model, input: searchPrompt(question), tools: [{ type: "web_search" }] };
}

/** The model-facing tool; its argument shape mirrors the Harness's `web_search`. */
export function webSearchToolSpec(): WebSearchToolSpec {
  return {
    name: "web_search",
    description: "Search the web for current information: versions, release notes, documentation, error messages, anything that changed after training. Ask up to four queries at once; each returns a list of sources with urls you can cite.",
    parameters: { type: "object", properties: { queries: { type: "array", items: { type: "string" }, description: "One to four search queries." } }, required: ["queries"], additionalProperties: false },
  };
}

function queryText(entry: JsonValue): string {
  if (typeof entry !== "string") throw new Error("Every query must be a string.");
  const query = entry.trim().slice(0, MAX_QUERY_CHARS);
  if (!query) throw new Error("A query cannot be blank.");
  return query;
}

/** The distinct, trimmed queries in the model's list, at most `maxQueries` of them; anything that is not a usable list of strings throws a sentence the model can act on. */
export function parseSearchQueries(value: JsonValue | undefined, maxQueries: number = MAX_QUERIES): string[] {
  const list: readonly JsonValue[] = Array.isArray(value) ? value : [];
  const queries: string[] = [];
  for (const entry of list) {
    const query = queryText(entry);
    if (!queries.includes(query)) queries.push(query);
    if (queries.length >= maxQueries) break;
  }
  if (!queries.length) throw new Error("web_search needs at least one query.");
  return queries;
}

function linkedSearchController(signal: AbortSignal | undefined): { controller: AbortController; unlink: () => void } {
  const controller = new AbortController();
  const cancel = (): void => controller.abort(signal?.reason);
  if (signal?.aborted) cancel();
  else signal?.addEventListener("abort", cancel, { once: true });
  return { controller, unlink: () => signal?.removeEventListener("abort", cancel) };
}

function unreachableSearch(detail: string): WebSearchOutcome {
  return { ok: false, code: "SEARCH_UNREACHABLE", message: `The search provider could not be reached (${detail}).` };
}

function searchQuestion(queries: readonly string[]): string {
  return queries.length === 1 ? `Search the web for: ${queries[0]}` : `Search the web for each of these, then answer:\n${queries.map((query) => `- ${query}`).join("\n")}`;
}

function searchRequest(backend: SearchBackend, question: string, maxUses: number, signal: AbortSignal): RequestInit {
  return backend.dialect === "openai"
    ? { method: "POST", headers: { authorization: `Bearer ${backend.apiKey}`, "content-type": "application/json" }, body: JSON.stringify(openAiSearchBody(backend, question)), signal }
    : { method: "POST", headers: { "x-api-key": backend.apiKey, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json" }, body: JSON.stringify(anthropicSearchBody(backend, question, maxUses)), signal };
}

async function searchResponse(backend: SearchBackend, answer: Response, queries: readonly string[], maxResults: number): Promise<WebSearchOutcome> {
  if (!answer.ok) {
    const detail = await answer.text().catch(() => "");
    return { ok: false, code: `SEARCH_HTTP_${answer.status}`, message: `The search provider answered ${answer.status}${detail ? `: ${detail.slice(0, ERROR_DETAIL_CHARS)}` : "."}` };
  }
  const read = decodeOrThrow(searchReplyDecoder(backend.dialect, maxResults), await answer.json());
  if (!read.sources.length) return { ok: false, code: "SEARCH_NO_RESULTS", message: "The search provider returned no sources for that query." };
  return { ok: true, queries, answer: read.answer.slice(0, ANSWER_CHARS), sources: read.sources, searched: read.searched };
}

/** One search turn on the configured model and key; `request` is injected so the shape can be tested without a network. */
export async function searchWeb(options: WebSearchRequest, request: typeof globalThis.fetch = fetch): Promise<WebSearchOutcome> {
  const { backend } = options;
  if (!backend) return { ok: false, code: "NO_SEARCH_BACKEND", message: "Web search needs a configured provider that offers one; none of the settings in use does." };
  const maxResults = Math.max(1, Math.min(MAX_RESULTS, options.maxResults ?? MAX_RESULTS));
  const maxUses = Math.max(1, Math.min(MAX_USES, options.maxUses ?? DEFAULT_MAX_USES));
  const { controller, unlink } = linkedSearchController(options.signal);
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try {
    const answer = await request(backend.endpoint, searchRequest(backend, searchQuestion(options.queries), maxUses, controller.signal));
    return await searchResponse(backend, answer, options.queries, maxResults);
  } catch (error) { return unreachableSearch(error instanceof Error ? error.message : "request failed"); }
  finally { clearTimeout(timer); unlink(); }
}

/** Sources first, in provider order; the provider's own summary follows, marked as its wording rather than a source. */
export function formatWebSearch(outcome: WebSearchResult): string {
  const lines = outcome.sources.map((source, index) => `${index + 1}. ${source.title}${source.pageAge ? ` (${source.pageAge})` : ""}\n   ${source.url}`);
  const header = `Web search: ${outcome.queries.join(" | ")} — ${outcome.sources.length} source${outcome.sources.length === 1 ? "" : "s"}${outcome.searched > 1 ? ` from ${outcome.searched} searches` : ""}.`;
  const summary = outcome.answer ? `\n\nProvider summary (its wording, not a source): ${outcome.answer}` : "";
  return `${header}\n\n${lines.join("\n")}${summary}\n\nCite the source you used by its url. Anything here that matters to a plan should be checked against the composition in front of you.`;
}
