// The plan's own shape rules: what a plan envelope, condition and target look like before any operation rule runs.
import type { SnapshotFreshness } from "@extynt/project-graph";
import { decode, type JsonObject, type JsonValue } from "@extynt/decode";
import { planBounds, v2Target, type PlanBounds, type V2TargetReference } from "./plan-decoders.js";
import { isJsonObject } from "./json-shape.js";
import { hasNonEmptyStrings, hasOptionalStrings, hasRequiredStrings, invalid, isBoundedText, rejectUnknown, targetOf, type Refusal } from "./validation-primitives.js";

const CONDITION_FIELDS = ["code", "description", "target"];
const CONDITION_TARGET_FIELDS = ["compositionId", "layerId", "effectPath", "propertyPath"];

type IdentityFields = { readonly snapshotFingerprint?: JsonValue; readonly selectionFingerprint?: JsonValue };

export function isFreshness(value: JsonValue | undefined): value is SnapshotFreshness {
  if (!isJsonObject(value) || !hasRequiredStrings(value, ["revision", "capturedAt"])) return false;
  const receivedAt = value.receivedAt;
  return receivedAt === undefined || receivedAt === null || typeof receivedAt === "string";
}

export function validateCondition(value: JsonValue): Refusal | undefined {
  if (typeof value === "string") return isBoundedText(value, 512) ? undefined : invalid("INVALID_CONDITION", "Plan conditions must be 1–512 characters.");
  if (!isJsonObject(value)) return invalid("INVALID_CONDITION", "Conditions must be strings or bounded assertion objects.");
  const unknown = rejectUnknown(value, CONDITION_FIELDS); if (unknown) return unknown;
  if (!hasNonEmptyStrings(value, ["code", "description"])) return invalid("INVALID_CONDITION", "Assertion conditions require code and description.");
  if (value.target !== undefined && !isConditionTarget(value.target)) return invalid("INVALID_CONDITION", "Condition targets must use exact composition/layer paths.");
  return undefined;
}

function isConditionTarget(value: JsonValue | undefined): boolean {
  if (!isJsonObject(value) || rejectUnknown(value, CONDITION_TARGET_FIELDS)) return false;
  return hasRequiredStrings(value, ["compositionId", "layerId"]) && hasOptionalStrings(value, ["effectPath", "propertyPath"]);
}

/** True when the holder's fingerprints are exactly the plan's. */
export function isCurrentIdentity(holder: IdentityFields, plan: JsonObject): boolean {
  return holder.snapshotFingerprint === plan.snapshotFingerprint && holder.selectionFingerprint === plan.selectionFingerprint;
}

/** The plan's bounds when the value is exactly a bounds object. */
export function readBounds(value: JsonValue | undefined): PlanBounds | undefined {
  const decoded = decode(planBounds, value);
  return decoded.ok ? decoded.value : undefined;
}

function readLayerTarget(value: JsonValue | undefined): V2TargetReference | undefined {
  const decoded = decode(v2Target, value);
  return decoded.ok ? decoded.value : undefined;
}

/** The layer target when the value is exactly one and its fingerprints are the plan's. */
export function exactLayerTarget(value: JsonValue | undefined, plan: JsonObject): V2TargetReference | undefined {
  const target = readLayerTarget(value);
  return target !== undefined && isCurrentIdentity(target, plan) ? target : undefined;
}

/** The project item an operation addresses, once its identity matches the plan's. */
export function currentItemTarget(operation: JsonObject, plan: JsonObject, staleMessage: string): { itemId: string } | Refusal {
  const target = targetOf(operation);
  const itemId = target?.itemId;
  if (!target || typeof itemId !== "string" || !isCurrentIdentity(target, plan)) return invalid("STALE_TARGET", staleMessage);
  return { itemId };
}

/** The composition an operation addresses, once its identity matches the plan's. */
export function compositionTarget(operation: JsonObject, plan: JsonObject): { compositionId: string } | Refusal {
  const target = targetOf(operation);
  const compositionId = target?.compositionId;
  if (!target || typeof compositionId !== "string" || !isCurrentIdentity(target, plan)) return invalid("STALE_TARGET", "Composition settings require an exact composition target.");
  return { compositionId };
}
