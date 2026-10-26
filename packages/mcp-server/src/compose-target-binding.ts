// The handler for every operation that acts on a layer: it resolves the composition and layer the operation's
// target names, mints the layer a create_layer declares, binds the layer-scoped placeholders and counts keyframes.
import { arrayAt, asObject, objectAt, objectsIn, stringAt } from "./json.js";
import { isJsonArray } from "@extynt/decode";
import type { JsonObject } from "@extynt/decode";
import { declarationNumberOf, impliedComposition, refusal, refused, storeOperation } from "./compose-pass.js";
import type { ComposePass, FamilyOutcome, LayerPlaceholder, Refusal, Resolved } from "./compose-pass.js";
import { bindLayerScopedPlaceholders } from "./compose-layer-binders.js";
import { declaredComposition, layerReference } from "./compose-references.js";
import type { OperationFields } from "./operation-fields.js";

function targetComposition(pass: ComposePass, target: JsonObject, input: { index: number; type: string }): Resolved<string> {
  const named = stringAt(target, "compositionId") ?? "";
  if (named) return declaredComposition(pass, named, input.index);
  const implied = impliedComposition(pass, { ...input, layerId: stringAt(target, "layerId") });
  if (!implied.ok) return implied;
  if (!implied.value) return refusal("INVALID_ARGUMENT", "Each operation target requires compositionId.");
  return declaredComposition(pass, implied.value, input.index);
}

function bindCreateLayerCaller(pass: ComposePass, created: LayerPlaceholder, callerId: string): Refusal | undefined {
  if (!callerId || callerId === created.layerId) return undefined;
  const held = pass.maps.layers.get(callerId);
  const duplicate = held !== undefined && held.layerId !== created.layerId && !pass.preBound.has(held.layerId);
  if (duplicate) return { code: "INVALID_ARGUMENT", message: "Duplicate new layer placeholder." };
  pass.maps.layers.set(callerId, created);
  return undefined;
}

function createLayerId(pass: ComposePass, target: JsonObject, input: { compositionId: string; index: number }): Resolved<string> {
  const layerId = pass.seed.canonicalAt?.[declarationNumberOf(pass.rawOperations, input.index)] ?? `__new__:layer${input.index}`;
  const problem = bindCreateLayerCaller(pass, { compositionId: input.compositionId, layerId }, stringAt(target, "layerId") ?? "");
  if (problem) return { ok: false, refusal: problem };
  pass.maps.layers.set(layerId, { compositionId: input.compositionId, layerId });
  return { ok: true, value: layerId };
}

function targetLayer(pass: ComposePass, candidate: OperationFields, input: { target: JsonObject; compositionId: string; index: number }): Resolved<string> {
  if (candidate.type === "create_layer") return createLayerId(pass, input.target, input);
  return layerReference(pass, stringAt(input.target, "layerId") ?? "", input.compositionId);
}

function targetReference(pass: ComposePass, resolved: LayerPlaceholder, target: JsonObject): JsonObject {
  const effectPath = stringAt(target, "effectPath");
  const propertyPath = stringAt(target, "propertyPath");
  return {
    compositionId: resolved.compositionId, layerId: resolved.layerId,
    snapshotFingerprint: pass.snapshot.fingerprint, selectionFingerprint: pass.snapshot.selectionFingerprint,
    ...(effectPath === undefined ? {} : { effectPath }),
    ...(propertyPath === undefined ? {} : { propertyPath }),
  };
}

function resolveTarget(pass: ComposePass, candidate: OperationFields, index: number): Resolved<LayerPlaceholder> {
  const target = objectAt(candidate, "target");
  if (!target) return refusal("INVALID_ARGUMENT", "Each operation requires a target with compositionId and layerId.");
  const composition = targetComposition(pass, target, { index, type: stringAt(candidate, "type") ?? "" });
  if (!composition.ok) return composition;
  const layer = targetLayer(pass, candidate, { target, compositionId: composition.value, index });
  if (!layer.ok) return layer;
  if (!layer.value) return refusal("INVALID_ARGUMENT", "Each operation target requires layerId (omit only for create_layer).");
  const resolved = { compositionId: composition.value, layerId: layer.value };
  candidate.target = targetReference(pass, resolved, target);
  return { ok: true, value: resolved };
}

function countKeyframes(operation: OperationFields): number {
  if (operation.type === "set_puppet_pins") return objectsIn(arrayAt(operation, "pins")).reduce((total, pin) => total + (arrayAt(pin, "keyframes")?.length ?? 0), 0);
  const keyframes = operation.keyframes;
  if (isJsonArray(keyframes)) return keyframes.length;
  return Object.values(asObject(keyframes) ?? {}).reduce((total: number, frames) => total + (isJsonArray(frames) ? frames.length : 0), 0);
}

/** Binds an operation on a layer: its target, the layer-scoped placeholders it declares or names, and its keyframes. */
export function bindTargetBearingOperation(pass: ComposePass, candidate: OperationFields, index: number): FamilyOutcome {
  const target = resolveTarget(pass, candidate, index);
  if (!target.ok) return refused(target.refusal);
  const problem = bindLayerScopedPlaceholders(pass, candidate, target.value, index);
  if (problem) return refused(problem);
  pass.totalKeyframes += countKeyframes(candidate);
  return storeOperation(pass, candidate);
}
