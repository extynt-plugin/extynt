/** Mask operations: adding a mask with its path, opacity, feather and expansion, and updating one a later step names. */

import { isWireObject } from "@extynt/fake-plugin";
import type { LayerSnapshot, PropertySnapshot } from "@extynt/project-graph";
import type { JsonValue } from "@extynt/decode";
import { ordinalOf, resolveLayer, resolveOrdinal, type ApplyOutcome, type FixtureApplyContext } from "./fake-host-context.js";
import { childSegment, childrenOf, ensureChildGroup, findChild, group, layerRoot, leaf } from "./fake-host-model.js";
import { requireShapePath, shapePathMessage } from "./fake-host-shape-path.js";
import { MASK_ATOM, MASK_PARADE } from "./fake-host-tables.js";
import { boundedNumber, jsonOf, numericVector, placeholderOf, refuse, textOf, type Field } from "./fake-host-values.js";
import type { WireObject } from "./wire-types.js";

const MASK_KEYS = ["path", "opacity", "feather", "expansion"] as const;

type MaskKey = typeof MASK_KEYS[number];

interface MaskField { matchName: string; displayName: string; valueType: PropertySnapshot["valueType"]; initial: JsonValue; read: (value: Field) => JsonValue }

const MASK_FIELDS: Readonly<Record<MaskKey, MaskField>> = {
  path: {
    matchName: "ADBE Mask Shape", displayName: "Mask Path", valueType: "unknown", initial: null,
    read: (value) => { requireShapePath(value, shapePathMessage("Mask path")); return jsonOf(value, "mask path"); },
  },
  opacity: { matchName: "ADBE Mask Opacity", displayName: "Mask Opacity", valueType: "number", initial: 100, read: (value) => boundedNumber(value, "mask opacity", { min: 0, max: 100 }) },
  feather: { matchName: "ADBE Mask Feather", displayName: "Mask Feather", valueType: "vector", initial: [0, 0], read: (value) => numericVector(value, "mask feather", [2]) },
  expansion: { matchName: "ADBE Mask Offset", displayName: "Mask Expansion", valueType: "number", initial: 0, read: (value) => boundedNumber(value, "mask expansion", { min: -10000, max: 10000 }) },
};

function maskValuesOf(values: Field, requireOne: boolean): Array<[MaskKey, JsonValue]> {
  if (!isWireObject(values)) refuse("INVALID_VALUE", "Mask values must be an object of path, opacity, feather, and/or expansion.");
  if (requireOne && Object.keys(values).length === 0) refuse("INVALID_VALUE", "update_mask requires at least one of path, opacity, feather, expansion.");
  for (const key of Object.keys(values)) if (!MASK_KEYS.some((known) => known === key)) refuse("INVALID_VALUE", `Mask values have no "${key}"; they set ${MASK_KEYS.join(", ")}.`);
  const out: Array<[MaskKey, JsonValue]> = [];
  for (const key of MASK_KEYS) {
    const value = values[key];
    if (value !== undefined) out.push([key, MASK_FIELDS[key].read(value)]);
  }
  return out;
}

function writeMaskValues(mask: PropertySnapshot, values: Array<[MaskKey, JsonValue]>): void {
  for (const [key, value] of values) {
    const { matchName } = MASK_FIELDS[key];
    const property = findChild(mask, matchName);
    if (!property) refuse("PROPERTY_NOT_SETTABLE", `The fixture's mask ${mask.path} has no ${matchName} property.`);
    property.value = value;
  }
}

function paradeOf(layer: LayerSnapshot, label: string): PropertySnapshot {
  const parade = findChild(layerRoot(layer), MASK_PARADE);
  if (!parade) refuse("TARGET_NOT_FOUND", `${label}: layer ${layer.id} has no ${MASK_PARADE} group in this fixture.`);
  return parade;
}

function ordinalMask(layer: LayerSnapshot, rawMaskId: string, label: string): PropertySnapshot {
  const parade = paradeOf(layer, label);
  const match = /^mask:([1-9][0-9]{0,2})$/.exec(rawMaskId);
  if (!match) refuse("TARGET_NOT_FOUND", `${label}: maskId must be mask:<n> (1-based, from ae_inspect_layer) or a newMaskId added earlier in this call.`);
  const mask = resolveOrdinal(parade, MASK_ATOM, Number(match[1]));
  if (!mask) refuse("TARGET_NOT_FOUND", `${label}: no mask at ordinal ${match[1]} on layer ${layer.id}. Masks: ${(parade.children ?? []).filter((child) => child.matchName === MASK_ATOM).map((child) => child.displayName).join(", ") || "none"}.`);
  return mask;
}

function maskOf(context: FixtureApplyContext, layer: LayerSnapshot, rawMaskId: Field, label: string): PropertySnapshot {
  if (typeof rawMaskId !== "string" || rawMaskId.length === 0) refuse("INVALID_TARGET", `${label} requires a maskId.`);
  return context.createdMasks.get(rawMaskId) ?? ordinalMask(layer, rawMaskId, label);
}

function newMask(parade: PropertySnapshot, name: string): PropertySnapshot {
  const segment = childSegment(parade, MASK_ATOM);
  return group(`${parade.path}/${segment}`, MASK_ATOM, name, MASK_KEYS.map((key) => {
    const { matchName, displayName, valueType, initial } = MASK_FIELDS[key];
    return leaf({ path: `${parade.path}/${segment}/${matchName}`, matchName, displayName, valueType, value: initial });
  }));
}

/** Adds a mask under a `__new__:` placeholder, writing the values the plan gives it. */
export function applyAddMask(context: FixtureApplyContext, operation: WireObject): ApplyOutcome {
  const { layer } = resolveLayer(context, operation, "add_mask");
  const placeholder = placeholderOf(operation.newMaskId, "add_mask declares newMaskId, which must be a __new__:<name> placeholder for the mask it creates.");
  const name = textOf(operation.name, "add_mask name", { min: 1, max: 256 });
  const values = operation.values === undefined ? [] : maskValuesOf(operation.values, false);
  const parade = ensureChildGroup(layerRoot(layer), MASK_PARADE, "Masks");
  const mask = newMask(parade, name);
  childrenOf(parade).push(mask);
  writeMaskValues(mask, values);
  const ordinal = ordinalOf(parade, MASK_ATOM, mask);
  context.createdMasks.set(placeholder, mask);
  context.bindings[placeholder] = `mask:${ordinal}`;
  return `added mask "${name}" as mask:${ordinal} on layer ${layer.id}`;
}

/** Writes the values the plan gives onto a mask it or an earlier step named. */
export function applyUpdateMask(context: FixtureApplyContext, operation: WireObject): ApplyOutcome {
  const { layer } = resolveLayer(context, operation, "update_mask");
  const mask = maskOf(context, layer, operation.maskId, "update_mask");
  writeMaskValues(mask, maskValuesOf(operation.values, true));
  return;
}
