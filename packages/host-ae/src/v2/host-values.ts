// Validated plan values become the exact wire values the panel hands to After Effects.
import { resolveCurve, type AddTextAnimatorOperation, type KeyframeMode, type KeyframeSpec, type UpdateTextAnimatorOperation, type V2TargetReference } from "@extynt/action-plan";
import type { LayerRef } from "../host-layer-operations.js";
import type { HostSpecAnimation, HostSpecWrite, SpecResolution, SpecValues } from "../host-spec-operations.js";

export function layerRef(target: LayerRef): LayerRef {
  return { compositionId: target.compositionId, layerId: target.layerId };
}

export function validatedPropertyPath(target: V2TargetReference): string {
  return target.propertyPath ?? "";
}

function resolveKeyframe(keyframe: KeyframeSpec): KeyframeSpec {
  const { curve, ...rest } = keyframe;
  const resolved = curve === undefined ? undefined : resolveCurve(curve);
  return resolved === undefined ? rest : { ...rest, curve: resolved };
}

/** The host only receives numeric cubic-bezier control points, so named curve presets resolve here. */
export function hostKeyframes(keyframes: readonly KeyframeSpec[] | undefined): KeyframeSpec[] | undefined {
  return keyframes?.map(resolveKeyframe);
}

export function hostWrites(writes: SpecResolution["writes"]): HostSpecWrite[] {
  return writes.map(({ path, value }) => ({ path, value }));
}

export function hostAnimations(animations: SpecResolution["animations"], keyframeMode: KeyframeMode | undefined): HostSpecAnimation[] {
  return animations.map(({ path, keyframes }) => ({ path, keyframes: keyframes.map(resolveKeyframe), ...(keyframeMode ? { keyframeMode } : {}) }));
}

/** Selector settings are addressed as selector.<setting> beside the animator's own properties. */
export function textAnimatorValues(operation: AddTextAnimatorOperation | UpdateTextAnimatorOperation): SpecValues {
  const selectorValues = Object.fromEntries(Object.entries(operation.selector?.settings ?? {}).map(([key, value]) => [`selector.${key}`, value]));
  return { ...operation.properties, ...selectorValues };
}
