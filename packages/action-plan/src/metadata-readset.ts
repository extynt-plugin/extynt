// The read sets that let a scoped observation back a plan: exact layer renames, one static Gaussian Blur Blurriness assignment, or
// one Gaussian Blur creation, each proven by the local reads the snapshot carries. Deliberately narrow: no custom conditions, values, dynamic references or new targets.
import { createHash } from "node:crypto";
import { stableStringify, type LocalBlurObservation, type ProjectSnapshot } from "@extynt/project-graph";
import { type JsonObject, type JsonValue } from "@extynt/decode";
import { isJsonObject } from "./json-shape.js";
import { planDigestJson } from "./plan-digest.js";
import type { ActionPlan } from "./plan-types.js";
import { toJsonValue } from "./plain-json.js";
import { arrayAt, hasOnlyKeys, isFiniteInRange, isNonNegativeFinite, objectAt, targetOf } from "./validation-primitives.js";

const GAUSSIAN_MATCH_NAME = "ADBE Gaussian Blur 2";
const GAUSSIAN_EFFECT_PATH = `ADBE Effect Parade/${GAUSSIAN_MATCH_NAME}`;
const GAUSSIAN_BLURRINESS_PATH = `${GAUSSIAN_EFFECT_PATH}/${GAUSSIAN_MATCH_NAME}-0001`;
const MAX_SCOPED_OPERATIONS = 16;

type Coverage = NonNullable<ProjectSnapshot["coverage"]>;
type Creation = NonNullable<Coverage["localCreation"]>;
type Initialization = { blurriness: number; dimensions: 1 | 2 | 3; repeatEdgePixels: boolean };

/** One scoped layer and what the plan will do to it, with the host indices the read set pins. */
export interface MetadataReadSet {
  schemaVersion: "metadata-read-set/1" | "blur-control-read-set/1" | "gaussian-create-read-set/1";
  planId: string;
  planDigest: string;
  snapshotFingerprint: string;
  stamp: { epoch: number; revision: number };
  targets: Array<{ operationIndex: number; compositionId: string; itemIndex: number; layerId: string; layerIndex: number; name: string; desiredName: string; locked: false; localEffect?: LocalBlurObservation; desiredValue?: number; localCreation?: Creation; initialization?: Initialization; enabled?: boolean }>;
  digest: string;
}

type HostStamp = NonNullable<ProjectSnapshot["hostStamp"]>;
type ScopedPlan = { readonly operations: readonly JsonValue[]; readonly planId: string; readonly snapshotFingerprint: string; readonly hostStamp: HostStamp; readonly coverage: Coverage };
type ReadSetTargets = Pick<MetadataReadSet, "schemaVersion" | "targets">;
type ReadSetTarget = MetadataReadSet["targets"][number];
type ScopedLayer = Pick<ReadSetTarget, "compositionId" | "itemIndex" | "layerId" | "layerIndex" | "name">;

/** metadataReadSetJson for a plan in its typed form. */
export function metadataReadSet(plan: ActionPlan, snapshot: ProjectSnapshot): MetadataReadSet | undefined {
  const json = toJsonValue(plan);
  return isJsonObject(json) ? metadataReadSetJson(json, snapshot) : undefined;
}

/** The read set that proves the plan against the scoped snapshot, or undefined when the plan is not one of the narrow shapes a scoped observation can back. */
export function metadataReadSetJson(plan: JsonObject, snapshot: ProjectSnapshot): MetadataReadSet | undefined {
  const scoped = scopedPlan(plan, snapshot);
  const result = scoped && metadataTargets(scoped.operations, snapshot, scoped.coverage);
  if (!scoped || !result) return undefined;
  const body = { schemaVersion: result.schemaVersion, planId: scoped.planId, planDigest: planDigestJson(plan), snapshotFingerprint: scoped.snapshotFingerprint, stamp: scoped.hostStamp, targets: result.targets };
  return { ...body, digest: createHash("sha256").update(stableStringify(body)).digest("hex") };
}

function scopedPlan(plan: JsonObject, snapshot: ProjectSnapshot): ScopedPlan | undefined {
  const { hostStamp, coverage } = snapshot;
  const operations = arrayAt(plan, "operations");
  const identity = planIdentity(plan);
  if (!hostStamp || !operations || !identity || coverage?.kind !== "composition-metadata") return undefined;
  return soundScopedPlan(plan, operations, hostStamp) ? { operations, ...identity, hostStamp, coverage } : undefined;
}

function planIdentity(plan: JsonObject): { planId: string; snapshotFingerprint: string } | undefined {
  const planId = plan.planId, snapshotFingerprint = plan.snapshotFingerprint;
  return typeof planId === "string" && typeof snapshotFingerprint === "string" ? { planId, snapshotFingerprint } : undefined;
}

