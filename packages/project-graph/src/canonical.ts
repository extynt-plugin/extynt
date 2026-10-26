/**
 * The canonical text of snapshot parts, written in one pass with no deep clone first: keys sorted, `undefined`-valued
 * keys dropped, non-finite numbers written as null, and the fields that are observation state rather than project
 * content left out.
 */
import { createHash } from "node:crypto";
import { isJsonArray, isJsonObject } from "@extynt/decode";
import type { JsonObject, JsonValue } from "@extynt/decode";

type Mode = "plain" | "property" | "layer";
type FieldEncoder = (record: JsonObject, key: string) => string | undefined;

/** Top-level snapshot fields that are observation state, not project content: capture time, the open composition, selection, the adapter revision token and host change counter, freshness, warnings and truncation. */
export const VOLATILE_SNAPSHOT_FIELDS: ReadonlySet<string> = new Set([
  "fingerprint", "capturedAt", "currentTime", "selection", "selectionFingerprint", "activeCompositionId", "revision", "hostStamp", "freshness", "warnings", "truncation",
]);

const KEY_TEXT = new Map<string, string>();
const KEY_TEXT_LIMIT = 4096;

function keyText(key: string): string {
  let text = KEY_TEXT.get(key);
  if (text === undefined) {
    if (KEY_TEXT.size >= KEY_TEXT_LIMIT) KEY_TEXT.clear();
    text = `${JSON.stringify(key)}:`;
    KEY_TEXT.set(key, text);
  }
  return text;
}

/** The SHA-256 digest of `text` as lowercase hex. */
export function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Whether a property's value is sampled at the current time, which is the case when it is keyframed or expression-driven; key counts, digests and expression sources identify such an animation. */
export function isSampledProperty(property: JsonObject): boolean {
  const keyframeCount = property.keyframeCount;
  return (typeof keyframeCount === "number" && keyframeCount > 0) || property.expressionEnabled === true;
}

/** A value's text, or undefined for a missing value, which JSON drops. */
export function encodeValue(value: JsonValue | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value === null) return "null";
  switch (typeof value) {
    case "string": return JSON.stringify(value);
    case "number": return Number.isFinite(value) ? String(value) : "null";
    case "boolean": return String(value);
    default: return isJsonArray(value) ? encodeArray(value, "plain") : encodeRecord(value, "plain");
  }
}

function encodeMember(item: JsonValue | undefined, mode: Mode): string | undefined {
  return mode !== "plain" && isJsonObject(item) ? encodeRecord(item, mode) : encodeValue(item);
}

function encodeArray(values: readonly JsonValue[], mode: Mode): string {
  return `[${values.map((item) => encodeMember(item, mode) ?? "null").join(",")}]`;
}

function plainField(record: JsonObject, key: string): string | undefined {
  return encodeValue(record[key]);
}

function propertyField(property: JsonObject, key: string): string | undefined {
  const value = property[key];
  if (key === "value") return isSampledProperty(property) ? undefined : encodeValue(value);
  if (key === "children" && Array.isArray(value)) return encodeArray(value, "property");
  return encodeValue(value);
}

function layerField(layer: JsonObject, key: string): string | undefined {
  const value = layer[key];
  if (key === "isSelected") return undefined;
  if (key === "properties" && Array.isArray(value)) return encodeArray(value, "property");
  return encodeValue(value);
}

const FIELD_ENCODERS: Readonly<Record<Mode, FieldEncoder>> = { plain: plainField, property: propertyField, layer: layerField };

function encodeFields(record: JsonObject, encodeField: FieldEncoder): string {
  let text = "{";
  let first = true;
  for (const key of Object.keys(record).sort()) {
    const field = encodeField(record, key);
    if (field === undefined) continue;
    text += `${first ? "" : ","}${keyText(key)}${field}`;
    first = false;
  }
  return `${text}}`;
}

function encodeRecord(record: JsonObject, mode: Mode): string {
  return encodeFields(record, FIELD_ENCODERS[mode]);
}

/** One layer's canonical text: its own fields and its whole property tree. The selection flag is left out because selection is fingerprinted separately and must not change graph identity. */
export function encodeLayer(layer: JsonObject): string {
  return encodeRecord(layer, "layer");
}

/** The digests as a JSON list in the order given. */
export function digestList(digests: readonly string[]): string {
  return digests.length ? `["${digests.join('","')}"]` : "[]";
}

/** A composition's text with each layer standing for its digest, so a changed layer changes only its own hash and this one. `layers` is null when the composition holds no layer array. */
export function encodeCompositionShell(composition: JsonObject, layers: readonly string[] | null): string {
  return encodeFields(composition, (record, key) => {
    if (key === "currentTime") return undefined;
    return key === "layers" && layers ? digestList(layers) : encodeValue(record[key]);
  });
}
