// detect_scene_edits: what the snapshot already proves After Effects will refuse before the host is asked to find cuts.
import type { ProjectSnapshot, PropertySnapshot } from "@extynt/project-graph";
import { currentLayerTarget, observedLayer, plannedOrObservedLayer, type OperationContext } from "./layer-targets.js";
import { SCENE_EDIT_MODES } from "./plan-constants.js";
import type { V2TargetReference } from "./plan-types.js";
import { ACCEPTED, invalid, isOneOf, isRefusal, rejectUnknown, type OperationResult, type Refusal } from "./validation-primitives.js";

function isTimeRemapped(property: PropertySnapshot): boolean {
  return property.enabled === true || property.expressionEnabled === true || (property.keyframes?.length ?? 0) > 0;
}

function sceneEditLayerError(snapshot: ProjectSnapshot | undefined, target: V2TargetReference): Refusal | undefined {
  const layer = observedLayer(snapshot, target);
  if (!layer) return undefined;
  if (layer.type !== "av") return invalid("SCENE_EDIT_NOT_VIDEO", `Scene edit detection only runs on a footage layer; ${layer.name} is a ${layer.type} layer.`);
  const remap = layer.properties.find((property) => property.matchName === "ADBE Time Remapping");
  if (remap && isTimeRemapped(remap)) return invalid("SCENE_EDIT_TIME_REMAPPED", `${layer.name} has time remapping on; After Effects refuses scene edit detection there. Turn time remapping off first (set_time_remap enabled:false), then detect.`);
  return undefined;
}

/** detect_scene_edits: an exact layer target, a known mode, and a footage layer without time remapping when the snapshot shows it. */
export function validateDetectSceneEdits(context: OperationContext): OperationResult {
  const { operation, plan, snapshot } = context;
  const unknownField = rejectUnknown(operation, ["type", "target", "mode"]);
  if (unknownField) return unknownField;
  const target = currentLayerTarget(operation, plan, true, "detect_scene_edits requires an exact layer target with no effect or property path.");
  if (isRefusal(target)) return target;
  if (!isOneOf(operation.mode, SCENE_EDIT_MODES)) return invalid("INVALID_VALUE", `mode must be one of ${SCENE_EDIT_MODES.join(", ")}.`);
  const missing = plannedOrObservedLayer(context, target, "Scene edit detection needs an existing layer.");
  return missing ?? sceneEditLayerError(snapshot, target) ?? ACCEPTED;
}
