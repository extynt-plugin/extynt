// Rewrites an operation into the vocabulary a plan already uses: every name a binding renames becomes its bound name.
import { DECLARES, declaredNames } from "./placeholders.js";
import { asObject, objectAt, stringAt } from "./json.js";
import { isJsonArray } from "@extynt/decode";
import type { JsonObject, JsonValue } from "@extynt/decode";

type Bindings = Readonly<Record<string, string>>;

function boundName(bindings: Bindings, name: string): string | undefined {
  return Object.hasOwn(bindings, name) ? bindings[name] : undefined;
}

function renamed(value: JsonValue, bindings: Bindings): JsonValue {
  if (typeof value === "string") return boundName(bindings, value) ?? value;
  if (isJsonArray(value)) return value.map((item) => renamed(item, bindings));
  const object = asObject(value);
  return object ? Object.fromEntries(Object.entries(object).map(([key, entry]) => [key, renamed(entry, bindings)])) : value;
}

function reboundField(object: JsonObject, key: string, declared: ReadonlySet<string>, bindings: Bindings): JsonObject {
  const value = stringAt(object, key);
  const bound = value === undefined ? undefined : boundName(bindings, value);
  return value !== undefined && bound && declared.has(value) ? { ...object, [key]: bound } : object;
}

function reboundPath(object: JsonObject, path: string, declared: ReadonlySet<string>, bindings: Bindings): JsonObject {
  const [head = "", tail] = path.split(".");
  if (tail === undefined) return reboundField(object, head, declared, bindings);
  const container = objectAt(object, head);
  return container ? { ...object, [head]: reboundField(container, tail, declared, bindings) } : object;
}

/** The operation with every bound name replaced, including the names it declares itself. */
export function rebindPlaceholders(operation: JsonObject, bindings: Bindings): JsonObject {
  const declared = new Set(declaredNames(operation));
  const rebound = asObject(renamed(operation, bindings)) ?? {};
  return (DECLARES[stringAt(rebound, "type") ?? ""] ?? []).reduce((object, path) => reboundPath(object, path, declared, bindings), rebound);
}
