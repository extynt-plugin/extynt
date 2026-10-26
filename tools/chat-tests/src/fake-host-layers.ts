/** Layer-level writes: name, timing, the transform roles and the layer attributes the snapshot can record. */

import type { LayerSnapshot } from "@extynt/project-graph";
import type { JsonValue } from "@extynt/decode";
import { resolveLayer, type ApplyOutcome, type FixtureApplyContext } from "./fake-host-context.js";
import { keyframeCount, requireProperty, requireSettable, threeDOptionGroup } from "./fake-host-model.js";
import { MATERIAL_LAYER_TYPES, NATIVE_PROPERTY_PATHS, UNSUPPORTED_IN_FIXTURE } from "./fake-host-tables.js";
import { boundedNumber, isFiniteNumber, numericVector, own, propertyPathOf, refuse, textOf, type Field } from "./fake-host-values.js";
import type { WireObject } from "./wire-types.js";

const TIMING_FIELDS = ["inPoint", "outPoint", "startTime"] as const;

const SCALAR_ROLES: ReadonlySet<string> = new Set(["transform.rotation", "transform.opacity"]);

const MATERIAL_GROUP = "ADBE Material Options Group";

/** Renames the layer. */
export function applySetLayerName(context: FixtureApplyContext, operation: WireObject): ApplyOutcome {
  const { layer } = resolveLayer(context, operation, "set_layer_name");
  layer.name = textOf(operation.name, "set_layer_name name", { min: 1, max: 256 });
  return;
}

function hasTimingField(operation: WireObject): boolean {
  return TIMING_FIELDS.some((field) => operation[field] !== undefined) || operation.stretch !== undefined;
}

function validateTimingFields(operation: WireObject): void {
  for (const field of TIMING_FIELDS) {
    const value = operation[field];
    if (value !== undefined && !isFiniteNumber(value)) refuse("INVALID_VALUE", `set_layer_timing ${field} must be a finite number.`);
  }
}

function stretchLayerTiming(layer: LayerSnapshot, value: Field): void {
  const next = boundedNumber(value, "set_layer_timing stretch", { min: 1, max: 10000 });
  const ratio = layer.stretch === 0 ? 1 : next / layer.stretch;
  layer.outPoint = layer.inPoint + (layer.outPoint - layer.inPoint) * ratio;
  layer.stretch = next;
}

function shiftLayerStartTime(layer: LayerSnapshot, startTime: number): void {
  const delta = startTime - layer.startTime;
  layer.inPoint += delta;
  layer.outPoint += delta;
  layer.startTime = startTime;
}

/** Moves or stretches a layer in time; at least one of inPoint, outPoint, startTime and stretch must be named. */
export function applySetLayerTiming(context: FixtureApplyContext, operation: WireObject): ApplyOutcome {
  const { layer } = resolveLayer(context, operation, "set_layer_timing");
  const { stretch, startTime, inPoint, outPoint } = operation;
  if (!hasTimingField(operation)) refuse("INVALID_VALUE", "set_layer_timing needs at least one of inPoint, outPoint, startTime, stretch.");
  validateTimingFields(operation);
  if (stretch !== undefined) stretchLayerTiming(layer, stretch);
  if (isFiniteNumber(startTime)) shiftLayerStartTime(layer, startTime);
  if (isFiniteNumber(inPoint)) layer.inPoint = inPoint;
  if (isFiniteNumber(outPoint)) layer.outPoint = outPoint;
  return;
}

function transformValueOf(role: string, value: Field): JsonValue {
  const field = `set_layer_property ${role}`;
  return SCALAR_ROLES.has(role) ? boundedNumber(value, field, { min: -1_000_000_000, max: 1_000_000_000 }) : numericVector(value, field, [2, 3]);
}

