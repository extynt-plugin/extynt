/**
 * The fixture's typed refusals and the readers every operation shares: wire values in, bounded numbers, text, vectors and
 * JSON out, each failing with a named refusal instead of reaching the project.
 */

import { isWireArray, isWireObject } from "@extynt/fake-plugin";
import type { PropertySnapshot } from "@extynt/project-graph";
import type { JsonValue } from "@extynt/decode";
import { CANONICAL_PREFIX, PLAN_TYPES, UNSUPPORTED_IN_FIXTURE, type SpecKind } from "./fake-host-tables.js";
import type { WireObject, WireValue } from "./wire-types.js";

/** A member a plan operation may or may not carry. */
export type Field = WireValue | undefined;

/** A JSON object as the snapshot model stores it. */
export type JsonObject = { [key: string]: JsonValue };

/** A refusal the fixture reports by code instead of applying the operation. */
export class FixtureRefusal extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = "FixtureRefusal"; this.code = code; }
}

/** Refuses the operation with a coded message. */
export function refuse(code: string, message: string): never { throw new FixtureRefusal(code, message); }

/** Refuses an operation type the fixture does not model, saying whether the plan vocabulary knows it. */
export function unsupportedType(type: string): never {
  const known = PLAN_TYPES.has(type);
  refuse(UNSUPPORTED_IN_FIXTURE, known
    ? `Operation type "${type}" is not modelled by the fixture harness: it applies typed plan operations to a ProjectSnapshot with no After Effects, so it refuses rather than reporting an effect it did not produce.`
    : `Operation type "${type}" is not one of the typed plan operations, and the fixture harness does not model it. It applies the 55-type plan vocabulary to a ProjectSnapshot and refuses anything else.`);
}

/** The value, or a thrown invariant failure naming `what`. */
export function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`The fixture lost ${what}.`);
  return value;
}

/** Whether the value is a number that is neither NaN nor infinite. */
export function isFiniteNumber(value: Field): value is number { return typeof value === "number" && Number.isFinite(value); }

/** Whether the value is a JSON object rather than an array or a scalar. */
export function isJsonObject(value: JsonValue | undefined): value is JsonObject { return typeof value === "object" && value !== null && !Array.isArray(value); }

function toJsonArray(items: ReadonlyArray<WireValue>): JsonValue[] | undefined {
  const out: JsonValue[] = [];
  for (const item of items) {
    const json = toJson(item);
    if (json === undefined) return undefined;
    out.push(json);
  }
  return out;
}

function toJsonObject(object: WireObject): JsonObject | undefined {
  const out: JsonObject = {};
  for (const [key, member] of Object.entries(object)) {
    const json = toJson(member);
    if (json === undefined) return undefined;
    out[key] = json;
  }
  return out;
}

/** The value as JSON, or `undefined` when it holds anything JSON cannot (an absent member, a NaN, an infinity). */
export function toJson(value: Field): JsonValue | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  return isWireArray(value) ? toJsonArray(value) : toJsonObject(value);
}

/** The value as JSON, or an INVALID_VALUE refusal naming `field`. */
export function jsonOf(value: Field, field = "value"): JsonValue {
  const json = toJson(value);
  if (json === undefined) refuse("INVALID_VALUE", `${field} must be JSON-compatible.`);
  return json;
}

/** A `__new__:` placeholder, or an INVALID_OPERATION refusal with the given message. */
export function placeholderOf(value: Field, message: string): string {
  if (typeof value !== "string" || !value.startsWith(CANONICAL_PREFIX)) refuse("INVALID_OPERATION", message);
  return value;
}

/** The table's entry for `key`, ignoring anything an object inherits. */
export function own<T>(table: Readonly<Record<string, T>>, key: string): T | undefined { return Object.hasOwn(table, key) ? table[key] : undefined; }

/** An object, nothing when the member is absent, or an INVALID_VALUE refusal with `message`. */
export function optionalObject(value: Field, message: string): WireObject | undefined {
  if (value !== undefined && !isWireObject(value)) refuse("INVALID_VALUE", message);
  return value;
}

/** A number within the bounds, or nothing when the member is absent. */
export function optionalBounded(value: Field, field: string, bounds: { min: number; max: number }): number | undefined {
  return value === undefined ? undefined : boundedNumber(value, field, bounds);
}

