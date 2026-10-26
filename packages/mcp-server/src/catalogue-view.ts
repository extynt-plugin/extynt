// Compact rows for capability lists, effect inventories and project inventory diffs.
import { describePositionedValue } from "@extynt/capability-catalogue";
import { arrayAt, booleanAt, numberAt, objectAt, objectOf, objectsIn, stringAt } from "./json.js";
import { isJsonArray } from "@extynt/decode";
import type { JsonObject, JsonValue } from "@extynt/decode";
import { clip, short } from "./view-text.js";

function rangeSuffix(property: JsonObject): string {
  const range = objectAt(property, "reportedRange");
  const position = numberAt(range, "position");
  if (position === undefined) return "";
  return describePositionedValue("", { position, ofDefault: null, reason: null }, { minimum: numberAt(range, "minimum") ?? null, maximum: numberAt(range, "maximum") ?? null, units: stringAt(range, "units") ?? null });
}

function controlLine(property: JsonObject): string {
  return `${String(property.matchName)}|${String(property.displayName)}=${short(property.value)}${rangeSuffix(property)}`;
}

function effectRow(effect: JsonObject): JsonObject {
  const controls = objectsIn(arrayAt(effect, "properties")).filter((property) => property.kind === "property").map(controlLine);
  return objectOf({ path: effect.path, name: effect.displayName, enabled: booleanAt(effect, "enabled") === false ? false : undefined, controls });
}

function expressionRow(expression: JsonObject): JsonObject {
  return objectOf({ path: expression.path, expression: clip(String(expression.expression ?? ""), 400), enabled: booleanAt(expression, "enabled") === false ? false : undefined });
}

/** One layer's effects (path, name, controls with values and ranges) and expressions. */
export function effectsRow(row: JsonObject): JsonObject {
  const expressions = objectsIn(arrayAt(row, "expressions")).map(expressionRow);
  return objectOf({
    layerId: row.layerId,
    layerName: row.layerName,
    effects: objectsIn(arrayAt(row, "effects")).map(effectRow),
    expressions: expressions.length ? expressions : undefined,
  });
}

/** One capability as a short row: ids, names, category, a clipped description and its control count. */
export function capabilityRow(row: JsonObject): JsonObject {
  const description = stringAt(row, "description");
  return objectOf({
    id: row.id,
    matchName: row.matchName ? row.matchName : undefined,
    name: row.displayName,
    category: row.category ? row.category : undefined,
    description: description ? clip(description, 100) : undefined,
    controls: arrayAt(row, "controls")?.length ?? 0,
  });
}

/** The capability catalogue: its version, how it was enumerated and one short row per capability. */
export function catalogueView(data: JsonObject): JsonObject {
  return objectOf({ catalogueVersion: data.catalogueVersion, enumeration: data.enumeration, capabilities: objectsIn(arrayAt(data, "capabilities")).map(capabilityRow) });
}

/** The inventory diff with each collection reduced to its size. */
export function inventoryView(data: JsonObject): JsonObject {
  const inventory = objectAt(data, "inventory") ?? {};
  const counts: JsonObject = Object.fromEntries(Object.entries(inventory).map(([key, value]): [string, JsonValue] => [key, isJsonArray(value) ? value.length : value]));
  return objectOf({ inventory: counts, previousFingerprint: data.previousFingerprint, diff: data.diff });
}
