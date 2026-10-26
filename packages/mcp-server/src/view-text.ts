// Text and shape helpers shared by the agent-facing views.
import { isJsonArray, isJsonObject } from "@extynt/decode";
import type { JsonValue } from "@extynt/decode";

/** The text cut to `max` characters, ending in an ellipsis when it was cut. */
export function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** A value as one short line of text for an operation or control summary. */
export function short(value: JsonValue | undefined): string {
  return clip(typeof value === "string" ? value : value === undefined ? "null" : JSON.stringify(value), 48);
}

/** The last `segments` slash-separated parts of a property path. */
export function tail(path: string, segments: number): string {
  return path.split("/").slice(-segments).join("/");
}

/** True for null, an absent value, an empty array and an empty object. */
export function isEmpty(value: JsonValue | undefined): boolean {
  if (value === null || value === undefined) return true;
  if (isJsonArray(value)) return value.length === 0;
  return isJsonObject(value) && Object.keys(value).length === 0;
}

/** The value without the sidecar's response-budget field when it is an object. */
export function withoutBudget(data: JsonValue | undefined): JsonValue | undefined {
  if (!isJsonObject(data)) return data;
  return Object.fromEntries(Object.entries(data).filter(([key]) => key !== "responseBudgetBytes"));
}

const SECRET_KEYS = new Set(["token", "approvalId", "approvalToken"]);

/** The value with every token, approval id and approval token string replaced by a marker. */
export function redactTokens(value: JsonValue): JsonValue {
  if (isJsonArray(value)) return value.map(redactTokens);
  if (!isJsonObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, SECRET_KEYS.has(key) && typeof child === "string" ? "[redacted]" : redactTokens(child)]));
}
