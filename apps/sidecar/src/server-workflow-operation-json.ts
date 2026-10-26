/** Reading the JSON of plan operations and tool results without casts: objects, text, lists, every string inside a value, and ids swapped into one. */
import { decode, isJsonArray, isJsonObject, type JsonObject, jsonObject, jsonValue, type JsonValue } from "@extynt/decode";
import type { callTool } from "@extynt/mcp-server";
import type { ToolArguments } from "./agent-types.js";

/** What running a workflow tool answers. */
export type ToolResult = ReturnType<typeof callTool>;

type ToolSuccess = Extract<ToolResult, { ok: true }>;

/** Runs a workflow tool of the owner's dispatcher. */
export type Run = (name: string, args: ToolArguments) => Promise<ToolResult>;

/** A failed tool result with the code and message. */
export function refusal(code: string, message: string): Extract<ToolResult, { ok: false }> {
  return { ok: false, error: { code, message } };
}

/** The prefix of a name a plan gives a layer or composition it creates, before After Effects assigns the real id. */
export const PLACEHOLDER_PREFIX = "__new__:";

/** The value as an object, or undefined. */
export function objectOf(value: JsonValue | undefined): JsonObject | undefined {
  return isJsonObject(value) ? value : undefined;
}

/** The value as text, or undefined. */
export function textOf(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** The value as a list, or an empty one. */
export function listOf(value: JsonValue | undefined): readonly JsonValue[] {
  return isJsonArray(value) ? value : [];
}

/** The objects in a list value, in order. */
export function objectsOf(value: JsonValue | undefined): JsonObject[] {
  const found: JsonObject[] = [];
  for (const entry of listOf(value)) {
    const object = objectOf(entry);
    if (object) found.push(object);
  }
  return found;
}

/** The texts in a list value, in order. */
export function namesOf(value: JsonValue | undefined): string[] {
  return listOf(value).flatMap((entry) => (typeof entry === "string" ? [entry] : []));
}

/** The layer id an operation targets, or undefined. */
export function targetLayerId(operation: JsonObject): string | undefined {
  return textOf(objectOf(operation.target)?.layerId);
}

/** Every string anywhere inside the value, in order. */
export function stringsIn(value: JsonValue): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  return typeof value === "object" && value !== null ? Object.values(value).flatMap(stringsIn) : [];
}

/** The value with every string that is a key of `ids` replaced by its id. */
export function withIds(value: JsonObject, ids: ReadonlyMap<string, string>): JsonObject;
export function withIds(value: JsonValue, ids: ReadonlyMap<string, string>): JsonValue;
export function withIds(value: JsonValue, ids: ReadonlyMap<string, string>): JsonValue {
  if (typeof value === "string") return ids.get(value) ?? value;
  if (isJsonArray(value)) return value.map((entry) => withIds(entry, ids));
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, withIds(entry, ids)]));
}

/** The arguments' value under `key` as JSON, or undefined when it is absent or not JSON. */
export function argumentJson(args: ToolArguments, key: string): JsonValue | undefined {
  const decoded = decode(jsonValue, args[key]);
  return decoded.ok ? decoded.value : undefined;
}

/** The object a successful result carries, or undefined. */
export function payload(result: ToolResult): JsonObject | undefined {
  const decoded = result.ok ? decode(jsonObject, result.data) : undefined;
  return decoded?.ok ? decoded.value : undefined;
}

/** The result's object payload; any other payload is wrapped as `{ result }`. */
export function payloadOrWrapped(result: ToolSuccess): JsonObject {
  const decoded = decode(jsonValue, result.data);
  return payload(result) ?? { result: decoded.ok ? decoded.value : null };
}

/** True when an ae_queue_add or ae_queue_fix result staged its operations: it is ok and does not name operations to fix while accepting none. */
export function queueStaged(result: ToolResult): boolean {
  if (!result.ok) return false;
  const data = payload(result);
  return !(data !== undefined && listOf(data.fix).length > 0 && data.accepted === 0);
}
