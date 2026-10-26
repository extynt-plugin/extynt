// A conservative check of a tool call's arguments against the JSON schema the tool declares, so a malformed call is refused before it runs.
import { array, decode, type Decoder, fallback, isJsonObject, type JsonObject, jsonObject, jsonValue, type JsonValue, lazy, map, object, record, string } from "@extynt/decode";
import type { AgentToolCall, AgentToolSpec } from "@extynt/llm";


interface SchemaNode {
  readonly type: string | undefined;
  readonly allowed: readonly JsonValue[] | undefined;
  readonly required: readonly string[];
  readonly properties: ReadonlyMap<string, SchemaNode>;
  readonly items: SchemaNode | undefined;
}

function present<Entry>(entries: readonly (Entry | undefined)[]): Entry[] {
  return entries.filter((entry): entry is Entry => entry !== undefined);
}

function namedChildren(properties: Readonly<Record<string, SchemaNode | undefined>> | undefined): ReadonlyMap<string, SchemaNode> {
  const named = Object.entries(properties ?? {}).flatMap(([key, child]) => (child ? [[key, child] as const] : []));
  return new Map(named);
}

const schemaNode: Decoder<SchemaNode> = lazy(() =>
  map(
    object({
      type: fallback(string(), undefined),
      enum: fallback(array(jsonValue), undefined),
      required: fallback(array(fallback(string(), undefined)), undefined),
      properties: fallback(record(string(), fallback(schemaNode, undefined)), undefined),
      items: fallback(schemaNode, undefined),
    }),
    (node) => ({ type: node.type, allowed: node.enum, required: present(node.required ?? []), properties: namedChildren(node.properties), items: node.items }),
  ),
);

function typeMatches(type: string, given: JsonValue): boolean {
  if (type === "array") return Array.isArray(given);
  if (type === "object") return typeof given === "object" && given !== null && !Array.isArray(given);
  if (type === "integer") return Number.isInteger(given);
  if (type === "null") return given === null;
  return typeof given === type;
}

function scalarProblem(schema: SchemaNode, given: JsonValue, path: string): string | undefined {
  if (schema.type !== undefined && !typeMatches(schema.type, given)) return `${path} must be ${schema.type}`;
  if (schema.allowed && !schema.allowed.includes(given)) return `${path} must be one of ${schema.allowed.map((entry) => JSON.stringify(entry)).join(", ")}`;
  return undefined;
}

function objectProblems(schema: SchemaNode, given: JsonObject, path: string): string[] {
  const missing = schema.required.filter((key) => given[key] === undefined).map((key) => `${path}.${key} is required`);
  const nested = Object.entries(given).flatMap(([key, entry]) => {
    const child = schema.properties.get(key);
    return child ? problemsOf(child, entry, `${path}.${key}`) : [];
  });
  return [...missing, ...nested];
}

function itemProblems(items: SchemaNode | undefined, given: readonly JsonValue[], path: string): string[] {
  return items ? given.flatMap((entry, index) => problemsOf(items, entry, `${path}[${index}]`)) : [];
}

function problemsOf(schema: SchemaNode, given: JsonValue, path: string): string[] {
  const scalar = scalarProblem(schema, given, path);
  if (scalar) return [scalar];
  if (Array.isArray(given)) return itemProblems(schema.items, given, path);
  return isJsonObject(given) ? objectProblems(schema, given, path) : [];
}

/** What is wrong with the arguments against the schema, one sentence each. Only required keys, single-string types, enums and nested properties and items are checked; anything else is left to the tool. */
export function schemaProblems(schema: AgentToolSpec["parameters"], given: AgentToolCall["arguments"]): string[] {
  const declared = decode(schemaNode, schema);
  const sent = decode(jsonObject, given);
  return declared.ok && sent.ok ? problemsOf(declared.value, sent.value, "arguments") : [];
}
