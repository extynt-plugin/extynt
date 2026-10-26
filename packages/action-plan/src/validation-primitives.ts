// Shared field predicates for the plan validators: bounded text, finite numbers, enum membership and key allowlists over JSON
// objects, plus the refusal they return. Each validator composes these against its own operation kind; no plan schema lives here.
import type { JsonObject, JsonValue } from "@extynt/decode";
import { isJsonObject } from "./json-shape.js";

/** A plan, operation or field the validators turned away, with the code and message the caller shows. */
export type Refusal = { readonly ok: false; readonly code: string; readonly message: string };

/** What one operation rule answers: accepted with the number of keyframes it writes, or refused. */
export type OperationResult = { readonly ok: true; readonly keyframes: number } | Refusal;

/** The answer for an operation that writes no keyframes. */
export const ACCEPTED: OperationResult = { ok: true, keyframes: 0 };

/** Builds a refusal. */
export function invalid(code: string, message: string): Refusal { return { ok: false, code, message }; }

/** Narrows a rule's answer or grounded target to the refusal case. */
export function isRefusal<Other>(value: Other | Refusal): value is Refusal {
  return typeof value === "object" && value !== null && "ok" in value && value.ok === false;
}

/** The object stored under `key`, if that member is an object. */
export function objectAt(record: JsonObject | undefined, key: string): JsonObject | undefined {
  const member = record?.[key];
  return isJsonObject(member) ? member : undefined;
}

/** The string stored under `key`, if that member is a string. */
export function stringAt(record: JsonObject | undefined, key: string): string | undefined {
  const member = record?.[key];
  return typeof member === "string" ? member : undefined;
}

/** The array stored under `key`, if that member is an array. */
export function arrayAt(record: JsonObject | undefined, key: string): readonly JsonValue[] | undefined {
  const member = record?.[key];
  return Array.isArray(member) ? member : undefined;
}

/** The `target` object of an operation, if it has one. */
export function targetOf(operation: JsonObject): JsonObject | undefined { return objectAt(operation, "target"); }

/** The members of a list that are objects, in order. */
export function objectsIn(values: readonly JsonValue[]): JsonObject[] { return values.filter(isJsonObject); }

export function isNonEmptyString(value: JsonValue | undefined): value is string { return typeof value === "string" && value.length > 0; }
export function isBoundedString(value: JsonValue | undefined, max: number): value is string { return typeof value === "string" && value.length <= max; }
export function isBoundedText(value: JsonValue | undefined, max: number): value is string { return typeof value === "string" && value.length > 0 && value.length <= max; }
export function isBoundedName(value: JsonValue | undefined, max: number): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= max; }
export function isOptionalBoundedName(value: JsonValue | undefined, max: number): value is string | undefined { return value === undefined || isBoundedName(value, max); }
export function isOptionalBoolean(value: JsonValue | undefined): value is boolean | undefined { return value === undefined || typeof value === "boolean"; }
export function isFiniteInRange(value: JsonValue | undefined, min: number, max: number): value is number { return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max; }
export function isOptionalFiniteInRange(value: JsonValue | undefined, min: number, max: number): value is number | undefined { return value === undefined || isFiniteInRange(value, min, max); }
export function isNonNegativeFinite(value: JsonValue | undefined): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
export function isIntegerInRange(value: JsonValue | undefined, min: number, max: number): value is number { return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max; }
export function isOptionalIntegerInRange(value: JsonValue | undefined, min: number, max: number): value is number | undefined { return value === undefined || isIntegerInRange(value, min, max); }
export function isPositiveFiniteUpTo(value: JsonValue | undefined, max: number): value is number { return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= max; }
export function isPositiveInteger(value: JsonValue | undefined): value is number { return typeof value === "number" && Number.isInteger(value) && value > 0; }
export function isOneOf<Member extends string>(value: JsonValue | undefined, allowed: readonly Member[]): value is Member { return allowed.some((member) => member === value); }
export function isOptionalLayerId(value: JsonValue | undefined): value is string | null | undefined { return value === undefined || value === null || typeof value === "string"; }
export function isPrefixedPath(value: JsonValue | undefined, prefix: string): value is string { return typeof value === "string" && value.startsWith(prefix) && value.length > prefix.length; }

/** A POSIX absolute path or a Windows drive path (C:\\ or C:/), the two forms the host's aeApplyIsAbsolutePath accepts. */
export function isAbsoluteBoundedPath(value: JsonValue | undefined, max: number): value is string { return typeof value === "string" && value.length <= max && (value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value)); }

