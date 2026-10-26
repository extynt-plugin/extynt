/** JSON read off a response is a JsonValue until an accessor here narrows it. `fieldOf` reads a dotted path and returns undefined when a link is missing, so a case that asserts absence reads the same as before; the typed readers throw when a field the test requires is missing or is not the type it claims. */
import { isJsonArray, isJsonObject, wireJson, decodeOrThrow } from "@extynt/decode";
import { jsonOf } from "@extynt/mcp-server";
import type { JsonArray, JsonObject, JsonValue } from "@extynt/decode";

export type { JsonArray, JsonObject, JsonValue };

/** A JSON value or nothing: what a path into a response may lead to. */
export type Found = JsonValue | undefined;

export async function readJson(response: { json: () => Promise<JsonValue> }): Promise<JsonValue> {
  return await response.json();
}

export function parseJson(text: string): JsonValue {
  return decodeOrThrow(wireJson, JSON.parse(text));
}

function wireOf<T>(value: T): Found {
  return value === undefined ? undefined : jsonOf(value);
}

export function fieldOf<T>(value: T, path: string): Found {
  let current: Found = wireOf(value);
  if (path === "") return current;
  for (const segment of path.split(".")) {
    if (isJsonArray(current) && /^\d+$/.test(segment)) { current = current[Number(segment)]; continue; }
    if (!isJsonObject(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function present<T>(value: T, path: string): JsonValue {
  const found = fieldOf(value, path);
  if (found === undefined) throw new Error(`no value at ${path}`);
  return found;
}

function typed<V, T extends JsonValue>(value: V, path: string, kind: string, test: (candidate: JsonValue) => candidate is T): T {
  const found = present(value, path);
  if (!test(found)) throw new Error(`expected ${kind} at ${path}`);
  return found;
}

const isString = (value: JsonValue): value is string => typeof value === "string";

export function textOf<T>(value: T, path: string): string { return typed(value, path, "a string", isString); }
export function numberOf<T>(value: T, path: string): number { return typed(value, path, "a number", (v): v is number => typeof v === "number"); }
export function flagOf<T>(value: T, path: string): boolean { return typed(value, path, "a boolean", (v): v is boolean => typeof v === "boolean"); }
export function listOf<T>(value: T, path: string): JsonArray { return typed(value, path, "a list", isJsonArray); }
export function recordOf<T>(value: T, path: string): JsonObject { return typed(value, path, "an object", isJsonObject); }

export function maybeTextOf<T>(value: T, path: string): string | undefined { return fieldOf(value, path) === undefined ? undefined : textOf(value, path); }
export function maybeNumberOf<T>(value: T, path: string): number | undefined { return fieldOf(value, path) === undefined ? undefined : numberOf(value, path); }
export function maybeFlagOf<T>(value: T, path: string): boolean | undefined { return fieldOf(value, path) === undefined ? undefined : flagOf(value, path); }
export function maybeListOf<T>(value: T, path: string): JsonArray | undefined { return fieldOf(value, path) === undefined ? undefined : listOf(value, path); }
export function maybeRecordOf<T>(value: T, path: string): JsonObject | undefined { return fieldOf(value, path) === undefined ? undefined : recordOf(value, path); }

export function recordsOf<T>(value: T, path: string): JsonObject[] { return listOf(value, path).map((entry) => recordOf(entry, "")); }
export function textsOf<T>(value: T, path: string): string[] { return listOf(value, path).map((entry) => textOf(entry, "")); }

export function errorCodeOf<T>(value: T): string | undefined { return maybeTextOf(value, "error.code"); }
export function errorMessageOf<T>(value: T): string | undefined { return maybeTextOf(value, "error.message"); }
export function planIdsOf<T>(value: T): string[] { return listOf(value, "plans").map((plan) => textOf(plan, "planId")); }
