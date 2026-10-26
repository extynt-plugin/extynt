// edit_keyframes and read_keyframes: change the keys a property already has without rewriting its values, or read them back.
// edit_keyframes has four actions (delete, move, scale, copy); the property is addressed by its full propertyPath from the layer.
import { isJsonArray, type JsonObject, type JsonValue } from "@extynt/decode";
import { isJsonObject } from "./json-shape.js";
import { hasPlannedComposition, hasPlannedLayer, layerTarget, listedCompositions, listedLayers, type LayerAddress, type OperationContext } from "./layer-targets.js";
import { KEYFRAME_EDIT_ACTIONS, type EditKeyframesOperation, type KeyframeEditAction } from "./layer-edit-decoders.js";
import type { V2TargetReference } from "./plan-types.js";
import { ACCEPTED, invalid, isFiniteInRange, isIntegerInRange, isOneOf, isRefusal, rejectUnknown, type OperationResult, type Refusal } from "./validation-primitives.js";


type KeyframeSourceFields = NonNullable<EditKeyframesOperation["source"]>;
type KeyframeEditFields = { readonly action?: JsonValue | undefined; readonly offset?: JsonValue | undefined; readonly factor?: JsonValue | undefined; readonly about?: JsonValue | undefined; readonly source?: JsonValue | undefined };
type ActionCheck = (context: OperationContext, target: V2TargetReference) => Refusal | undefined;

const MAX_SELECTED = 256, MAX_TIME_SECONDS = 86_400, MAX_INDEX = 4096;
const SHARED_FIELDS = ["type", "target", "action", "times", "indices", "all"];
const ACTION_FIELDS: Readonly<Record<KeyframeEditAction, readonly string[]>> = { delete: [], move: ["offset"], scale: ["about", "factor"], copy: ["source", "timeOffset", "keyframeMode"] };

/** The action an edit_keyframes operation means: the one stated, else inferred from its fields (offset moves, factor or about scales, source copies); delete is never inferred. */
export function keyframeEditAction(operation: KeyframeEditFields): KeyframeEditAction | undefined {
  if (operation.action !== undefined) return isOneOf(operation.action, KEYFRAME_EDIT_ACTIONS) ? operation.action : undefined;
  if (operation.offset !== undefined) return "move";
  if (operation.factor !== undefined || operation.about !== undefined) return "scale";
  return operation.source !== undefined ? "copy" : undefined;
}

function isTimeList(times: JsonValue): boolean { return isJsonArray(times) && times.length >= 1 && times.length <= MAX_SELECTED && times.every((time) => isFiniteInRange(time, 0, MAX_TIME_SECONDS)); }
function isIndexList(indices: JsonValue): boolean { return isJsonArray(indices) && indices.length >= 1 && indices.length <= MAX_SELECTED && indices.every((index) => isIntegerInRange(index, 1, MAX_INDEX)); }

function selectionCountError({ operation }: OperationContext, action: KeyframeEditAction): Refusal | undefined {
  const chosen = [operation.times, operation.indices, operation.all].filter((value) => value !== undefined).length;
  if (chosen > 1) return invalid("INVALID_OPERATION", "edit_keyframes selects keys by times, by indices, or all:true; give one of them.");
  return chosen === 0 && action === "delete" ? invalid("INVALID_OPERATION", "edit_keyframes delete needs times, indices, or all:true so no key is removed by accident.") : undefined;
}

function selectionValueError({ operation }: OperationContext): Refusal | undefined {
  const { times, indices, all } = operation;
  if (all !== undefined && all !== true) return invalid("INVALID_VALUE", "edit_keyframes all must be true.");
  if (times !== undefined && !isTimeList(times)) return invalid("INVALID_VALUE", `edit_keyframes times must be 1-${MAX_SELECTED} composition-time seconds, 0-${MAX_TIME_SECONDS}.`);
  return indices !== undefined && !isIndexList(indices) ? invalid("INVALID_VALUE", `edit_keyframes indices must be 1-${MAX_SELECTED} whole numbers from 1 (the first key) to ${MAX_INDEX}.`) : undefined;
}

function moveError({ operation }: OperationContext): Refusal | undefined {
  const { offset } = operation;
  return !isFiniteInRange(offset, -MAX_TIME_SECONDS, MAX_TIME_SECONDS) || offset === 0 ? invalid("INVALID_VALUE", "edit_keyframes move needs a non-zero offset in seconds (negative moves earlier).") : undefined;
}

function scaleError({ operation }: OperationContext): Refusal | undefined {
  if (!isFiniteInRange(operation.about, 0, MAX_TIME_SECONDS)) return invalid("INVALID_VALUE", "edit_keyframes scale needs about: the composition time in seconds that stays fixed.");
  const { factor } = operation;
  return !isFiniteInRange(factor, 0.001, 1000) || factor === 1 ? invalid("INVALID_VALUE", "edit_keyframes scale needs a factor from 0.001 to 1000 other than 1 (2 doubles the spacing between keys, 0.5 halves it).") : undefined;
}

