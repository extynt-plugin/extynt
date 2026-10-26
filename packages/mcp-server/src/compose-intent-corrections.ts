// Corrections for a refusal whose one right answer the sidecar already holds: a role beside a set_expression path,
// a key write whose existing keys all sit at the new key times, a remove_layer of a layer this same work created.
import { NATIVE_PROPERTY_PATHS } from "@extynt/action-plan";
import type { ProjectSnapshot, PropertySnapshot } from "@extynt/project-graph";
import { ANIMATING_TYPES, ownTarget, recordChange, targetLayer } from "./compose-correction-core.js";
import type { CorrectionContext, CorrectionStep } from "./compose-correction-core.js";
import { asObject, numberAt, objectAt, stringAt } from "./json.js";
import { isJsonArray } from "@extynt/decode";
import type { JsonObject, JsonValue } from "@extynt/decode";
import type { OperationFields } from "./operation-fields.js";
import { ownedRemovalIndexes } from "./own-work.js";

const TIME_EPSILON = 1e-6;

/** set_expression takes its exact property path in target and has no role: a role beside a path is dropped, and a role alone fills the path when it names exactly one native property. */
export const dropExpressionRole: CorrectionStep = (operation, context) => {
  const role = operation.role;
  const target = context.type === "set_expression" && role !== undefined ? ownTarget(operation) : undefined;
  if (!target) return undefined;
  if (stringAt(target, "propertyPath") !== undefined) {
    delete operation.role;
    recordChange(context, { field: "role", from: role, to: undefined, why: "set_expression is addressed by target.propertyPath alone; the role adds nothing" });
    return undefined;
  }
  const path = typeof role === "string" ? NATIVE_PROPERTY_PATHS[role] : undefined;
  if (path === undefined) return undefined;
  target.propertyPath = path;
  delete operation.role;
  recordChange(context, { field: "target.propertyPath", from: undefined, to: path, why: `set_expression is addressed by target.propertyPath; role ${String(role)} names exactly that property` });
  return undefined;
};

function propertyAt(properties: readonly PropertySnapshot[], path: string): PropertySnapshot | undefined {
  for (const property of properties) {
    if (property.path === path) return property;
    const nested = propertyAt(property.children ?? [], path);
    if (nested) return nested;
  }
  return undefined;
}

function keyTimes(keyframes: JsonValue | undefined): number[] | undefined {
  if (!isJsonArray(keyframes)) return undefined;
  const times = keyframes.flatMap((frame) => {
    const time = numberAt(asObject(frame), "time");
    return time !== undefined && Number.isFinite(time) ? [time] : [];
  });
  return times.length === keyframes.length ? times : undefined;
}

function observedProperty(operation: JsonObject, snapshot: ProjectSnapshot): PropertySnapshot | undefined {
  const target = objectAt(operation, "target"), path = stringAt(target, "propertyPath");
  const layer = target ? targetLayer(snapshot, target) : undefined;
  return path && layer ? propertyAt(layer.properties, path) : undefined;
}

function existingKeyTimes(operation: JsonObject, snapshot: ProjectSnapshot): number[] {
  return observedProperty(operation, snapshot)?.keyframes?.map((key) => key.time) ?? [];
}

function hasOwnedKeys(operation: JsonObject, context: CorrectionContext): boolean {
  const layerId = stringAt(objectAt(operation, "target"), "layerId");
  if (!layerId || !context.ownedLayerIds?.has(layerId)) return false;
  const keyframeCount = observedProperty(operation, context.snapshot)?.keyframeCount;
  return typeof keyframeCount === "number" && keyframeCount >= 1;
}

function replaceOwnKeys(operation: OperationFields, context: CorrectionContext): void {
  if (!hasOwnedKeys(operation, context)) return;
  recordChange(context, { field: "keyframeMode", from: operation.keyframeMode, to: "replace", why: "this layer was created by this same work, so its existing keys are the job's own and are rewritten" });
  operation.keyframeMode = "replace";
}

function mergeKeys(operation: OperationFields, context: CorrectionContext): void {
  recordChange(context, { field: "keyframeMode", from: operation.keyframeMode, to: "merge", why: "the property already has keys, all at times these keys rewrite, so merge and replace give the same result" });
  operation.keyframeMode = "merge";
}

function isModeUnset(operation: OperationFields): boolean {
  return operation.keyframeMode === undefined || operation.keyframeMode === "reject";
}

function allCovered(existing: readonly number[], newTimes: readonly number[]): boolean {
  return existing.length > 0 && existing.every((time) => newTimes.some((next) => Math.abs(next - time) <= TIME_EPSILON));
}

/** Writing keys onto a property that already has keys is refused unless keyframeMode says how; when every existing key time is also a new key time,
 *  merge and replace give the identical result, so merge is chosen. */
export const chooseKeyframeMode: CorrectionStep = (operation, context) => {
  if (!ANIMATING_TYPES.has(context.type) || !isModeUnset(operation)) return undefined;
  const newTimes = keyTimes(operation.keyframes);
  if (!newTimes) return undefined;
  if (allCovered(existingKeyTimes(operation, context.snapshot), newTimes)) mergeKeys(operation, context);
  else replaceOwnKeys(operation, context);
  return undefined;
};

/** remove_layer asks for destructive:true; a layer this same job (or a plan this client applied) created is not the user's work, so the confirmation is filled in. */
export const confirmOwnedRemoval: CorrectionStep = (operation, context) => {
  if (context.type !== "remove_layer" || operation.destructive === true) return undefined;
  const call = (context.call ?? [operation]).map((entry) => ({ ...asObject(entry), type: stringAt(asObject(entry), "type") ?? "" }));
  if (!ownedRemovalIndexes(call, context.ownedLayerIds).has(context.index)) return undefined;
  recordChange(context, { field: "destructive", from: operation.destructive, to: true, why: "this layer was created by this same work, so removing it deletes nothing the user had" });
  operation.destructive = true;
  return undefined;
};
