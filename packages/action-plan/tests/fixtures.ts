// Typed fixtures for the action-plan suites: the representative targets, the snapshot variants, and the new-composition operations.
import { representativeSnapshot, type LayerSnapshot, type ProjectSnapshot, type PropertySnapshot } from "@extynt/project-graph";
import { type JsonObject, type JsonValue } from "@extynt/decode";
import type { CreateCompositionOperation } from "../src/index.js";

export const fingerprints = { snapshotFingerprint: representativeSnapshot.fingerprint, selectionFingerprint: representativeSnapshot.selectionFingerprint } satisfies JsonObject;

export const target = { compositionId: "comp-main", layerId: "layer-title", ...fingerprints } satisfies JsonObject;
export const compositionTarget = { compositionId: "comp-main", ...fingerprints } satisfies JsonObject;
export const footageTarget = { compositionId: "comp-main", layerId: "layer-footage", ...fingerprints } satisfies JsonObject;

export const ANCHOR_PATH = "ADBE Transform Group/ADBE Anchor Point";
export const POSITION_PATH = "ADBE Transform Group/ADBE Position";
export const OPACITY_PATH = "ADBE Transform Group/ADBE Opacity";
export const BLUR_EFFECT_PATH = "ADBE Effect Parade/ADBE Gaussian Blur 2";
export const BLUR_CONTROL_PATH = `${BLUR_EFFECT_PATH}/ADBE Gaussian Blur 2-0001`;

export const EMPTY_SNAPSHOT: ProjectSnapshot = { ...representativeSnapshot, compositions: [], items: [] };
const emptyFingerprints = { snapshotFingerprint: EMPTY_SNAPSHOT.fingerprint, selectionFingerprint: EMPTY_SNAPSHOT.selectionFingerprint };

export function newTarget(extra: JsonObject = {}): JsonObject {
  return { compositionId: "__new__:comp0", layerId: "__new__:layer1", ...emptyFingerprints, ...extra };
}

export const newComposition = { type: "create_composition", newCompositionId: "__new__:comp0", ...emptyFingerprints, name: "Credits Roll", width: 1920, height: 1080, durationSeconds: 12, frameRate: 24 } satisfies CreateCompositionOperation;

export const newTextLayer = { type: "create_layer", target: newTarget(), layerType: "text", name: "Credits", text: "Directed by" } satisfies JsonObject;

export function expressionOn(propertyPath: string): JsonObject {
  return { type: "set_expression", target: newTarget({ propertyPath }), enabled: true, source: "value" } satisfies JsonObject;
}

export function animatorPath(animator: string, leaf: string): string {
  return `ADBE Text Properties/ADBE Text Animators/${animator}/${leaf}`;
}

export function nativeWrite(role: string, propertyPath: string, value: JsonValue): JsonObject {
  return { type: "set_layer_property", target, role, propertyPath, value };
}

export function mapLayers(snapshot: ProjectSnapshot, change: (layer: LayerSnapshot) => LayerSnapshot): ProjectSnapshot {
  return { ...snapshot, compositions: snapshot.compositions.map((comp) => ({ ...comp, layers: comp.layers.map(change) })) };
}

export function withLayerProperties(snapshot: ProjectSnapshot, layerId: string, added: readonly PropertySnapshot[]): ProjectSnapshot {
  return mapLayers(snapshot, (layer) => (layer.id === layerId ? { ...layer, properties: [...layer.properties, ...added] } : layer));
}

export function snapshotWithMask(path: string, vertexCount: number): ProjectSnapshot {
  const vertices = Array.from({ length: vertexCount }, (_, index) => [index * 10, 0]);
  const property = { path, matchName: "ADBE Mask Shape", displayName: "Mask Path", kind: "property", valueType: "unknown", value: { vertices }, canSetValue: true } satisfies PropertySnapshot;
  return withLayerProperties(representativeSnapshot, "layer-footage", [property]);
}
