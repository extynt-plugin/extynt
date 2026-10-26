// Decodes the panel's model-settings body and applies it to the variables stored in llm.env: a change to the slot's own service touches only the fields it names, naming another service starts the slot over, and switching services clears the acceptance given for the old one and moves the slot's key to the old service's own variable, replacing an older key there.
import { boolean, nullable, number, object, optional, string, type Decoder, type Infer } from "@extynt/decode";
import { REASONING_EFFORTS } from "@extynt/llm";
import type { Translate } from "@extynt/ui-text";
import { ENGLISH_FAILURE_TEXT } from "./failure-english.js";
import type { EnvValues } from "./llm-env-file.js";
import { MODEL_SLOTS, SLOT_FIELDS, SLOT_PREFIX, findModelService, isApiFormat, type ModelService, type ModelSlot } from "./llm-model-services.js";

const slotUpdate = object({
  service: optional(string()),
  format: optional(string()),
  baseUrl: optional(string()),
  model: optional(string()),
  apiKey: optional(string()),
  clearKey: optional(boolean()),
  contextWindow: optional(number()),
  reasoningEffort: optional(string()),
  acceptsImages: optional(nullable(boolean())),
  acknowledgeTrainingRisk: optional(boolean()),
});

type ModelSlotUpdate = Infer<typeof slotUpdate>;

/** The changes to the slots: a slot that is absent stays as it is, `null` clears it. A slot update may leave out `service` to change one field of the slot as it is; `acceptsImages: null` hands the answer back to the model; an empty `reasoningEffort` clears it; ranges and names are checked when the update is applied. */
export type ModelSettingsUpdates = Partial<Record<ModelSlot, ModelSlotUpdate | null>>;

/** Accepts an object with optional `primary` and `fallback` keys, each `null` or a slot update; other keys are dropped. */
export const modelSettingsUpdates: Decoder<ModelSettingsUpdates> = object({
  primary: optional(nullable(slotUpdate)),
  fallback: optional(nullable(slotUpdate)),
});

type SlotUpdateOutcome = { readonly values: EnvValues } | { readonly error: string };

type Assignment = readonly [name: string, text: string | undefined];

const MAX_TEXT_LENGTH = 512;

function isReasoningEffortName(text: string | undefined): boolean {
  return REASONING_EFFORTS.some((level) => level === text);
}

function textFieldError(update: ModelSlotUpdate, t: Translate): string | undefined {
  const fields = [["baseUrl", update.baseUrl], ["model", update.model], ["apiKey", update.apiKey]] as const;
  const bad = fields.find(([, text]) => text !== undefined && (text.length > MAX_TEXT_LENGTH || /[\r\n]/.test(text)));
  return bad ? t("failure.settings.singleLine", { field: bad[0], max: MAX_TEXT_LENGTH }) : undefined;
}

function formatError(update: ModelSlotUpdate, t: Translate): string | undefined {
  return update.format !== undefined && !isApiFormat(update.format) ? t("failure.settings.unknownFormat", { format: update.format }) : undefined;
}

function contextWindowError(update: ModelSlotUpdate, t: Translate): string | undefined {
  const window = update.contextWindow;
  return window !== undefined && (!Number.isInteger(window) || window <= 0) ? t("failure.settings.contextWindow") : undefined;
}

function reasoningEffortError(update: ModelSlotUpdate, t: Translate): string | undefined {
  const effort = update.reasoningEffort;
  return effort !== undefined && effort !== "" && !isReasoningEffortName(effort) ? t("failure.settings.effortLevel", { levels: REASONING_EFFORTS.join(", ") }) : undefined;
}

const UPDATE_CHECKS: ReadonlyArray<(update: ModelSlotUpdate, t: Translate) => string | undefined> = [textFieldError, formatError, contextWindowError, reasoningEffortError];

function checkedService(update: ModelSlotUpdate, t: Translate): ModelService | { error: string } {
  const service = findModelService(update.service);
  if (!service) return { error: t("failure.settings.unknownService", { service: String(update.service) }) };
  for (const check of UPDATE_CHECKS) {
    const error = check(update, t);
    if (error) return { error };
  }
  return service;
}

function storedTexts(values: EnvValues, prefix: string): ModelSlotUpdate {
  const format = values[`${prefix}FORMAT`], baseUrl = values[`${prefix}BASE_URL`], model = values[`${prefix}MODEL`], reasoningEffort = values[`${prefix}REASONING_EFFORT`];
  return {
    ...(format !== undefined ? { format } : {}), ...(baseUrl !== undefined ? { baseUrl } : {}),
    ...(model !== undefined ? { model } : {}), ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
  };
}

function storedLimits(values: EnvValues, prefix: string): ModelSlotUpdate {
  const window = Number(values[`${prefix}CONTEXT_WINDOW`]), images = values[`${prefix}ACCEPTS_IMAGES`];
  return { ...(window > 0 ? { contextWindow: window } : {}), ...(images === "true" || images === "false" ? { acceptsImages: images === "true" } : {}) };
}

