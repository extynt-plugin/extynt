// Decoder helpers every decoder in this package shares: mutable lists, JSON values, and members or rows that read as absent when they are the wrong type.
import { array, boolean, lazy, map, nullValue, number, optional, record, string, union } from "@extynt/decode";
import type { Decoder, JsonObject, JsonValue, OptionalDecoder } from "@extynt/decode";

const absent: Decoder<undefined> = { run: () => undefined };

/** An array member as a mutable array, the shape callers that build on a decoded value expect. */
export function list<T>(decoder: Decoder<T>): Decoder<T[]> {
  return map(array(decoder), (items) => [...items]);
}

/** An optional member that reads as undefined when it is present but not what the decoder accepts. */
export function softly<T>(decoder: Decoder<T>): OptionalDecoder<T | undefined> {
  return optional(union(decoder, absent));
}

/** An item that reads as undefined when it is not what the decoder accepts, so a list can skip it. */
export function skippable<T>(decoder: Decoder<T>): Decoder<T | undefined> {
  return union(decoder, absent);
}

const jsonObject: Decoder<JsonObject> = lazy(() => record(string(), jsonValue));

/** Accepts any JSON value, copying arrays so the result is mutable. */
export const jsonValue: Decoder<JsonValue> = lazy(() => union(nullValue, boolean(), number(), string(), list(jsonValue), jsonObject));

/** Whether a decoded list item survived `skippable`. */
export function isKept<T>(item: T | undefined): item is T {
  return item !== undefined;
}

function keptRows<T>(rows: Readonly<Record<string, T | undefined>>): Record<string, T> {
  return Object.fromEntries(Object.entries(rows).flatMap(([name, row]) => (row === undefined ? [] : [[name, row] as const])));
}

/** A table of rows by name that drops the rows the decoder cannot read; anything but an object is rejected. */
export function rowsOf<T>(decoder: Decoder<T>): Decoder<Record<string, T>> {
  return map(record(string(), skippable(decoder)), keptRows);
}

const noRows: Decoder<Record<string, never>> = { run: () => ({}) };

/** Like `rowsOf`, but anything that is not an object reads as an empty table. */
export function rowsOrNone<T>(decoder: Decoder<T>): Decoder<Record<string, T>> {
  return union(rowsOf(decoder), noRows);
}
