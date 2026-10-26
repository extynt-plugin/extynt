// Layer commands that make a second layer from a first (split, audio to keyframes, shapes from a layer, path nulls) and the
// time-remap retimes (reverse, freeze). The kind tables below are the public contract; the rules validate one operation each.
import { flattenProperties, type ProjectSnapshot } from "@extynt/project-graph";
import { isJsonObject } from "./json-shape.js";
import { layerTarget, observedLayer, type OperationContext } from "./layer-targets.js";
import { earlierWith } from "./operation-checks.js";
import { DERIVE_LAYER_KINDS, PATH_NULL_POINT_KINDS, RETIME_MODES, type DeriveLayerKind } from "./layer-edit-decoders.js";
import type { V2TargetReference } from "./plan-types.js";
import { ACCEPTED, invalid, isFiniteInRange, isIntegerInRange, isNewPlaceholderId, isOneOf, isOptionalBoundedName, isRefusal, rejectUnknown, type OperationResult, type Refusal } from "./validation-primitives.js";

export const PATH_PROPERTY_LEAVES = ["ADBE Mask Shape", "ADBE Vector Shape"] as const;
export const TIME_REMAP_PATH = "ADBE Time Remapping";
const MAX_TIME_SECONDS = 86_400;
const MAX_POINT_INDEX = 9_999;
const MAX_HINTED_PATHS = 10;

type ObservedLayer = ProjectSnapshot["compositions"][number]["layers"][number];

export const LAYER_DERIVE_OPERATION_TYPES = ["derive_layer", "retime_layer"] as const;

const KIND_LAYER_TYPES: Readonly<Record<DeriveLayerKind, readonly string[]>> = {
  split: ["av", "text", "shape", "null", "adjustment"], "audio-keyframes": ["av"], "shapes-from-vector": ["av"], "shapes-from-text": ["text"], "path-null": ["av", "text", "shape", "null", "adjustment"],
};
const KIND_FIELDS: Readonly<Record<DeriveLayerKind, readonly string[]>> = {
  split: ["time"], "audio-keyframes": [], "shapes-from-vector": [], "shapes-from-text": [], "path-null": ["pointIndex", "pointKind", "name"],
};
const ALL_KIND_FIELDS = ["time", "pointIndex", "pointKind", "name"];
const LAYER_PRODUCERS: readonly string[] = ["duplicate_layer", "derive_layer", "precompose_layers"];

function isPathPropertyPath(path: string | undefined): boolean { return isOneOf(path?.split("/").pop(), PATH_PROPERTY_LEAVES); }

function plannedPlaceholderError({ operation, earlier }: OperationContext, name: string): Refusal | undefined {
  const placeholder = operation.newLayerId;
  const clash = earlierWith(earlier, (op) => typeof op.type === "string" && LAYER_PRODUCERS.includes(op.type) && op.newLayerId === placeholder);
  return typeof placeholder !== "string" || !isNewPlaceholderId(placeholder) || clash ? invalid("INVALID_OPERATION", `${name} requires a unique __new__: newLayerId.`) : undefined;
}

function strayFieldError(context: OperationContext, kind: DeriveLayerKind): Refusal | undefined {
  const stray = ALL_KIND_FIELDS.find((field) => context.operation[field] !== undefined && !KIND_FIELDS[kind].includes(field));
  return stray ? invalid("INVALID_VALUE", `${stray} does not apply to derive_layer kind ${kind}.`) : undefined;
}

function splitTimeError(context: OperationContext, target: V2TargetReference): Refusal | undefined {
  const { time } = context.operation;
  if (typeof time !== "number" || !isFiniteInRange(time, 0, MAX_TIME_SECONDS)) return invalid("INVALID_VALUE", "derive_layer split requires time in seconds (composition time, 0-86400).");
  const layer = observedLayer(context.snapshot, target);
  return !layer || (time > layer.inPoint && time < layer.outPoint) ? undefined : invalid("INVALID_VALUE", "derive_layer split time must fall strictly inside the layer's in and out points.");
}

function pointFieldsError({ operation }: OperationContext): Refusal | undefined {
  if (!isIntegerInRange(operation.pointIndex, 0, MAX_POINT_INDEX)) return invalid("INVALID_VALUE", `derive_layer path-null requires an integer pointIndex 0-${MAX_POINT_INDEX} (0-based vertex of the path).`);
  if (operation.pointKind !== undefined && !isOneOf(operation.pointKind, PATH_NULL_POINT_KINDS)) return invalid("INVALID_VALUE", `pointKind must be one of ${PATH_NULL_POINT_KINDS.join(", ")}.`);
  return isOptionalBoundedName(operation.name, 256) ? undefined : invalid("INVALID_VALUE", "The null's name must be 1-256 characters.");
}

function pathVertexCount(layer: ObservedLayer, propertyPath: string): number | undefined {
  const value = flattenProperties(layer.properties).find((property) => property.path === propertyPath)?.value;
  return isJsonObject(value) && Array.isArray(value.vertices) ? value.vertices.length : undefined;
}