function mergedSlotUpdate(values: EnvValues, prefix: string, update: ModelSlotUpdate): ModelSlotUpdate {
  const current = values[`${prefix}PROVIDER`];
  if (!current || (update.service !== undefined && update.service !== current)) return update;
  return { ...storedTexts(values, prefix), ...storedLimits(values, prefix), ...update, service: current };
}

function withAssignments(values: EnvValues, assignments: ReadonlyArray<Assignment>): EnvValues {
  const next = { ...values };
  for (const [name, text] of assignments) {
    if (text?.trim()) next[name] = text.trim();
    else delete next[name];
  }
  return next;
}

function withServiceSwitch(values: EnvValues, prefix: string, next: ModelService): EnvValues {
  const previousId = values[`${prefix}PROVIDER`];
  if (!previousId || previousId === next.id) return values;
  const slotKeyName = `${prefix}API_KEY`;
  const previousKeyName = findModelService(previousId)?.keyVariable;
  const movedKey = previousKeyName && previousKeyName !== slotKeyName ? values[slotKeyName] : undefined;
  const moved: ReadonlyArray<Assignment> = previousKeyName && movedKey ? [[previousKeyName, movedKey]] : [];
  return withAssignments(withAssignments(values, moved), [[`${prefix}ALLOW_TRAINING_RISK`, undefined], [slotKeyName, undefined]]);
}

function differing(text: string | undefined, serviceDefault: string): string | undefined {
  return text && text.trim() !== serviceDefault ? text : undefined;
}

function addressAssignments(prefix: string, update: ModelSlotUpdate, service: ModelService): ReadonlyArray<Assignment> {
  return [
    [`${prefix}FORMAT`, differing(update.format, service.format)],
    [`${prefix}BASE_URL`, service.addressEditable ? differing(update.baseUrl, service.baseUrl) : undefined],
    [`${prefix}MODEL`, differing(update.model, service.model)],
  ];
}

function limitAssignments(prefix: string, update: ModelSlotUpdate, service: ModelService): ReadonlyArray<Assignment> {
  const window = update.contextWindow;
  return [
    [`${prefix}CONTEXT_WINDOW`, window && window !== service.contextWindow ? String(window) : undefined],
    [`${prefix}REASONING_EFFORT`, isReasoningEffortName(update.reasoningEffort) ? update.reasoningEffort : undefined],
    [`${prefix}ACCEPTS_IMAGES`, typeof update.acceptsImages === "boolean" ? String(update.acceptsImages) : undefined],
  ];
}

function trainingAssignments(prefix: string, update: ModelSlotUpdate): ReadonlyArray<Assignment> {
  if (update.acknowledgeTrainingRisk === undefined) return [];
  return [[`${prefix}ALLOW_TRAINING_RISK`, update.acknowledgeTrainingRisk ? "1" : undefined]];
}

function keyAssignments(prefix: string, update: ModelSlotUpdate, service: ModelService): ReadonlyArray<Assignment> {
  if (update.clearKey) return [[`${prefix}API_KEY`, undefined], [service.keyVariable, undefined]];
  return update.apiKey?.trim() ? [[`${prefix}API_KEY`, update.apiKey]] : [];
}

function applySlotUpdate(values: EnvValues, slot: ModelSlot, update: ModelSlotUpdate, service: ModelService): EnvValues {
  const prefix = SLOT_PREFIX[slot];
  return withAssignments(withServiceSwitch(values, prefix, service), [
    [`${prefix}PROVIDER`, service.id],
    ...addressAssignments(prefix, update, service),
    ...limitAssignments(prefix, update, service),
    ...trainingAssignments(prefix, update),
    ...keyAssignments(prefix, update, service),
  ]);
}

function withoutSlot(values: EnvValues, slot: ModelSlot): EnvValues {
  return withAssignments(values, SLOT_FIELDS.map((field): Assignment => [`${SLOT_PREFIX[slot]}${field}`, undefined]));
}

/** The variables after applying the updates, slot by slot in order, stopping at the first update that is invalid; the input is not changed. */
export function applySlotUpdates(file: EnvValues, updates: ModelSettingsUpdates, t: Translate = ENGLISH_FAILURE_TEXT): SlotUpdateOutcome {
  let values = file;
  for (const slot of MODEL_SLOTS) {
    const update = updates[slot];
    if (update === undefined) continue;
    if (update === null) {
      values = withoutSlot(values, slot);
      continue;
    }
    const merged = mergedSlotUpdate(values, SLOT_PREFIX[slot], update);
    const service = checkedService(merged, t);
    if ("error" in service) return service;
    values = applySlotUpdate(values, slot, merged, service);
  }
  return { values };
}
