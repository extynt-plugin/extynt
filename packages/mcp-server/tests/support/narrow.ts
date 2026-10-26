/**
 * Narrowing helpers for decoded JSON values.
 *
 * Tool payloads, JSON-RPC lines and parsed JSON bodies enter the suite as JSON values;
 * these helpers turn them into objects and typed fields by checking, never by asserting
 * a domain shape onto unparsed data.
 */
import { asObject, objectAt, stringAt, numberAt, arrayAt, stringsIn } from "../../src/json.js";
import { decodeJson, isJsonArray, isJsonObject, jsonObject, jsonValue } from "@extynt/decode";
import type { JsonObject, JsonValue } from "@extynt/decode";

/** True for a JSON object. */
export function isRecord(value: JsonValue | undefined): value is JsonObject {
  return isJsonObject(value);
}

/** The value as a JSON object; throws naming `what` otherwise. */
export function recordOf(value: JsonValue | undefined, what: string): JsonObject {
  const object = asObject(value);
  if (object === undefined) throw new TypeError(`${what}: expected an object`);
  return object;
}

/** The value as a list of JSON objects; throws naming `what` when it is not an array of objects. */
export function rowsOf(value: JsonValue | undefined, what: string): JsonObject[] {
  if (!isJsonArray(value)) throw new TypeError(`${what}: expected an array`);
  return value.map((entry, index) => recordOf(entry, `${what}[${String(index)}]`));
}

/** The string at `key`; throws naming `what` when it is not a string. */
export function stringField(record: JsonObject, key: string, what: string): string {
  const value = stringAt(record, key);
  if (value === undefined) throw new TypeError(`${what}: ${key} is not a string`);
  return value;
}

/** The number at `key`; throws naming `what` when it is not a number. */
export function numberField(record: JsonObject, key: string, what: string): number {
  const value = numberAt(record, key);
  if (value === undefined) throw new TypeError(`${what}: ${key} is not a number`);
  return value;
}

/** The string array at `key`; throws naming `what` when it is not an array of strings. */
export function stringsField(record: JsonObject, key: string, what: string): string[] {
  const value = arrayAt(record, key);
  if (value === undefined || value.some((entry) => typeof entry !== "string")) throw new TypeError(`${what}: ${key} is not a string array`);
  return [...stringsIn(value)];
}

/** Parses JSON text; text that is not JSON gives `undefined`. */
export function parsedJson(text: string): JsonValue | undefined {
  const parsed = decodeJson(text, jsonValue);
  return parsed.ok ? parsed.value : undefined;
}

/** Parses JSON text into an object; anything else gives `undefined`. */
export function parsedJsonObject(text: string): JsonObject | undefined {
  const parsed = decodeJson(text, jsonObject);
  return parsed.ok ? parsed.value : undefined;
}

/** Parses JSON text for test input; throws naming `what` when the text is not JSON. */
export function readJson(text: string, what: string): JsonValue {
  const parsed = parsedJson(text);
  if (parsed === undefined) throw new SyntaxError(`${what}: not JSON`);
  return parsed;
}

/** The `data` field of a tool result, checked as an object. */
export function payloadOf(result: JsonValue | undefined): JsonObject {
  return recordOf(objectAt(recordOf(result, "tool result"), "data"), "tool result data");
}

/** The `data` field a refusal carries even though `callTool`'s failure branch does not type it. */
export function refusalData(result: JsonValue | undefined): JsonObject {
  return recordOf(objectAt(recordOf(result, "refusal"), "data"), "refusal data");
}