function soundScopedPlan(plan: JsonObject, operations: readonly JsonValue[], hostStamp: HostStamp): boolean {
  return validHostStamp(hostStamp) && validConditionArrays(plan) && validScopedPlanEnvelope(plan, operations);
}

function validHostStamp(stamp: HostStamp): boolean {
  return Number.isSafeInteger(stamp.epoch) && stamp.epoch >= 1 && Number.isSafeInteger(stamp.revision) && stamp.revision >= 1;
}

function validConditionArrays(plan: JsonObject): boolean {
  return ["preconditions", "postconditions", "conflicts"].every((key) => plan[key] === undefined || Array.isArray(plan[key]));
}

function validScopedPlanEnvelope(plan: JsonObject, operations: readonly JsonValue[]): boolean {
  return plan.schemaVersion === "0.2" && operations.length >= 1 && operations.length <= MAX_SCOPED_OPERATIONS && !hasUnsupportedConditions(plan);
}

function hasUnsupportedConditions(plan: JsonObject): boolean {
  const unsupportedPostcondition = (condition: JsonValue): boolean => !isJsonObject(condition) || condition.code !== "OPERATIONS_OBSERVED" || !hasOnlyKeys(condition, ["code", "description"]);
  return !!arrayAt(plan, "preconditions")?.length || !!arrayAt(plan, "conflicts")?.length || !!arrayAt(plan, "postconditions")?.some(unsupportedPostcondition);
}

function soleOperation(operations: readonly JsonValue[]): JsonObject | undefined {
  const [first] = operations;
  return operations.length === 1 && isJsonObject(first) ? first : undefined;
}

function metadataTargets(operations: readonly JsonValue[], snapshot: ProjectSnapshot, coverage: Coverage): ReadSetTargets | undefined {
  const only = soleOperation(operations);
  if (only?.type === "ensure_effect" && coverage.localCreation) return creationTargets(only, snapshot, coverage.localCreation);
  if (only?.type === "set_effect_control" && coverage.localEffect) return blurTargets(only, snapshot, coverage.localEffect);
  return renameTargets(operations, snapshot);
}

function isIndex(value: number | undefined): value is number { return typeof value === "number" && Number.isSafeInteger(value); }

function observedLayerOf(snapshot: ProjectSnapshot, compositionId: JsonValue | undefined, layerId: JsonValue | undefined): { composition: ProjectSnapshot["compositions"][number]; layer: ProjectSnapshot["compositions"][number]["layers"][number] } | undefined {
  const composition = snapshot.compositions.find((candidate) => candidate.id === compositionId);
  const layer = composition?.layers.find((candidate) => candidate.id === layerId);
  return composition && layer ? { composition, layer } : undefined;
}

function unlockedLayer(snapshot: ProjectSnapshot, compositionId: JsonValue | undefined, layerId: JsonValue | undefined): ScopedLayer | undefined {
  const found = observedLayerOf(snapshot, compositionId, layerId);
  if (!found || found.layer.locked) return undefined;
  const { composition, layer } = found;
  const itemIndex = composition.itemIndex;
  if (!isIndex(itemIndex) || !isIndex(layer.index)) return undefined;
  return { compositionId: composition.id, itemIndex, layerId: layer.id, layerIndex: layer.index, name: layer.name };
}

function creationTargets(operation: JsonObject, snapshot: ProjectSnapshot, creation: Creation): ReadSetTargets | undefined {
  const target = targetOf(operation), init = objectAt(operation, "initialization"), enabled = operation.enabled;
  if (!target || !init || typeof enabled !== "boolean" || !isGaussianCreation(operation, target) || !validCreationObservation(creation)) return undefined;
  const initialization = creationInitialization(init);
  const layer = unlockedLayer(snapshot, target.compositionId, target.layerId);
  if (!initialization || !layer) return undefined;
  return { schemaVersion: "gaussian-create-read-set/1", targets: [{ operationIndex: 0, ...layer, desiredName: layer.name, locked: false, localCreation: creation, initialization, enabled }] };
}

function isGaussianCreation(operation: JsonObject, target: JsonObject): boolean {
  return operation.effectMatchName === GAUSSIAN_MATCH_NAME && operation.effectPath === GAUSSIAN_EFFECT_PATH && target.effectPath === GAUSSIAN_EFFECT_PATH && target.propertyPath === undefined;
}

function isDimensionCount(value: JsonValue | undefined): value is 1 | 2 | 3 { return value === 1 || value === 2 || value === 3; }

