/**
 * JSON value types and lenient decoders shared by every module that reads a host or report document.
 */
import { DecodeFailure, array, boolean, decodeJson, lazy, map, nullValue, number, optional, record, string, union } from "@extynt/decode";
import type { DecodeResult, Decoder, OptionalDecoder } from "@extynt/decode";
import type { JsonValue } from "@extynt/decode";

export type { JsonValue };

/** A JSON object whose members are JSON values. */
export interface JsonObject { [key: string]: JsonValue }

const DISCARD: Decoder<undefined> = { run: () => undefined };

/** An array decoder whose output the caller may own and mutate. */
export function list<T>(item: Decoder<T>): Decoder<T[]> {
  return map(array(item), (items) => [...items]);
}

/** Decodes with `decoder`, and yields `make()` for anything the decoder rejects. */
export function fallback<T>(decoder: Decoder<T>, make: () => T): Decoder<T> {
  return union(decoder, map(DISCARD, make));
}

/** An object field that is kept when `decoder` accepts it and left as `undefined` otherwise. */
export function lenient<T>(decoder: Decoder<T>): OptionalDecoder<T | undefined> {
  return optional(union(decoder, DISCARD));
}

/** Any JSON value. */
export const jsonValue: Decoder<JsonValue> = lazy(() => union(
  nullValue,
  boolean(),
  number(),
  string(),
  list(jsonValue),
  record(string(), jsonValue),
));

/** A JSON object. */
export const jsonObject: Decoder<JsonObject> = record(string(), jsonValue);

/** Whether a JSON value is an object rather than a scalar or an array. */
export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The JSON object a typed document serialises to, as `JSON.stringify` writes it: undefined members are left out and NaN becomes null. */
export function jsonObjectOfDocument<Document>(document: Document): DecodeResult<JsonObject> {
  return decodeJson(JSON.stringify(document), jsonObject);
}

/** The value a decode result holds, or the `DecodeFailure` that says why it holds none. */
export function decodedValue<T>(result: DecodeResult<T>): T {
  if (!result.ok) throw new DecodeFailure(result.error);
  return result.value;
}
