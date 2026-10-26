// The ids After Effects gave to objects a plan created, read back from its verified receipt and bound to the placeholders the plan used for them.
import { decodeOrThrow, fallback, isJsonArray, isJsonObject, jsonObject, type JsonObject, jsonValue, type JsonValue, object, optional, wireJson } from "@extynt/decode";
import { declaredNames, type StoredPlan } from "@extynt/mcp-server";

const MAX_BINDINGS = 64;
const SECRET_SHAPE = /\b(?:sk|rk|xoxb|ghp|github_pat)[_-][A-Za-z0-9_-]{4,}\b/i;

const READBACK_FIELDS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  create_layer: { "target.layerId": "layerId" },
  duplicate_layer: { newLayerId: "layerId" },
  derive_layer: { newLayerId: "layerId" },
  create_composition: { newCompositionId: "compositionId" },
  duplicate_composition: { newCompositionId: "compositionId" },
  precompose_layers: { newCompositionId: "newCompositionId", newLayerId: "layerId" },
  create_folder: { newFolderId: "itemId" },
  import_file: { newItemId: "itemId" },
  create_vector_artwork: { newItemId: "itemId" },
};

const receiptParts = object({ created: optional(fallback(jsonValue, undefined)), verification: optional(fallback(jsonValue, undefined)) });

interface BindingState {
  readonly bindings: Map<string, string>;
  readonly owners: Map<string, string>;
  readonly poisoned: Set<string>;
}

interface Readback {
  readonly placeholder: string;
  readonly actual: JsonValue | undefined;
  readonly claimed: JsonValue | undefined;
}

function objectOf(value: JsonValue | undefined): JsonObject | undefined {
  return value !== undefined && isJsonObject(value) ? value : undefined;
}

function verifiedStep(step: JsonValue | undefined, operation: string): JsonObject | undefined {
  const row = objectOf(step);
  return row?.operation === operation && row.verificationState === "exact" && row.observed === true ? row : undefined;
}

function declaredReadbackKeys(operation: JsonObject, fields: Readonly<Record<string, string>>, placeholder: string): string[] {
  return Object.entries(fields).filter(([field]) => {
    const [head = "", tail] = field.split(".");
    const headValue = operation[head];
    return (tail ? objectOf(headValue)?.[tail] : headValue) === placeholder;
  }).map(([, key]) => key);
}

interface Clash {
  readonly placeholder: string;
  readonly actual: string;
  readonly priorId: string | undefined;
  readonly priorPlaceholder: string | undefined;
}

function poison(state: BindingState, clash: Clash): void {
  const { placeholder, actual, priorId, priorPlaceholder } = clash;
  state.poisoned.add(placeholder);
  state.poisoned.add(actual);
  if (priorId) {
    state.poisoned.add(priorId);
    state.bindings.delete(placeholder);
  }
  if (priorPlaceholder) {
    state.poisoned.add(priorPlaceholder);
    state.bindings.delete(priorPlaceholder);
  }
}

function usable(actual: JsonValue | undefined, claimed: JsonValue | undefined): actual is string {
  return typeof actual === "string" && !!actual && !actual.startsWith("__new__:") && typeof claimed === "string" && claimed === actual && !SECRET_SHAPE.test(actual);
}

function addBinding(state: BindingState, readback: Readback): void {
  const { placeholder, actual, claimed } = readback;
  if (!usable(actual, claimed)) return;
  const priorId = state.bindings.get(placeholder), priorPlaceholder = state.owners.get(actual);
  const clashing = state.poisoned.has(placeholder) || state.poisoned.has(actual) || priorId !== undefined || (priorPlaceholder !== undefined && priorPlaceholder !== placeholder);
  if (clashing) poison(state, { placeholder, actual, priorId, priorPlaceholder });
  else {
    state.bindings.set(placeholder, actual);
    state.owners.set(actual, placeholder);
  }
}

function collect(record: StoredPlan, created: JsonObject, steps: readonly JsonValue[], state: BindingState): void {
  for (const [ordinal, planned] of record.plan.operations.entries()) {
    const fields = READBACK_FIELDS[String(planned.type)];
    const step = verifiedStep(steps[ordinal], String(planned.type));
    if (!fields || !step) continue;
    const operation = decodeOrThrow(jsonObject, decodeOrThrow(wireJson, planned));
    for (const placeholder of declaredNames(operation)) {
      const keys = declaredReadbackKeys(operation, fields, placeholder);
      const [key] = keys;
      if (keys.length === 1 && key !== undefined) addBinding(state, { placeholder, actual: step[key], claimed: created[placeholder] });
    }
  }
}

function verifiedSteps(verification: JsonValue | undefined): readonly JsonValue[] {
  const steps = objectOf(verification)?.steps;
  return steps !== undefined && isJsonArray(steps) ? steps : [];
}

function bindingsOf(record: StoredPlan): Record<string, string> {
  if (!record.receipt) return {};
  const parts = decodeOrThrow(receiptParts, record.receipt);
  const created = objectOf(parts.created), steps = verifiedSteps(parts.verification);
  if (!created || !steps.length) return {};
  const state: BindingState = { bindings: new Map(), owners: new Map(), poisoned: new Set() };
  collect(record, created, steps, state);
  for (const key of state.poisoned) state.bindings.delete(key);
  return Object.fromEntries([...state.bindings].slice(0, MAX_BINDINGS));
}

/** The ids a verified plan's creating steps were read back with, by placeholder. */
export function verifiedCreatedBindings(record: StoredPlan): Record<string, string> {
  const receipt = record.receipt;
  return record.status === "verified" && receipt?.status === "executed" && typeof receipt.afterFingerprint === "string" ? bindingsOf(record) : {};
}

/**
 * The ids a plan's creating steps were read back with, whether or not the rest of its batch could be proved: a step that is exact
 * on its own binds its placeholder even when an unrelated step (a composition marker row) left the batch applied_unverified.
 */
export function appliedCreatedBindings(record: StoredPlan): Record<string, string> {
  const receipt = record.receipt;
  return receipt?.status === "executed" && typeof receipt.afterFingerprint === "string" ? bindingsOf(record) : {};
}
