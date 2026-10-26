// Asking a model service which models it offers, and reading its answer into a bounded, sorted list.
import { array, decodeOrThrow, fallback, type Infer, number, object, string } from "@extynt/decode";

import type { Translate } from "@extynt/ui-text";
import { ENGLISH_FAILURE_TEXT } from "./failure-english.js";
import type { ResolvedSlot } from "./llm-config.js";
import { lenientObject } from "./server-mcp-arguments.js";

type ProviderModel = { id: string; name?: string; contextWindow?: number };
type ModelList = { ok: true; models: ProviderModel[] } | { ok: false; code: string; message: string };

const MAX_MODELS = 1000;

const modelEntry = object({
  id: fallback(string(), undefined),
  display_name: fallback(string(), undefined),
  name: fallback(string(), undefined),
  context_length: fallback(number(), undefined),
  context_window: fallback(number(), undefined),
  top_provider: fallback(object({ context_length: fallback(number(), undefined) }), undefined),
});

const modelsBody = lenientObject({ data: fallback(array(fallback(modelEntry, undefined)), undefined) });

/** The environment variable each provider's key is read from when the slot names none. */
export const PROVIDER_KEY_VARIABLES: Record<string, string> = { "deepseek-flash": "DEEPSEEK_API_KEY", "anthropic-messages": "ANTHROPIC_API_KEY", "openai-responses": "OPENAI_API_KEY" };

function catalogHeaders(resolved: ResolvedSlot): Record<string, string> {
  const key = resolved.apiKey;
  return resolved.format === "anthropic" ? { "anthropic-version": "2023-06-01", ...(key ? { "x-api-key": key } : {}) } : { accept: "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) };
}

const compareText = (a: string, b: string): number => (a === b ? 0 : a < b ? -1 : 1);

function windowOf(entry: Infer<typeof modelEntry>): number | undefined {
  return [entry.context_length, entry.context_window, entry.top_provider?.context_length].find((value): value is number => value !== undefined && value > 0);
}

function modelOf(entry: Infer<typeof modelEntry>, id: string): ProviderModel {
  const label = (entry.display_name ?? entry.name ?? "").trim();
  const window = windowOf(entry);
  return { id, ...(label && label !== id ? { name: label.slice(0, 160) } : {}), ...(window ? { contextWindow: Math.floor(window) } : {}) };
}

function modelFrom(entry: Infer<typeof modelEntry> | undefined): ProviderModel | undefined {
  const id = entry?.id?.trim().slice(0, 160) ?? "";
  return entry && id ? modelOf(entry, id) : undefined;
}

function modelsIn(body: Infer<typeof modelsBody>): ProviderModel[] {
  const models: ProviderModel[] = [];
  for (const entry of body.data ?? []) {
    const model = modelFrom(entry);
    if (model) models.push(model);
    if (models.length >= MAX_MODELS) break;
  }
  return models;
}

function catalogResponse(resolved: ResolvedSlot, body: Infer<typeof modelsBody>, t: Translate): ModelList {
  const models = modelsIn(body);
  if (!models.length) return { ok: false, code: "CATALOG_EMPTY", message: t("failure.catalog.empty", { service: resolved.service.label }) };
  models.sort((left, right) => compareText(left.id, right.id));
  return { ok: true, models };
}

function catalogHttpFailure(resolved: ResolvedSlot, status: number, t: Translate): ModelList {
  const service = resolved.service.label;
  return status === 401 || status === 403 ? { ok: false, code: "CATALOG_KEY_REJECTED", message: t("failure.catalog.keyRejected", { service }) } : { ok: false, code: `CATALOG_HTTP_${status}`, message: t("failure.catalog.httpStatus", { service, status }) };
}

/** Asks the service of the slot for its models; the key is sent when there is one, and its absence is not refused because some gateways need none. */
export async function fetchProviderModels(resolved: ResolvedSlot, request: typeof globalThis.fetch, t: Translate = ENGLISH_FAILURE_TEXT): Promise<ModelList> {
  if (resolved.format === "mock") return { ok: true, models: [{ id: resolved.model || "mock-v1" }] };
  if (!resolved.baseUrl) return { ok: false, code: "NO_ENDPOINT", message: t("failure.catalog.noEndpoint", { service: resolved.service.label }) };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const answer = await request(`${resolved.baseUrl.replace(/\/+$/, "")}/models`, { headers: catalogHeaders(resolved), signal: controller.signal });
    return answer.ok ? catalogResponse(resolved, decodeOrThrow(modelsBody, await answer.json()), t) : catalogHttpFailure(resolved, answer.status, t);
  } catch (error) {
    return { ok: false, code: "CATALOG_UNREACHABLE", message: t("failure.catalog.unreachable", { service: resolved.service.label, reason: error instanceof Error ? error.message : t("failure.catalog.requestFailed") }) };
  } finally { clearTimeout(timer); }
}
