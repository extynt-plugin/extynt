// Readers for host replies already decoded as JSON: the text, number, list and object a field holds, and the decoders that accept any object or list of objects as rows.
import { accepts, fail, jsonObject, isJsonArray, isJsonObject, isFiniteNumber, map, refine } from "@extynt/decode";
import type { AnyDecoder, Decoder, JsonObject, JsonValue } from "@extynt/decode";

const anything: AnyDecoder = { run: (input) => input };

const list = refine(anything, (input): input is ReadonlyArray<JsonValue> => Array.isArray(input), "an array");

/** The text a field of a JSON object holds, or undefined when it is missing or not text. */
export function textField(row: JsonObject, key: string): string | undefined {
  const field = row[key];
  return typeof field === "string" ? field : undefined;
}

/** The number a field of a JSON object holds, or undefined when it is missing or not a number. */
export function numberField(row: JsonObject, key: string): number | undefined {
  const field = row[key];
  return typeof field === "number" ? field : undefined;
}

/** The items of a JSON array, or undefined when the value is not one. */
export function listOf(value: JsonValue | undefined): ReadonlyArray<JsonValue> | undefined {
  return isJsonArray(value) ? value : undefined;
}

/** The fields of a JSON object, or undefined when the value is not one. */
export function objectOf(value: JsonValue | undefined): JsonObject | undefined {
  return isJsonObject(value) ? value : undefined;
}

/** The finite number a JSON value holds, or undefined. */
export function numberOf(value: JsonValue | undefined): number | undefined {
  return isFiniteNumber(value) ? value : undefined;
}

const carriesRow = accepts(jsonObject);
/** Accepts any JSON object as a row and returns that same object; what each field holds is checked by whoever reads it. */
export const rowDecoder: Decoder<JsonObject> = { run: (input) => (carriesRow(input) ? input : fail("object", input)) };

/** Accepts a list of rows, dropping every entry that is not an object. */
export const rowList: Decoder<ReadonlyArray<JsonObject>> = map(list, (items) => items.flatMap((item) => (isJsonObject(item) ? [item] : [])));
