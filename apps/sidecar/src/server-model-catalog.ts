// The model list of a provider: which models the slot's service offers, asked with the slot's key or a key typed in the panel and not yet saved.
import { decodeOrThrow, fallback, type Infer, jsonValue, string } from "@extynt/decode";

import { MODEL_SERVICES, type ModelService, type ModelSettingsStore, type ModelSlot, type ResolvedSlot } from "./llm-config.js";
import { failed } from "./server-failed-reply.js";
import { lenientObject } from "./server-mcp-arguments.js";
import { slotNamed, slotWord } from "./server-model-slots.js";
import { ok, refuse, type JsonAnswer, type RefusalAnswer } from "./server-route-table.js";
import type { SidecarState } from "./server-state.js";
import { translatorOf } from "./ui-language.js";
import type { Translate } from "@extynt/ui-text";
import { fetchProviderModels } from "./server-provider-models.js";

const MAX_KEY_CHARS = 512;

/** The body a model-list request may carry: the slot and service to ask about and a key not yet saved. Anything else, or a field of the wrong type, reads as not given. */
export const catalogBody = lenientObject({
  slot: fallback(jsonValue, undefined),
  service: fallback(string(), undefined),
  apiKey: fallback(string({ maxLength: MAX_KEY_CHARS }), undefined),
});

type CatalogBody = Infer<typeof catalogBody>;

/** The request that carries no body of its own: everything comes from the query. */
export const NO_CATALOG_BODY: CatalogBody = decodeOrThrow(catalogBody, {});

type ProviderModels = Extract<Awaited<ReturnType<typeof fetchProviderModels>>, { ok: true }>["models"];

interface ModelCatalog {
  readonly ok: true;
  readonly slot: ModelSlot;
  readonly service: string;
  readonly label: string;
  readonly model: string;
  readonly contextWindow: ResolvedSlot["contextWindow"];
  readonly contextWindowSource: ResolvedSlot["contextWindowSource"];
  readonly models: ProviderModels;
}

type CatalogReply = JsonAnswer<ModelCatalog | ReturnType<typeof failed>["body"]> | RefusalAnswer;

function previewOf(settings: ModelSettingsStore, slot: ModelSlot, service: ModelService | undefined): ResolvedSlot | undefined {
  const configured = settings.resolve(slot);
  return service && service.id !== configured?.service.id ? settings.resolveForService(slot, service.id) : configured;
}

function withSuppliedKey(preview: ResolvedSlot | undefined, apiKey: string | undefined): ResolvedSlot | undefined {
  return preview && apiKey ? { ...preview, apiKey } : preview;
}

function targetOf(settings: ModelSettingsStore, request: { readonly slot: ModelSlot; readonly service: string | null; readonly apiKey: string | undefined }, t: Translate): ResolvedSlot | RefusalAnswer {
  const { slot, service: requestedService, apiKey } = request;
  const service = requestedService ? MODEL_SERVICES.find((entry) => entry.id === requestedService) : undefined;
  if (requestedService && !service) return refuse(422, "UNKNOWN_SERVICE", t("failure.catalog.unknownService"));
  return withSuppliedKey(previewOf(settings, slot, service), apiKey) ?? refuse(422, "NO_PROVIDER", t("failure.catalog.noProvider", { slot: slotWord(t, slot) }));
}

/** Asks the service of the slot for its models. The slot and service come from the body, else from the query; naming a service other than the slot's previews that service in the slot. */
export async function modelCatalogReply(state: Pick<SidecarState, "hostFacts" | "now" | "options">, query: URLSearchParams, body: CatalogBody): Promise<CatalogReply> {
  const settings = state.options.modelSettings;
  const t = translatorOf(state);
  if (!settings) return refuse(404, "SETTINGS_UNAVAILABLE", t("failure.settings.unavailable"));
  const slot = slotNamed(body.slot ?? query.get("slot"));
  const resolved = targetOf(settings, { slot, service: body.service ?? query.get("service"), apiKey: body.apiKey }, t);
  if ("refusal" in resolved) return resolved;
  const catalog = await fetchProviderModels(resolved, state.options.fetch ?? fetch, t);
  if (!catalog.ok) return failed(502, catalog.code, catalog.message);
  return ok({ ok: true, slot, service: resolved.service.id, label: resolved.service.label, model: resolved.model, contextWindow: resolved.contextWindow, contextWindowSource: resolved.contextWindowSource, models: catalog.models });
}
