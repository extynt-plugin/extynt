// replace_layer_source, center_anchor and copy_effects: three layer edits After Effects scripting exposes one call for each.
// The operation interfaces and type list are the public contract; the rules validate one operation each.
import type { JsonObject, JsonValue } from "@extynt/decode";
import { isJsonObject } from "./json-shape.js";
import { hasPlannedComposition, hasPlannedLayer, layerTarget, listedCompositions, listedLayers, type LayerAddress, type OperationContext } from "./layer-targets.js";
import { earlierWith } from "./operation-checks.js";
import { ACCEPTED, invalid, isFiniteInRange, isRefusal, rejectUnknown, type OperationResult, type Refusal } from "./validation-primitives.js";

const MAX_COPIED_EFFECTS = 32;
const EFFECT_PATH_PATTERN = /^ADBE Effect Parade\/[^/]+$/;

function itemExists({ snapshot, earlier }: OperationContext, id: string): boolean {
  if (!snapshot) return true;
  if (snapshot.items?.some((item) => item.id === id) || snapshot.compositions.some((composition) => composition.id === id)) return true;
  return hasPlannedComposition(earlier, id) || earlierWith(earlier, (op) => (op.type === "import_file" || op.type === "create_vector_artwork") && op.newItemId === id);
}

/** Validates replace_layer_source, which swaps what a layer shows and keeps its transforms, unlike replace_footage, which swaps a footage item for every layer that uses it. */
export function validateReplaceLayerSource(context: OperationContext): OperationResult {
  const { operation } = context;
  const unknown = rejectUnknown(operation, ["type", "target", "sourceItemId"]);
  if (unknown) return unknown;
  const target = layerTarget(context, false);
  if (isRefusal(target)) return target;
  const id = operation.sourceItemId;
  if (typeof id !== "string" || !id) return invalid("INVALID_OPERATION", "replace_layer_source needs sourceItemId: the footage or composition item the layer should show.");
  if (id === target.compositionId) return invalid("INVALID_VALUE", "A layer cannot show the composition it sits in.");
  return itemExists(context, id) ? ACCEPTED : invalid("TARGET_NOT_FOUND", "sourceItemId must be a footage or composition item in the snapshot or imported/created earlier in this plan.");
}

/** Validates center_anchor, which moves a layer's anchor point to the middle of its content and compensates Position so nothing moves on screen. */
export function validateCenterAnchor(context: OperationContext): OperationResult {
  const { operation } = context;
  const unknown = rejectUnknown(operation, ["type", "target", "time"]);
  if (unknown) return unknown;
  const target = layerTarget(context, false);
  if (isRefusal(target)) return target;
  if (operation.time !== undefined && !isFiniteInRange(operation.time, 0, 86_400)) return invalid("INVALID_VALUE", "time is the composition time in seconds at which the content is measured (default 0).");
  return ACCEPTED;
}

/** True for 1-32 distinct "ADBE Effect Parade/<matchName>" effect paths. */
export function isEffectPathList(paths: JsonValue): boolean {
  return Array.isArray(paths) && paths.length >= 1 && paths.length <= MAX_COPIED_EFFECTS && new Set(paths).size === paths.length && paths.every((path) => typeof path === "string" && EFFECT_PATH_PATTERN.test(path));
}

function effectPathsError({ operation }: OperationContext): Refusal | undefined {
  const paths = operation.effectPaths;
  if (paths === undefined || isEffectPathList(paths)) return undefined;
  return invalid("INVALID_VALUE", `effectPaths is 1-${MAX_COPIED_EFFECTS} distinct "ADBE Effect Parade/<matchName>" paths ("#N" for the Nth instance); leave it out to copy every effect.`);
}

function copySource(source: JsonObject | undefined): LayerAddress | undefined {
  if (!source || rejectUnknown(source, ["compositionId", "layerId"])) return undefined;
  const { compositionId, layerId } = source;
  return typeof compositionId === "string" && typeof layerId === "string" ? { compositionId, layerId } : undefined;
}

function copySourceMissing({ snapshot, earlier }: OperationContext, source: LayerAddress): Refusal | undefined {
  if (!snapshot) return undefined;
  const composition = snapshot.compositions.find((candidate) => candidate.id === source.compositionId);
  if (!composition && !hasPlannedComposition(earlier, source.compositionId)) return invalid("TARGET_NOT_FOUND", `copy_effects source composition is not present or created earlier in this plan. ${listedCompositions(snapshot, earlier, source.compositionId)}`);
  if (composition && !composition.layers.some((layer) => layer.id === source.layerId) && !hasPlannedLayer(earlier, source)) return invalid("TARGET_NOT_FOUND", `copy_effects source layer must exist or be created earlier in this plan. ${listedLayers(snapshot, source, earlier)}`);
  return undefined;
}

function copySourceError(context: OperationContext, target: LayerAddress): Refusal | undefined {
  const rawSource = context.operation.source;
  const source = copySource(isJsonObject(rawSource) ? rawSource : undefined);
  if (!source) return invalid("INVALID_OPERATION", "copy_effects needs source: { compositionId, layerId } naming the layer to copy effects from.");
  if (source.compositionId === target.compositionId && source.layerId === target.layerId) return invalid("INVALID_VALUE", "copy_effects needs a source layer other than the target layer.");
  return copySourceMissing(context, source);
}

/** Validates copy_effects, which rebuilds the effects of one layer on another, with their values, keyframes and expressions, across compositions. */
export function validateCopyEffects(context: OperationContext): OperationResult {
  const { operation } = context;
  const unknown = rejectUnknown(operation, ["type", "target", "source", "effectPaths"]);
  if (unknown) return unknown;
  const target = layerTarget(context, false);
  if (isRefusal(target)) return target;
  return copySourceError(context, target) ?? effectPathsError(context) ?? ACCEPTED;
}