/** A string of `min` to `max` characters. */
export function textOf(value: Field, field: string, bounds: { min: number; max: number }): string {
  if (typeof value !== "string" || value.length < bounds.min || value.length > bounds.max) refuse("INVALID_VALUE", `${field} must be a string of ${bounds.min}-${bounds.max} characters.`);
  return value;
}

/** A finite number from `min` to `max`. */
export function boundedNumber(value: Field, field: string, bounds: { min: number; max: number }): number {
  if (!isFiniteNumber(value) || value < bounds.min || value > bounds.max) refuse("INVALID_VALUE", `${field} must be a number from ${bounds.min} to ${bounds.max}.`);
  return value;
}

/** An array of finite numbers whose length is one of `lengths`. */
export function numericVector(value: Field, field: string, lengths: readonly number[]): number[] {
  if (!isWireArray(value) || !lengths.includes(value.length) || !value.every(isFiniteNumber)) refuse("INVALID_VALUE", `${field} must be an array of ${lengths.join(" or ")} finite numbers.`);
  return [...value];
}

/** Exactly two finite numbers. */
export function tuple2(value: Field, field: string): [number, number] {
  const [x, y] = isWireArray(value) && value.length === 2 ? value : [];
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) refuse("INVALID_VALUE", `${field} must be an array of 2 finite numbers.`);
  return [x, y];
}

/** Exactly three finite numbers. */
export function tuple3(value: Field, field: string): [number, number, number] {
  const [x, y, z] = isWireArray(value) && value.length === 3 ? value : [];
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) refuse("INVALID_VALUE", `${field} must be an array of 3 finite numbers.`);
  return [x, y, z];
}

/** The operation's `target` object, empty when it has none. */
export function targetOf(operation: WireObject): WireObject {
  const target = operation.target;
  return isWireObject(target) ? target : {};
}

/**
 * The typed plan puts propertyPath on the operation for set_layer_property and on the target for animate_property/set_expression; the fixture
 * accepts either spelling.
 */
export function propertyPathOf(operation: WireObject): string | undefined {
  const own = operation.propertyPath;
  if (typeof own === "string" && own.length > 0) return own;
  const target = targetOf(operation).propertyPath;
  return typeof target === "string" && target.length > 0 ? target : undefined;
}

/** A path segment with the separators escaped. */
export function escapeSegment(matchName: string): string { return matchName.replace(/%/g, "%25").replace(/\//g, "%2F").replace(/#/g, "%23"); }

function vectorError(value: Field, lengths: readonly number[]): string | undefined {
  return isWireArray(value) && lengths.includes(value.length) && value.every(isFiniteNumber) ? undefined : `must be an array of ${lengths.join(" or ")} finite numbers`;
}

function colorError(value: Field): string | undefined {
  return isWireArray(value) && value.length === 3 && value.every((channel) => isFiniteNumber(channel) && channel >= 0 && channel <= 1) ? undefined : "must be an RGB array of three 0-1 numbers";
}

const SPEC_CHECKS: Readonly<Record<SpecKind, (value: Field) => string | undefined>> = {
  boolean: (value) => (typeof value === "boolean" ? undefined : "must be boolean"),
  menu: (value) => (typeof value === "number" && Number.isInteger(value) && value >= 1 ? undefined : "must be a menu item number (1-based)"),
  number: (value) => (isFiniteNumber(value) ? undefined : "must be a finite number"),
  color: colorError,
  vec2: (value) => vectorError(value, [2]),
  vec23: (value) => vectorError(value, [2, 3]),
};

/** Why `value` does not suit a setting of `kind`, or nothing when it does. */
export function specValueError(kind: SpecKind, value: Field): string | undefined { return SPEC_CHECKS[kind](value); }

const VALUE_TYPES: Readonly<Record<SpecKind, PropertySnapshot["valueType"]>> = { number: "number", vec2: "vector", vec23: "vector", color: "color", boolean: "boolean", menu: "number" };

/** The snapshot value type a setting of `kind` reads as. */
export function valueTypeOf(kind: SpecKind): PropertySnapshot["valueType"] { return VALUE_TYPES[kind]; }

/** The first two numbers of a vector as a pair. */
export function pairOf(values: readonly number[]): [number, number] { return [required(values[0], "the first vector element"), required(values[1], "the second vector element")]; }