/** True for the `__new__:` placeholder spelling a plan uses to name something it creates. */
export function isNewPlaceholderId(value: string): boolean { return /^__new__:[A-Za-z0-9._-]{1,128}$/.test(value); }
export function isPlaceholderField(value: JsonValue | undefined): value is string { return typeof value === "string" && isNewPlaceholderId(value); }

/** True for a finite number, a boolean, or two to four finite numbers: the values a static effect control takes. */
export function isStaticControlValue(value: JsonValue | undefined): value is boolean | number | number[] {
  if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return true;
  return Array.isArray(value) && value.length >= 2 && value.length <= 4 && value.every((item) => typeof item === "number" && Number.isFinite(item));
}

/** True when every number inside the value is finite and the value is present. */
export function isFiniteJson(value: JsonValue | undefined): value is JsonValue {
  if (value === undefined) return false;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isFiniteJson);
  if (isJsonObject(value)) return Object.values(value).every(isFiniteJson);
  return true;
}

export function hasOnlyKeys(record: JsonObject, allowed: readonly string[]): boolean { return Object.keys(record).every((key) => allowed.includes(key)); }
export function hasRequiredStrings(record: JsonObject, keys: readonly string[]): boolean { return keys.every((key) => typeof record[key] === "string"); }
export function hasNonEmptyStrings(record: JsonObject, keys: readonly string[]): boolean { return keys.every((key) => isNonEmptyString(record[key])); }
export function hasOptionalStrings(record: JsonObject, keys: readonly string[]): boolean { return keys.every((key) => record[key] === undefined || typeof record[key] === "string"); }

/** The number of keyframes a list holds; anything that is not a list holds none. */
export function countKeyframes(value: JsonValue | undefined): number { return Array.isArray(value) ? value.length : 0; }

/** The keys a layer target may carry; any other key in `target` belongs at the top level of the operation. */
export const LAYER_TARGET_FIELDS: readonly string[] = ["compositionId", "layerId", "snapshotFingerprint", "selectionFingerprint", "effectPath", "propertyPath"];

/** A layer target carrying an operation field ("groupId" inside target): the refusal names the move instead of calling the target inexact. */
export function strayLayerTargetField(operation: JsonObject): Refusal | undefined {
  const target = targetOf(operation);
  if (!target || typeof target.layerId !== "string") return undefined;
  const stray = Object.keys(target).find((key) => !LAYER_TARGET_FIELDS.includes(key));
  if (!stray) return undefined;
  return invalid("INVALID_OPERATION", `target takes only ${LAYER_TARGET_FIELDS.join(", ")}; ${stray} is not a target field. If ${String(operation.type)} takes ${stray}, send it at the top level beside target (${stray}: ${JSON.stringify(target[stray])}); otherwise drop it.`);
}

type FieldObserver = (value: JsonObject, allowed: readonly string[]) => void;
let fieldObserver: FieldObserver | undefined;

/** Runs `run` while every rejectUnknown call also reports the object it checked and the fields that object accepts. */
export function observeAcceptedFields<Outcome>(observer: FieldObserver, run: () => Outcome): Outcome {
  const prior = fieldObserver;
  fieldObserver = observer;
  try { return run(); } finally { fieldObserver = prior; }
}

/**
 * The first field the value does not accept, named along with where it went wrong. A v0.2 operation keeps its own fields at the
 * top level and its ids and paths under `target`, so a refused top-level field that also exists under `target` says which copy to
 * keep. The refusal also names the fields this object does accept, from the same allowlist it just enforced, so the correction is
 * in the message. A target or keyframe object has no top level to contrast with `target`, so it keeps the plain wording.
 */
export function rejectUnknown(value: JsonObject, allowed: readonly string[]): Refusal | undefined {
  fieldObserver?.(value, allowed);
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (!unknown) return undefined;
  const type = value.type;
  if (typeof type !== "string") return invalid("UNKNOWN_FIELD", `Unknown field: ${unknown}`);
  const legal = ` Fields it accepts at the top level: ${allowed.join(", ")}.`;
  const target = value.target;
  if (isJsonObject(target) && unknown in target) return invalid("UNKNOWN_FIELD", `Unknown field: ${unknown} at the top level of ${type}; this object takes it inside target, where it already is. Remove the top-level copy.${legal}`);
  return invalid("UNKNOWN_FIELD", `Unknown field: ${unknown} at the top level of ${type}. This object takes only its own fields here, with ids and paths inside target, and no field in both places.${legal}`);
}
