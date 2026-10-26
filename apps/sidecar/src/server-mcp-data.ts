// Reading and extending the data a tool answers with: the mcp-server package owns its shape, so the sidecar names only the fields it reads and adds.
import { decode, fallback, isJsonObject, map, object, string } from "@extynt/decode";

import type { McpSuccess, ToolData, ToolFields } from "./server-mcp-result.js";

/** Tool data that is an object, with the fields the sidecar adds or removes. */
export type DataFields = ToolFields;

const planOnly = object({ planId: map(fallback(string(), undefined), (given) => given ?? "") });
const captureOnly = object({ captureId: string() });

/** True for tool data that is an object. */
export function isDataFields(data: ToolData | undefined): data is DataFields {
  return data !== undefined && isJsonObject(data);
}

/** True for tool data that is a list. */
export function isDataRows(data: ToolData): data is readonly ToolData[] {
  return Array.isArray(data);
}

/** Adds the fields to a result whose data is an object; any other data is left as it is. */
export function addFields(result: McpSuccess, fields: DataFields): void {
  if (isDataFields(result.data)) Object.assign(result.data, fields);
}

/** The plan a result's data names, or an empty string when it names none. */
export function planIdOf(data: ToolData): string {
  const named = decode(planOnly, data);
  return named.ok ? named.value.planId : "";
}

/** The capture a result's data names, if it names one. */
export function captureIdOf(data: ToolData): string | undefined {
  const named = decode(captureOnly, data);
  return named.ok ? named.value.captureId : undefined;
}
