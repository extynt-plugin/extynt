/** The edges every structured-output adapter shares: the prompt that states a schema in words and the check that a reply is JSON. */
import { decodeJson, jsonValue } from "@extynt/decode";
import { ProviderHttpError } from "./provider-http-error.js";
import type { JsonSchemaSpec } from "./types.js";

/** The system prompt with the schema stated in words, for an endpoint that takes no schema of its own. */
export function schemaInstruction(system: string, schema: JsonSchemaSpec): string {
  return `${system}\n\nReply with one JSON object and nothing else. It must match this JSON Schema (${schema.name}):\n${JSON.stringify(schema.schema)}`;
}

/** The reply text when it is JSON, or its outermost object when the model wrapped it in prose or a code fence; any other reply is a refusal of the contract. */
export function parseableJson(text: string, status: number): string {
  const trimmed = text.trim();
  if (decodeJson(trimmed, jsonValue).ok) return trimmed;
  const start = trimmed.indexOf("{");
  const sliced = start < 0 ? "" : trimmed.slice(start, trimmed.lastIndexOf("}") + 1);
  if (sliced && decodeJson(sliced, jsonValue).ok) return sliced;
  throw new ProviderHttpError(status, "The structured reply was not valid JSON.", trimmed.slice(0, 300));
}
