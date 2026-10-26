/**
 * Typed views over the loose data the fake host receives: parsed plan JSON and the
 * values the probe sends across the ExtendScript boundary.
 */
import { isJsonArray } from "@extynt/decode";
import { isJsonObject } from "@extynt/decode";
import type { JsonArray } from "@extynt/decode";
import { jsonValue, type JsonObject, type JsonValue } from "../../src/json.js";

/** A parsed JSON value. */
export type Json = JsonValue;

export { jsonValue };
export type { JsonObject };

/** A value the probe hands to a fake: JSON, nothing, a function or an object of the same. */
export type ProbeValue = Json | undefined | ProbeFunction | ProbeObject;

/** An object the probe hands to a fake. */
export interface ProbeObject { readonly [key: string]: ProbeValue }

/** A function the probe hands to a fake. */
export type ProbeFunction = (...args: ProbeValue[]) => ProbeValue;

const EMPTY_JSON_OBJECT: JsonObject = {};
const EMPTY_PROBE_OBJECT: ProbeObject = {};
const NULLISH_RECEIVER_MESSAGE = "Cannot convert undefined or null to object";

/** The value as a JSON object, or an empty one when it is anything else. */
export const jsonObjectOf = (value: Json | undefined): JsonObject => (isJsonObject(value) ? value : EMPTY_JSON_OBJECT);

/** Whether a probe value is a JSON list. */
export const isProbeArray = (value: ProbeValue): value is JsonArray => Array.isArray(value);

/** The value as a probe object, or an empty one when it is anything else. */
export const probeObjectOf = (value: ProbeValue): ProbeObject => (value !== null && typeof value === "object" && !isProbeArray(value) ? value : EMPTY_PROBE_OBJECT);

/** The value as a JSON list, or an empty one when it is anything else. */
export const jsonListOf = (value: Json | undefined): Json[] => (isJsonArray(value) ? [...value] : []);

/** The value as a list of JSON objects, with entries that are not objects read as empty ones. */
export const rowsOf = (value: Json | undefined): JsonObject[] => jsonListOf(value).map(jsonObjectOf);

/** The text of a string, an empty string for nothing, and the host's string conversion for the rest. */
export const textOf = (value: Json | undefined): string => (typeof value === "string" ? value : value === undefined || value === null ? "" : String(value));

/** The value when it is a finite number, otherwise null. */
export const numberOf = (value: ProbeValue): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** The value when it is a finite number, otherwise the fallback. */
export const numberOr = (value: ProbeValue, fallback: number): number => numberOf(value) ?? fallback;

/** The number a host enum value stands for, read through its `valueOf`; null when it carries no finite number. */
export const enumNumber = (value: ProbeValue): number | null => {
  if (typeof value === "number") return numberOf(value);
  if (value === null || value === undefined) throw new TypeError(NULLISH_RECEIVER_MESSAGE);
  const primitive = value.valueOf();
  return typeof primitive === "number" ? numberOf(primitive) : null;
};
