/**
 * Checked reads of the JSON these tests and the harness receive: every member is verified as it is taken, so a wrong shape
 * throws naming the field instead of reaching an assertion as `undefined`.
 */
import { isWireArray, isWireObject } from "@extynt/fake-plugin";
import type { WireObject, WireValue } from "./wire-types.js";

type Found = WireValue | undefined;

function describe(value: Found): string {
  if (value === undefined) return "nothing";
  if (value === null) return "null";
  return isWireArray(value) ? `an array of ${value.length}` : `a ${typeof value}`;
}

/** The value as an object, or a throw that names `what`. */
export function jsonObject(value: Found, what: string): WireObject {
  if (!isWireObject(value)) throw new Error(`${what}: expected an object, got ${describe(value)}`);
  return value;
}

/** The value as an array, or a throw that names `what`. */
export function jsonArray(value: Found, what: string): ReadonlyArray<WireValue> {
  if (!isWireArray(value)) throw new Error(`${what}: expected an array, got ${describe(value)}`);
  return value;
}

/** The value as an array of objects, or a throw that names the offending row. */
export function jsonRows(value: Found, what: string): WireObject[] {
  return jsonArray(value, what).map((row, index) => jsonObject(row, `${what}[${index}]`));
}

/** The value as a string, or a throw that names `what`. */
export function jsonString(value: Found, what: string): string {
  if (typeof value !== "string") throw new Error(`${what}: expected a string, got ${describe(value)}`);
  return value;
}

/** The value as a number, or a throw that names `what`. */
export function jsonNumber(value: Found, what: string): number {
  if (typeof value !== "number") throw new Error(`${what}: expected a number, got ${describe(value)}`);
  return value;
}

/** A checked string, or `undefined` where the producer left the field out. */
export function jsonOptionalString(value: Found): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** One member by name, read without a presence check. */
export function memberOf(value: Found, key: string): Found {
  return isWireObject(value) ? value[key] : undefined;
}

/** A string member of an object, or `undefined` when it is absent or of another type. */
export function stringMember(object: WireObject, key: string): string | undefined {
  const member = object[key];
  return typeof member === "string" ? member : undefined;
}

/** A number member of an object, or `undefined` when it is absent or of another type. */
export function numberMember(object: WireObject, key: string): number | undefined {
  const member = object[key];
  return typeof member === "number" ? member : undefined;
}

/** The items of an array value, or an empty list where the value is absent or of another type. */
export function listOf(value: Found): ReadonlyArray<WireValue> {
  return isWireArray(value) ? value : [];
}

/** The named members that are present, as a new object. */
export function pick(object: WireObject, keys: readonly string[]): WireObject {
  return Object.fromEntries(
    keys.flatMap((key): Array<[string, WireValue]> => {
      const member = object[key];
      return member === undefined ? [] : [[key, member]];
    }),
  );
}
