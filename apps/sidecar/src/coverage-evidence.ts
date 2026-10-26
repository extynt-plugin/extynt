// The snapshot and applied-operation facts request coverage reasons over; sits under coverage-features and orbit-coverage.
import { extractEffects, extractExpressions, flattenProperties } from "@extynt/project-graph";
import type { EffectSnapshot, ExpressionSnapshot, LayerSnapshot, ProjectSnapshot, PropertySnapshot } from "@extynt/project-graph";
import type { AppliedFact } from "./request-applied.js";

const CAMERA_MOVE_PATH = /(^|\/)(ADBE Position|ADBE Camera Zoom)$/;

/** What a coverage check reads: the project as the host reports it and the operations the job executed. */
export interface Evidence {
  snapshot: ProjectSnapshot;
  applied: readonly AppliedFact[];
}

const flattened = new WeakMap<LayerSnapshot, readonly PropertySnapshot[]>();
const effects = new WeakMap<LayerSnapshot, readonly EffectSnapshot[]>();
const expressions = new WeakMap<LayerSnapshot, readonly ExpressionSnapshot[]>();

function memoized<Value>(cache: WeakMap<LayerSnapshot, Value>, layer: LayerSnapshot, derive: (layer: LayerSnapshot) => Value): Value {
  const known = cache.get(layer);
  if (known !== undefined) return known;
  const derived = derive(layer);
  cache.set(layer, derived);
  return derived;
}

/** Every layer of every composition. */
export const layersOf = (snapshot: ProjectSnapshot): LayerSnapshot[] => snapshot.compositions.flatMap((composition) => composition.layers);

/** Every property of a layer, flattened once per layer. */
export const propertiesOf = (layer: LayerSnapshot): readonly PropertySnapshot[] => memoized(flattened, layer, (target) => flattenProperties(target.properties));

/** The enabled and disabled expressions of a layer, extracted once per layer. */
export const expressionsOf = (layer: LayerSnapshot): readonly ExpressionSnapshot[] => memoized(expressions, layer, extractExpressions);

const isKeyed = (property: PropertySnapshot): boolean => (property.keyframeCount ?? property.keyframes?.length ?? 0) > 0;

/** Whether some layer satisfies the test. */
export const anyLayer = (snapshot: ProjectSnapshot, test: (layer: LayerSnapshot) => boolean): boolean => layersOf(snapshot).some(test);

/** Whether some layer has an effect whose matchName satisfies the test. */
export const hasEffect = (snapshot: ProjectSnapshot, test: (matchName: string) => boolean): boolean => anyLayer(snapshot, (layer) => memoized(effects, layer, extractEffects).some((effect) => test(effect.matchName)));

/** Whether some property path, with whether it is keyed, satisfies the test. */
export const hasProperty = (snapshot: ProjectSnapshot, test: (path: string, keyed: boolean) => boolean): boolean => anyLayer(snapshot, (layer) => propertiesOf(layer).some((property) => test(property.path, isKeyed(property))));

/** Whether some enabled expression matches the pattern. */
export const hasExpression = (snapshot: ProjectSnapshot, pattern: RegExp): boolean => anyLayer(snapshot, (layer) => expressionsOf(layer).some((expression) => expression.enabled && pattern.test(expression.expression ?? "")));

const layerIdsOfType = (snapshot: ProjectSnapshot, type: LayerSnapshot["type"]): Set<string> => new Set(layersOf(snapshot).filter((layer) => layer.type === type).map((layer) => layer.id));

/** Whether an executed operation of one of the types exists whose JSON matches the pattern, or any when there is no pattern. */
export const appliedWith = (applied: readonly AppliedFact[], types: readonly string[], pattern?: RegExp): boolean => applied.some((operation) => types.includes(operation.type) && (!pattern || pattern.test(operation.json)));

/** A camera whose Position or Zoom is keyed, or a dolly_camera or animate_property on a camera's Position or Zoom that was executed. */
export function cameraMoved({ snapshot, applied }: Evidence): boolean {
  if (anyLayer(snapshot, (layer) => layer.type === "camera" && propertiesOf(layer).some((property) => CAMERA_MOVE_PATH.test(property.path) && isKeyed(property)))) return true;
  const cameras = layerIdsOfType(snapshot, "camera");
  return applied.some((operation) => operation.type === "dolly_camera" || (operation.type === "animate_property" && operation.layerId !== undefined && cameras.has(operation.layerId) && CAMERA_MOVE_PATH.test(operation.propertyPath ?? "")));
}

/** A set_track_matte in the project or among the executed operations whose matted layer or matte source is a text layer. */
export function textMatteShown({ snapshot, applied }: Evidence): boolean {
  const text = layerIdsOfType(snapshot, "text");
  const inProject = layersOf(snapshot).some((layer) => layer.matteLayerId !== null && (text.has(layer.id) || text.has(layer.matteLayerId)));
  return inProject || applied.some((operation) => operation.type === "set_track_matte" && [operation.layerId, operation.matteLayerId].some((id) => id !== undefined && text.has(id)));
}
