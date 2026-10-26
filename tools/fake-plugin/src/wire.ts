// Open JSON as the fake plugin carries it: fixture rows, host-call arguments and replies are JSON by contract, so their members are not named.
import { DecodeFailure, array, boolean, decodeJson, lazy, nullValue, number, record, string, union } from "@extynt/decode";
import type { DecodeResult, Decoder } from "@extynt/decode";

/** Any value JSON carries. */
export type WireValue = string | number | boolean | null | ReadonlyArray<WireValue> | WireObject;

/** A JSON object whose members are open: the contract of a fixture row or of a host call's arguments. */
export type WireObject = { readonly [member: string]: WireValue };

/** Decodes any JSON value. */
export const wireValue: Decoder<WireValue> = union(
  string(),
  number(),
  boolean(),
  nullValue,
  array(lazy(() => wireValue)),
  record(
    string(),
    lazy(() => wireValue),
  ),
);

/** Decodes a JSON object with open members. */
export const wireObject: Decoder<WireObject> = record(string(), wireValue);

/** Whether a wire value is a JSON object rather than an array or a scalar. */
export function isWireObject(value: WireValue | undefined): value is WireObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether a wire value is a JSON array. */
export function isWireArray(value: WireValue | undefined): value is ReadonlyArray<WireValue> {
  return Array.isArray(value);
}

/** The wire value a typed document serialises to, as `JSON.stringify` writes it: undefined members are left out and NaN becomes null. */
export function wireOfDocument<Document>(document: Document): DecodeResult<WireValue> {
  return decodeJson(JSON.stringify(document), wireValue);
}

/** The wire object a typed document serialises to, as `JSON.stringify` writes it. */
export function wireObjectOfDocument<Document>(document: Document): DecodeResult<WireObject> {
  return decodeJson(JSON.stringify(document), wireObject);
}

/** The value a decode result holds, or the `DecodeFailure` that says why it holds none. */
export function decodedValue<T>(result: DecodeResult<T>): T {
  if (!result.ok) throw new DecodeFailure(result.error);
  return result.value;
}

/** The wire value a typed value serialises to, as `decodedValue(wireOfDocument(value))`. */
export function toWire<T>(value: T): WireValue {
  return decodedValue(wireOfDocument(value));
}
