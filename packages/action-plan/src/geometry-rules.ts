// Mask and shape geometry: the Shape DTO, mask values, and the ordinal id spellings AE exposes. Only data that converts
// deterministically into an AE value passes.
import { accepts, isJsonArray, type JsonObject, type JsonValue } from "@extynt/decode";
import { isJsonObject } from "./json-shape.js";
import { shapePath } from "./shape-decoder.js";
import { hasOnlyKeys, isFiniteInRange, isNewPlaceholderId, isOneOf, isOptionalBoolean, isOptionalFiniteInRange } from "./validation-primitives.js";

type Field = JsonValue | undefined;

const MASK_VALUE_KEYS = ["path", "opacity", "feather", "expansion", "mode", "inverted", "rotoBezier"];
const MASK_MODES = ["NONE", "ADD", "SUBTRACT", "INTERSECT", "LIGHTEN", "DARKEN", "DIFFERENCE"] as const;

/** True for a bounded Shape DTO: 1-1000 vertices, optional tangents matching them in length, and a closed flag. */
export const isShapePath = accepts(shapePath);

function isMaskFeather(value: Field): boolean {
  return isJsonArray(value) && value.length === 2 && value.every((entry) => isFiniteInRange(entry, 0, 10_000));
}

function hasValidMaskGeometry({ path, opacity, feather, expansion }: JsonObject): boolean {
  return (path === undefined || isShapePath(path)) && isOptionalFiniteInRange(opacity, 0, 100) && (feather === undefined || isMaskFeather(feather)) && isOptionalFiniteInRange(expansion, -10_000, 10_000);
}

function hasValidMaskSettings({ mode, inverted, rotoBezier }: JsonObject): boolean {
  return (mode === undefined || isOneOf(mode, MASK_MODES)) && isOptionalBoolean(inverted) && isOptionalBoolean(rotoBezier);
}

/** True for a bounded set of mask values; with `requireOne` the set must name at least one value. */
export function isMaskValues(value: Field, requireOne: boolean): boolean {
  if (!isJsonObject(value) || !hasOnlyKeys(value, MASK_VALUE_KEYS)) return false;
  if (requireOne && Object.keys(value).length === 0) return false;
  return hasValidMaskGeometry(value) && hasValidMaskSettings(value);
}

/** True for a mask id: a `__new__:` placeholder or an explicit `mask:N` ordinal. */
export function validMaskId(value: Field): value is string { return typeof value === "string" && (isNewPlaceholderId(value) || /^mask:[1-9][0-9]{0,2}$/.test(value)); }

/** True for a shape group id: `root`, a `__new__:` placeholder or an explicit `shape:N` ordinal. */
export function validShapeId(value: Field): value is string { return typeof value === "string" && (value === "root" || isNewPlaceholderId(value) || /^shape:[1-9][0-9]{0,2}$/.test(value)); }

/** True for three normalized colour channels. */
export function validColor(value: Field): value is [number, number, number] { return isJsonArray(value) && value.length === 3 && value.every((channel) => isFiniteInRange(channel, 0, 1)); }