/** Writes a transform role's static value; a keyframed property is refused. */
export function applySetLayerProperty(context: FixtureApplyContext, operation: WireObject): ApplyOutcome {
  const { layer } = resolveLayer(context, operation, "set_layer_property");
  const role = operation.role;
  const path = typeof role === "string" ? own(NATIVE_PROPERTY_PATHS, role) : undefined;
  if (typeof role !== "string" || path === undefined) refuse("INVALID_TARGET", `set_layer_property role must be one of ${Object.keys(NATIVE_PROPERTY_PATHS).join(", ")}.`);
  const requestedPath = propertyPathOf(operation);
  if (requestedPath === undefined) refuse("INVALID_TARGET", "set_layer_property requires propertyPath.");
  if (requestedPath !== path) refuse("INVALID_TARGET", `set_layer_property role ${role} addresses ${path}, not ${requestedPath}.`);
  const property = requireProperty(layer, path, "set_layer_property");
  requireSettable(property, "set_layer_property");
  if (keyframeCount(property) > 0) refuse("CONFLICTING_KEYS", `${path} has ${keyframeCount(property)} keyframe(s); a static value would only change the value at the current time. Use animate_property instead.`);
  property.value = transformValueOf(role, operation.value);
  return;
}

function setThreeD(layer: LayerSnapshot, on: boolean): void {
  layer.threeD = on;
  const present = layer.properties.some((property) => property.matchName === MATERIAL_GROUP);
  if (on && !present && MATERIAL_LAYER_TYPES.has(layer.type)) layer.properties.push(threeDOptionGroup("set_material_options"));
  if (!on && present) layer.properties = layer.properties.filter((property) => property.matchName !== MATERIAL_GROUP);
}

function setLabelAttribute(layer: LayerSnapshot, value: Field): void {
  const label = boundedNumber(value, "set_layer_attribute label", { min: 0, max: 16 });
  if (!Number.isInteger(label)) refuse("INVALID_VALUE", "set_layer_attribute label must be a whole number from 0 to 16.");
  layer.label = label;
}

function switchWriter(role: string, write: (layer: LayerSnapshot, on: boolean) => void): (layer: LayerSnapshot, value: Field) => void {
  return (layer, value) => {
    if (typeof value !== "boolean") refuse("INVALID_VALUE", `set_layer_attribute ${role} must be boolean.`);
    write(layer, value);
  };
}

const ATTRIBUTE_WRITERS: Readonly<Record<string, (layer: LayerSnapshot, value: Field) => void>> = {
  enabled: switchWriter("enabled", (layer, on) => { layer.enabled = on; }),
  shy: switchWriter("shy", (layer, on) => { layer.shy = on; }),
  solo: switchWriter("solo", (layer, on) => { layer.solo = on; }),
  "three-d": switchWriter("three-d", setThreeD),
  label: setLabelAttribute,
};

function blendModeOutcome(layer: LayerSnapshot, value: Field): string {
  if (typeof value !== "string" || !/^[A-Z_]+$/.test(value)) refuse("INVALID_VALUE", "set_layer_attribute blend-mode takes a BlendingMode name such as SCREEN or ADD.");
  return `set blend mode ${value} on layer ${layer.id} (not readable from a snapshot)`;
}

/** Writes a layer attribute the snapshot can show; one it cannot show is refused rather than reported. */
export function applySetLayerAttribute(context: FixtureApplyContext, operation: WireObject): ApplyOutcome {
  const { layer } = resolveLayer(context, operation, "set_layer_attribute");
  const role = operation.role;
  if (typeof role !== "string") refuse("INVALID_OPERATION", "set_layer_attribute requires a role.");
  if (role === "blend-mode") return blendModeOutcome(layer, operation.value);
  const write = own(ATTRIBUTE_WRITERS, role);
  if (!write) {
    refuse(UNSUPPORTED_IN_FIXTURE, `set_layer_attribute role "${role}" is not modelled by the fixture harness: a ProjectSnapshot's LayerSnapshot records enabled, shy, solo, label and the 3D switch, and the fixture will not report a ${role} change it cannot show.`);
  }
  write(layer, operation.value);
  return;
}
