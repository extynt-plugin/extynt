// The expression sources a plan carries, as the bounded lines the apply log and the receipt show.
import type { JsonValue } from "@extynt/decode";
import { array, decode, fallback, jsonValue, object, optional, string } from "@extynt/decode";

const EXCERPT_LIMIT = 240;
const MAX_LINES = 8;

const entry = object({
  operation: optional(fallback(string(), undefined)),
  type: optional(fallback(string(), undefined)),
  enabled: optional(fallback(jsonValue, undefined)),
  source: optional(fallback(string(), undefined)),
  propertyPath: optional(fallback(string(), undefined)),
  target: optional(fallback(object({ propertyPath: optional(fallback(string(), undefined)) }), undefined)),
});

const messageFields = object({ expressions: optional(fallback(array(jsonValue), undefined)), operations: optional(fallback(array(jsonValue), undefined)) });

interface ExpressionMessage {
  readonly expressions?: ReadonlyArray<JsonValue> | undefined;
  readonly operations?: ReadonlyArray<JsonValue> | undefined;
}

/** One expression source, cut to the excerpt limit, with how much was cut. */
export interface ExpressionLine {
  readonly propertyPath: string;
  readonly text: string;
  readonly truncated: boolean;
  readonly length: number;
  readonly remaining: number;
}

interface ExpressionSource {
  readonly propertyPath: string;
  readonly source: string;
}

type Entry = ReturnType<typeof entryOf>;

function entryOf(value: JsonValue) {
  const decoded = decode(entry, value);
  return decoded.ok ? decoded.value : undefined;
}

function listedSources(items: ReadonlyArray<JsonValue>, found: ExpressionSource[]): void {
  for (const value of items) {
    const item = entryOf(value);
    if (found.length < MAX_LINES && item?.source) found.push({ propertyPath: item.propertyPath ?? "", source: item.source });
  }
}

function operationPath(item: NonNullable<Entry>): string {
  return item.propertyPath ?? item.target?.propertyPath ?? "";
}

function expressionEntry(value: JsonValue, found: ReadonlyArray<ExpressionSource>): NonNullable<Entry> | null {
  const item = entryOf(value);
  return item && found.length < MAX_LINES && (item.operation ?? item.type) === "set_expression" ? item : null;
}

function operationSources(items: ReadonlyArray<JsonValue>, found: ExpressionSource[]): void {
  for (const value of items) {
    const item = expressionEntry(value, found);
    if (!item) continue;
    if (item.enabled === false || typeof item.source !== "string" || !item.source) continue;
    found.push({ propertyPath: operationPath(item), source: item.source });
  }
}

function excerptOf(source: ExpressionSource): ExpressionLine {
  const text = source.source;
  if (text.length <= EXCERPT_LIMIT) return { propertyPath: source.propertyPath, text, truncated: false, length: text.length, remaining: 0 };
  return { propertyPath: source.propertyPath, text: text.slice(0, EXCERPT_LIMIT), truncated: true, length: text.length, remaining: text.length - EXCERPT_LIMIT };
}

/** The expression sources of a plan message, listed ones first, at most eight, each cut to the excerpt limit. */
export function planExpressionLines(message: ExpressionMessage): ReadonlyArray<ExpressionLine> {
  const decoded = decode(messageFields, message);
  const fields = decoded.ok ? decoded.value : {};
  const found: ExpressionSource[] = [];
  listedSources(fields.expressions ?? [], found);
  operationSources(fields.operations ?? [], found);
  return found.map(excerptOf);
}

/** Writes each expression line of the plan to the apply log and returns them for the receipt. */
export function logExpressionLines(message: ExpressionMessage, log: (line: string) => void): ReadonlyArray<ExpressionLine> {
  const lines = planExpressionLines(message);
  for (const line of lines) log(`${line.propertyPath ? `Expression on ${line.propertyPath}` : "Expression"}: ${line.text.replace(/\s+/g, " ")}${line.truncated ? "…" : ""}`);
  return lines;
}