/** The mask and shape path properties the snapshot holds on a layer, spelled exactly as a plan must name them (inspect prints the group and the leaf apart; the path is group/leaf, and the second mask is ADBE Mask Atom#2). */
export function pathPropertyHint(layer: ObservedLayer): string {
  const paths = flattenProperties(layer.properties).map((property) => property.path).filter(isPathPropertyPath);
  if (!paths.length) return " This layer has no mask or shape path property in the snapshot; add_mask first, then refresh.";
  return ` Path properties on this layer: ${paths.slice(0, MAX_HINTED_PATHS).map((path) => JSON.stringify(path)).join(", ")}. Write the full path, group and leaf joined by "/" with no brackets (the second mask is ADBE Mask Atom#2).`;
}

function pathTargetError(context: OperationContext, target: V2TargetReference): Refusal | undefined {
  const { propertyPath } = target;
  if (!propertyPath || !isPathPropertyPath(propertyPath)) return invalid("INVALID_TARGET", "derive_layer path-null requires target.propertyPath to be a mask path (…/ADBE Mask Shape) or a shape path (…/ADBE Vector Shape) from ae_inspect_layer.");
  const layer = observedLayer(context.snapshot, target);
  if (!layer) return undefined;
  if (!flattenProperties(layer.properties).some((property) => property.path === propertyPath)) return invalid("TARGET_NOT_FOUND", `The path property is not present in the current snapshot.${pathPropertyHint(layer)}`);
  const count = pathVertexCount(layer, propertyPath);
  const index = context.operation.pointIndex;
  return count !== undefined && typeof index === "number" && index >= count ? invalid("INVALID_VALUE", `pointIndex ${index} is past the path's ${count} vertices.`) : undefined;
}

function kindPayloadError(context: OperationContext, kind: DeriveLayerKind, target: V2TargetReference): Refusal | undefined {
  if (kind === "split") return splitTimeError(context, target);
  return kind === "path-null" ? pointFieldsError(context) ?? pathTargetError(context, target) : undefined;
}

function deriveShapeError(context: OperationContext, kind: DeriveLayerKind, target: V2TargetReference): Refusal | undefined {
  if (kind !== "path-null" && target.propertyPath !== undefined) return invalid("INVALID_TARGET", `derive_layer ${kind} requires an exact layer target without property paths.`);
  const stray = strayFieldError(context, kind);
  if (stray) return stray;
  const layer = observedLayer(context.snapshot, target);
  return layer && !KIND_LAYER_TYPES[kind].includes(layer.type) ? invalid("INVALID_TARGET", `derive_layer ${kind} applies to ${KIND_LAYER_TYPES[kind].join(", ")} layers.`) : undefined;
}

/** Validates derive_layer: a second layer made from the target by split, audio keyframes, shapes from a vector or text layer, or a null on one path point. */
export function validateDeriveLayer(context: OperationContext): OperationResult {
  const { operation } = context;
  const unknown = rejectUnknown(operation, ["type", "target", "kind", "newLayerId", ...ALL_KIND_FIELDS]);
  if (unknown) return unknown;
  const kind = operation.kind;
  if (!isOneOf(kind, DERIVE_LAYER_KINDS)) return invalid("INVALID_VALUE", `kind must be one of ${DERIVE_LAYER_KINDS.join(", ")}.`);
  const target = layerTarget(context, kind === "path-null");
  if (isRefusal(target)) return target;
  return deriveShapeError(context, kind, target) ?? plannedPlaceholderError(context, "derive_layer") ?? kindPayloadError(context, kind, target) ?? ACCEPTED;
}

function freezeTimeError(context: OperationContext, target: V2TargetReference): Refusal | undefined {
  const { time } = context.operation;
  if (typeof time !== "number" || !isFiniteInRange(time, 0, MAX_TIME_SECONDS)) return invalid("INVALID_VALUE", "retime_layer freeze requires time in seconds (composition time, 0-86400).");
  const layer = observedLayer(context.snapshot, target);
  return !layer || (time >= layer.inPoint && time < layer.outPoint) ? undefined : invalid("INVALID_VALUE", "retime_layer freeze time must fall inside the layer's in and out points.");
}

function retimeFieldsError(context: OperationContext, target: V2TargetReference): Refusal | undefined {
  const { mode, time } = context.operation;
  if (!isOneOf(mode, RETIME_MODES)) return invalid("INVALID_VALUE", `mode must be one of ${RETIME_MODES.join(", ")}.`);
  if (mode === "reverse") return time === undefined ? undefined : invalid("INVALID_VALUE", "retime_layer reverse takes no time.");
  return freezeTimeError(context, target);
}

/** Validates retime_layer: reverse or freeze a footage or precomp layer through its time remap. */
export function validateRetimeLayer(context: OperationContext): OperationResult {
  const { operation } = context;
  const unknown = rejectUnknown(operation, ["type", "target", "mode", "time"]);
  if (unknown) return unknown;
  const target = layerTarget(context, false);
  if (isRefusal(target)) return target;
  const layer = observedLayer(context.snapshot, target);
  if (layer && layer.type !== "av") return invalid("INVALID_TARGET", "retime_layer applies to footage and precomp layers; other layer types have no time remap.");
  return retimeFieldsError(context, target) ?? ACCEPTED;
}
