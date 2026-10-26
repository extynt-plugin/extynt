/**
 * Camera, light and material options: the typed option leaves a 3D layer carries, written after the
 * whole option set has been validated and every option resolved on the layer. Also the Essential
 * Graphics publish, which is a property of a composition's template and not of a layer.
 */

import type { LayerSnapshot, PropertySnapshot } from "@extynt/project-graph";
import type { JsonValue } from "@extynt/decode";
import { isWireObject } from "@extynt/fake-plugin";
import { resolveLayer, type ApplyOutcome, type FixtureApplyContext } from "./fake-host-context.js";
import { propertyOf, requireProperty } from "./fake-host-model.js";
import { THREE_D_OPTION_GROUPS, type ThreeDOperation, type ThreeDOption, type ThreeDOptionGroup } from "./fake-host-tables.js";
import { boundedNumber, jsonOf, propertyPathOf, refuse, specValueError, textOf, type Field } from "./fake-host-values.js";
import type { WireObject } from "./wire-types.js";

interface ResolvedOption { property: PropertySnapshot; value: JsonValue }

function optionValueOf(option: ThreeDOption, key: string, value: Field, type: string): JsonValue {
  if (option.kind === "number") return boundedNumber(value, `${type} ${key}`, { min: option.min, max: option.max });
  const error = specValueError(option.kind, value);
  if (error) refuse("INVALID_VALUE", `${type} ${key} ${error}.`);
  return jsonOf(value, `${type} ${key}`);
}

function requestedOptions(layer: LayerSnapshot, operation: WireObject, type: ThreeDOperation): { spec: ThreeDOptionGroup; options: WireObject } {
  const spec = THREE_D_OPTION_GROUPS[type];
  const options = operation.options;
  if (!isWireObject(options) || Object.keys(options).length === 0) refuse("INVALID_VALUE", `${type} requires a non-empty typed options object.`);
  if (spec.layerType && layer.type !== spec.layerType) refuse("THREED_OPTIONS_UNSUPPORTED", `${type} applies to a ${spec.layerType} layer; ${layer.id} is a ${layer.type} layer.`);
  return { spec, options };
}

function resolvedOptions(layer: LayerSnapshot, operation: WireObject, type: ThreeDOperation): ResolvedOption[] {
  const { spec, options } = requestedOptions(layer, operation, type);
  const resolved: ResolvedOption[] = [];
  for (const [key, raw] of Object.entries(options)) {
    const option = Object.hasOwn(spec.options, key) ? spec.options[key] : undefined;
    if (!option) refuse("INVALID_VALUE", `${type} has no option "${key}"; use one of ${Object.keys(spec.options).join(", ")}.`);
    const value = optionValueOf(option, key, raw, type);
    const property = propertyOf(layer, `${spec.matchName}/${option.matchName}`);
    if (!property) refuse("THREED_OPTIONS_UNSUPPORTED", `${spec.matchName}/${option.matchName} is not available on layer ${layer.id}${type === "set_material_options" ? "; Material Options exist only while the layer's 3D switch is on" : ""}.`);
    resolved.push({ property, value });
  }
  return resolved;
}

/** Writes a camera, light or material option set after validating and resolving every option. */
export function applyThreeDOptions(context: FixtureApplyContext, operation: WireObject, type: ThreeDOperation): ApplyOutcome {
  const { layer } = resolveLayer(context, operation, type);
  const resolved = resolvedOptions(layer, operation, type);
  for (const { property, value } of resolved) property.value = value;
  return `set ${resolved.length} ${type.replace("set_", "").replace("_options", "")} option(s) on layer ${layer.id}`;
}

/**
 * Exposing a property in Essential Graphics. A ProjectSnapshot has no master-property list, so the
 * project state does not change and the step carries only the host's own report; nothing in the
 * snapshot can confirm it, and the sidecar leaves it unverified.
 */
export function applyAddEssentialProperty(context: FixtureApplyContext, operation: WireObject): ApplyOutcome {
  const { layer } = resolveLayer(context, operation, "add_essential_property");
  const requestedPath = propertyPathOf(operation);
  const name = operation.name;
  if (requestedPath === undefined) refuse("INVALID_TARGET", "add_essential_property requires target.propertyPath.");
  if (name !== undefined && name !== null) textOf(name, "add_essential_property name", { min: 1, max: 256 });
  const property = requireProperty(layer, requestedPath, "add_essential_property");
  if (property.kind !== "property") refuse("ESSENTIAL_GRAPHICS_UNSUPPORTED", `add_essential_property: ${property.path} is a group, and After Effects can add only a property to Essential Graphics.`);
  context.evidence = { propertyPath: requestedPath, named: typeof name === "string", verification: "essential-property-added" };
  return `exposed ${property.path} on layer ${layer.id} in Essential Graphics${typeof name === "string" ? ` as "${name}"` : ""}`;
}