function creationInitialization(init: JsonObject): Initialization | undefined {
  const { blurriness, dimensions, repeatEdgePixels } = init;
  if (Object.keys(init).length !== 3 || !isNonNegativeFinite(blurriness) || typeof repeatEdgePixels !== "boolean") return undefined;
  return isDimensionCount(dimensions) ? { blurriness, dimensions, repeatEdgePixels } : undefined;
}

function validCreationObservation(creation: Creation): boolean {
  return creation.effectMatchName === GAUSSIAN_MATCH_NAME && creation.absent === true && creation.canAdd === true && creation.dependencyPolicy === "local-effect-creation" && Array.isArray(creation.inventory) && creation.inventory.length <= 15 && creation.inventory.every((entry, index) => !!entry && entry.index === index + 1 && typeof entry.matchName === "string" && entry.matchName !== GAUSSIAN_MATCH_NAME);
}

function blurTargets(operation: JsonObject, snapshot: ProjectSnapshot, local: LocalBlurObservation): ReadSetTargets | undefined {
  const target = targetOf(operation);
  const layer = unlockedLayer(snapshot, target?.compositionId, target?.layerId);
  const desiredValue = target && blurAssignmentValue(operation, local, target);
  if (!layer || desiredValue === undefined) return undefined;
  return { schemaVersion: "blur-control-read-set/1", targets: [{ operationIndex: 0, ...layer, desiredName: layer.name, locked: false, localEffect: local, desiredValue }] };
}

function blurAssignmentValue(operation: JsonObject, local: LocalBlurObservation, target: JsonObject): number | undefined {
  const addressed = operation.effectMatchName === GAUSSIAN_MATCH_NAME && target.effectPath === GAUSSIAN_EFFECT_PATH && target.propertyPath === GAUSSIAN_BLURRINESS_PATH;
  if (!addressed || !validLocalBlur(local)) return undefined;
  const value = operation.value;
  return isFiniteInRange(value, local.minimum, local.maximum) ? value : undefined;
}

function renameTargets(operations: readonly JsonValue[], snapshot: ProjectSnapshot): ReadSetTargets | undefined {
  const seen = new Set<string>();
  const targets: ReadSetTarget[] = [];
  for (const [index, operation] of operations.entries()) {
    const target = renameTarget(operation, index, snapshot);
    if (!target) return undefined;
    const key = JSON.stringify([target.compositionId, target.layerId]);
    if (seen.has(key)) return undefined;
    seen.add(key);
    targets.push(target);
  }
  return { schemaVersion: "metadata-read-set/1", targets };
}

function renameTarget(operation: JsonValue, index: number, snapshot: ProjectSnapshot): ReadSetTarget | undefined {
  if (!isJsonObject(operation) || operation.type !== "set_layer_name") return undefined;
  const target = targetOf(operation), desiredName = operation.name;
  if (!target || typeof desiredName !== "string") return undefined;
  const layer = unlockedLayer(snapshot, target.compositionId, target.layerId);
  return layer && { operationIndex: index, ...layer, desiredName, locked: false };
}

function validLocalBlur(value: LocalBlurObservation): boolean {
  return validBlurInventory(value) && validBlurStaticControl(value) && [value.value, value.minimum, value.maximum].every((number) => typeof number === "number" && Number.isFinite(number)) && value.minimum <= value.maximum && value.dependencyPolicy === "local-literal-assignment";
}

function validBlurInventory(value: LocalBlurObservation): boolean {
  const { inventory, effectIndex } = value;
  if (value.effectMatchName !== GAUSSIAN_MATCH_NAME || !Number.isSafeInteger(effectIndex) || effectIndex < 1 || !Array.isArray(inventory)) return false;
  return inventory.length >= 1 && inventory.length <= 16 && inventoryWellFormed(inventory) && inventoryNamesGaussianOnceAt(inventory, effectIndex);
}

function inventoryNamesGaussianOnceAt(inventory: LocalBlurObservation["inventory"], effectIndex: number): boolean {
  return inventory.filter((entry) => entry.matchName === GAUSSIAN_MATCH_NAME).length === 1 && inventory[effectIndex - 1]?.matchName === GAUSSIAN_MATCH_NAME;
}

function inventoryWellFormed(inventory: LocalBlurObservation["inventory"]): boolean {
  return inventory.every((entry, index) => !!entry && typeof entry === "object" && entry.index === index + 1 && typeof entry.matchName === "string");
}

function validBlurStaticControl(value: LocalBlurObservation): boolean {
  return typeof value.effectEnabled === "boolean" && JSON.stringify(value.matchNames) === JSON.stringify(["ADBE Effect Parade", GAUSSIAN_MATCH_NAME, `${GAUSSIAN_MATCH_NAME}-0001`]) && value.valueType === "number" && value.canSetValue === true && value.keyframeCount === 0 && value.expressionEnabled === false && value.expression === "";
}
