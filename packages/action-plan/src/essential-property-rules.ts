// add_essential_property: exposes one property of a layer as an Essential Graphics control.
import { flattenProperties } from "@extynt/project-graph";
import { layerTarget, observedLayer, type OperationContext } from "./layer-targets.js";
import { ACCEPTED, invalid, isOptionalBoundedName, isRefusal, rejectUnknown, type OperationResult } from "./validation-primitives.js";

const MAX_NAME_LENGTH = 256;

/** Validates add_essential_property: a layer target with a propertyPath that the snapshot, when it holds the layer, also holds. */
export function validateAddEssentialProperty(context: OperationContext): OperationResult {
  const { operation } = context;
  const unknown = rejectUnknown(operation, ["type", "target", "name"]);
  if (unknown) return unknown;
  const target = layerTarget(context, true);
  if (isRefusal(target)) return target;
  if (!target.propertyPath) return invalid("INVALID_TARGET", "add_essential_property requires target.propertyPath.");
  if (!isOptionalBoundedName(operation.name, MAX_NAME_LENGTH)) return invalid("INVALID_VALUE", "Essential Property name must be 1-256 characters.");
  const layer = observedLayer(context.snapshot, target);
  if (layer && !flattenProperties(layer.properties).some((property) => property.path === target.propertyPath)) return invalid("TARGET_NOT_FOUND", "The property path is not present in the current snapshot.");
  return ACCEPTED;
}