function keyframeSource(value: JsonValue | undefined): KeyframeSourceFields | undefined {
  if (!isJsonObject(value) || rejectUnknown(value, ["compositionId", "layerId", "propertyPath"])) return undefined;
  const { compositionId, layerId, propertyPath } = value;
  return typeof compositionId === "string" && typeof layerId === "string" && typeof propertyPath === "string" && propertyPath ? { compositionId, layerId, propertyPath } : undefined;
}

function sourceLocationError({ snapshot, earlier }: OperationContext, source: LayerAddress): Refusal | undefined {
  if (!snapshot) return undefined;
  const composition = snapshot.compositions.find((candidate) => candidate.id === source.compositionId);
  if (!composition && !hasPlannedComposition(earlier, source.compositionId)) return invalid("TARGET_NOT_FOUND", `edit_keyframes copy source composition is not present or created earlier in this plan. ${listedCompositions(snapshot, earlier, source.compositionId)}`);
  const known = composition?.layers.some((layer) => layer.id === source.layerId) || hasPlannedLayer(earlier, source) || !composition;
  return known ? undefined : invalid("TARGET_NOT_FOUND", `edit_keyframes copy source layer must exist or be created earlier in this plan. ${listedLayers(snapshot, source, earlier)}`);
}

function copyOptionsError({ operation }: OperationContext): Refusal | undefined {
  if (operation.timeOffset !== undefined && !isFiniteInRange(operation.timeOffset, -MAX_TIME_SECONDS, MAX_TIME_SECONDS)) return invalid("INVALID_VALUE", "edit_keyframes timeOffset is seconds added to every copied key time.");
  return operation.keyframeMode !== undefined && !isOneOf(operation.keyframeMode, ["merge", "replace"]) ? invalid("INVALID_VALUE", "edit_keyframes keyframeMode is merge or replace; replace (the default) clears the target's keys first.") : undefined;
}

const copyError: ActionCheck = (context, target) => {
  const source = keyframeSource(context.operation.source);
  if (!source) return invalid("INVALID_OPERATION", "edit_keyframes copy needs source: { compositionId, layerId, propertyPath } naming the property to copy keys from.");
  const located = sourceLocationError(context, source);
  if (located) return located;
  if (source.compositionId === target.compositionId && source.layerId === target.layerId && source.propertyPath === target.propertyPath) return invalid("INVALID_VALUE", "edit_keyframes copy needs a source property other than the target property.");
  return copyOptionsError(context);
};

const ACTION_CHECKS: Readonly<Record<KeyframeEditAction, ActionCheck>> = { delete: () => undefined, move: moveError, scale: scaleError, copy: copyError };

function propertyTargetError(context: OperationContext, kind: string, description: string): V2TargetReference | Refusal {
  const target = layerTarget(context, true);
  if (isRefusal(target)) return target;
  return typeof target.propertyPath === "string" && target.propertyPath ? target : invalid("INVALID_TARGET", `${kind} requires target.propertyPath: ${description}`);
}

function editActionOrRefusal(operation: JsonObject): KeyframeEditAction | Refusal {
  const kind = keyframeEditAction(operation);
  if (!kind) return invalid("INVALID_OPERATION", `edit_keyframes needs offset (move), factor and about (scale), source (copy), or an explicit action of ${KEYFRAME_EDIT_ACTIONS.join(", ")} (delete is only ever stated).`);
  const unknown = rejectUnknown(operation, [...SHARED_FIELDS, ...ACTION_FIELDS[kind]]);
  if (unknown) return unknown;
  return operation.action !== undefined && operation.action !== kind ? invalid("INVALID_OPERATION", "edit_keyframes action is one of delete, move, scale, copy.") : kind;
}

/** Validates edit_keyframes. Keys are selected by time or by 1-based index; with no selection the move, scale and copy actions take every key. The host resolves the property path live and refuses when it does not exist. */
export function validateEditKeyframes(context: OperationContext): OperationResult {
  const kind = editActionOrRefusal(context.operation);
  if (isRefusal(kind)) return kind;
  const target = propertyTargetError(context, "edit_keyframes", "the full path from the layer to the property whose keys change.");
  if (isRefusal(target)) return target;
  return selectionCountError(context, kind) ?? selectionValueError(context) ?? ACTION_CHECKS[kind](context, target) ?? ACCEPTED;
}

/** Validates read_keyframes, which changes nothing: it reads every key of one property back with its value, interpolation, ease, spatial tangents and flags, which is what an edit_keyframes on existing animation needs to know first. The rows come back in the receipt (readBack.keys). */
export function validateReadKeyframes(context: OperationContext): OperationResult {
  const { operation } = context;
  const unknown = rejectUnknown(operation, ["type", "target", "maxKeys"]);
  if (unknown) return unknown;
  const target = propertyTargetError(context, "read_keyframes", "the full path from the layer to the property.");
  if (isRefusal(target)) return target;
  return operation.maxKeys !== undefined && !isIntegerInRange(operation.maxKeys, 1, 500) ? invalid("INVALID_VALUE", "maxKeys is a whole number from 1 to 500 (default 100).") : ACCEPTED;
}
