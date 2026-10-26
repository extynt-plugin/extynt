// One line of text for a plan operation: its type, target, property path, keyframes and remaining fields.
import { asObject, numberAt, objectAt } from "./json.js";
import { isJsonArray, isJsonObject } from "@extynt/decode";
import type { JsonObject, JsonValue } from "@extynt/decode";
import { clip, short } from "./view-text.js";

const SKIPPED_FIELDS = new Set(["type", "target", "keyframes", "role"]);
const LINE_LENGTH = 240;

function targetId(target: JsonObject | undefined): string {
  return String(target?.layerId ?? target?.itemId ?? target?.compositionId ?? "");
}

function targetWords(operation: JsonObject, name: string | undefined): string {
  const id = targetId(objectAt(operation, "target"));
  return name && name !== id ? `${id}(${name})` : id;
}

function pathWords(operation: JsonObject): string {
  const target = objectAt(operation, "target");
  return String(target?.propertyPath ?? target?.effectPath ?? "");
}

function keyframeEnds(count: number, first: JsonObject | undefined, last: JsonObject | undefined): string {
  return `${count}k ${short(first?.value)}→${short(last?.value)} @${String(first?.time)}-${String(last?.time)}s`;
}

function keyframeWords(keys: JsonValue | undefined): string | undefined {
  if (isJsonArray(keys) && keys.length) return keyframeEnds(keys.length, asObject(keys[0]), asObject(keys.at(-1)));
  const count = isJsonObject(keys) ? numberAt(keys, "count") : undefined;
  return isJsonObject(keys) && count !== undefined ? keyframeEnds(count, objectAt(keys, "first"), objectAt(keys, "last")) : undefined;
}

function otherFields(operation: JsonObject): string[] {
  return Object.entries(operation).filter(([key]) => !SKIPPED_FIELDS.has(key)).map(([key, value]) => `${key}=${short(value)}`);
}

/** The operation as one line: type, target (with the layer's name when known), property path, keyframe range, then `field=value` for the rest. */
export function operationLine(operation: JsonObject, targetName: string | undefined): string {
  const keyframes = keyframeWords(operation.keyframes);
  const parts = [String(operation.type), targetWords(operation, targetName), pathWords(operation)].filter((part) => part !== "");
  return clip([...parts, ...(keyframes ? [keyframes] : []), ...otherFields(operation)].join(" "), LINE_LENGTH);
}
