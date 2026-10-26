/**
 * What the sidecar answers on its model routes (settings, catalog, effort levels, connection test) as decoders. Each one
 * keeps the panel's old tolerance: a field the sidecar leaves out or garbles reads as empty, and a bad list entry is dropped.
 */
import type { Decoder, Infer } from "@extynt/decode";
import type { TrainingPolicy } from "./panel-training-notice.js";
import { fallback, literal, map, number, object, optional, skippingInvalid, string } from "@extynt/decode";

const MENU_CATALOG_LIMIT = 1000;

const trainingPolicyDecoder: Decoder<TrainingPolicy> = map(fallback(string(), ""), (wire) => (wire === "no-training" ? "no-training" : "may-train"));

const slotDecoder = object({
  service: fallback(string(), ""),
  model: fallback(string(), ""),
  displayName: fallback(string(), ""),
  baseUrl: fallback(string(), ""),
  reasoningEffort: fallback(string(), ""),
  effectiveEffort: optional(fallback(string(), null)),
  acceptsImages: fallback(literal(true), false),
  imagesReportedBy: fallback(string(), ""),
  keyConfigured: fallback(literal(true), false),
  keyHint: fallback(string(), ""),
  keySource: fallback(string(), ""),
  overriddenBy: fallback(skippingInvalid(string()), []),
  trainingRiskAcknowledged: fallback(literal(true), false),
});

/** One model the sidecar has set up: which service, which model and what it reports about itself. `effectiveEffort` is absent until the model has said which level a request sends. */
export type ModelSlot = Infer<typeof slotDecoder>;

const slotsDecoder = fallback(object({ primary: fallback(slotDecoder, null), fallback: fallback(slotDecoder, null) }), { primary: null, fallback: null });

const serviceDecoder = map(
  object({
    id: string(),
    label: fallback(string(), ""),
    model: fallback(string(), ""),
    baseUrl: fallback(string(), ""),
    format: fallback(string(), ""),
    keyRequired: fallback(literal(true), false),
    addressEditable: fallback(literal(true), false),
    trainingPolicy: trainingPolicyDecoder,
  }),
  (service) => ({
    id: service.id,
    label: service.label || service.id,
    model: service.model,
    baseUrl: service.baseUrl,
    keyRequired: service.keyRequired,
    addressEditable: service.addressEditable,
    trainingPolicy: service.trainingPolicy,
    mock: service.format === "mock",
  }),
);

/** A provider the user can pick; `mock` marks the built-in test service, which needs no address, key or notice. */
export type ModelService = Infer<typeof serviceDecoder>;

const settingsFields = {
  ok: fallback(literal(true), false),
  slots: slotsDecoder,
  active: slotsDecoder,
  services: fallback(skippingInvalid(serviceDecoder), []),
  errors: fallback(skippingInvalid(string()), []),
};

/** The answer to reading the model settings: `ok` says whether the sidecar had them. */
export const modelSettingsDecoder = object(settingsFields);

/** The answer to changing the model settings: the settings now held, and the sidecar's reason when `ok` is false. */
export const modelChangeDecoder = object({ ...settingsFields, error: fallback(object({ message: fallback(string(), "") }), null) });

/** The model settings: what the user chose (`slots`), what is running (`active`), the services on offer and any startup errors. */
export type ModelSettings = Infer<typeof modelSettingsDecoder>;

const catalogModelDecoder = object({ id: string(), name: fallback(string(), ""), contextWindow: fallback(number(), 0) });

/** One model a provider lists; `name` is empty when the provider gives only an id. */
export type CatalogModel = Infer<typeof catalogModelDecoder>;

/** The provider's model list for the picker menu; a missing list reads as empty and at most 1000 models are kept. */
export const menuCatalogDecoder: Decoder<ReadonlyArray<CatalogModel>> = map(
  object({ ok: literal(true), models: fallback(map(skippingInvalid(catalogModelDecoder), (kept) => kept.slice(0, MENU_CATALOG_LIMIT)), []) }),
  (reply) => reply.models,
);

/** The provider's model list for the settings form; the answer must carry a list. */
export const formCatalogDecoder: Decoder<ReadonlyArray<CatalogModel>> = map(
  object({ ok: literal(true), models: skippingInvalid(catalogModelDecoder) }),
  (reply) => reply.models,
);

/** The effort levels a model offers, weakest first, and the level a request sends for the stored choice. */
export const effortReportDecoder = object({ ok: literal(true), efforts: skippingInvalid(string()), effectiveEffort: fallback(string(), null) });

/** What the sidecar reported about a model's effort levels. */
export type EffortReport = Infer<typeof effortReportDecoder>;

/** The answer to one connection test. */
export const modelTestDecoder = object({
  ok: fallback(literal(true), false),
  provider: fallback(string(), ""),
  model: fallback(string(), ""),
  ms: fallback(number(), 0),
  error: fallback(object({ message: fallback(string(), "") }), null),
});

/** What one connection test reported. */
export type ModelTest = Infer<typeof modelTestDecoder>;
