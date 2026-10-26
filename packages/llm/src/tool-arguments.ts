/** Reads the arguments a model wrote for a tool call. Harmless wrappers are peeled (a ```json fence, text around one outer {...}, a trailing comma); anything else is refused by naming the field where the JSON breaks, never echoing the text. */
import { decodeModelJson, isJsonArray, isJsonObject, jsonValue, stripCodeFence } from "@extynt/decode";
import type { JsonObject, JsonValue } from "@extynt/decode";

interface ToolArguments {
  arguments: JsonObject;
  argumentsError?: string;
}

const NOT_AN_OBJECT: ToolArguments = { arguments: {}, argumentsError: "the arguments were JSON but not an object" };

/** An absent or empty body is an empty object; anything that does not parse to an object is reported, because running the tool with `{}` would read as "use every default" (for an undo, "undo everything"). */
export function toolCallArguments(raw: JsonValue | undefined): ToolArguments {
  if (raw === undefined || raw === null) return { arguments: {} };
  if (typeof raw === "string") return raw.trim() ? parsedToolArguments(raw) : { arguments: {} };
  if (isJsonObject(raw)) return { arguments: raw };
  return { arguments: {}, argumentsError: `the arguments were ${isJsonArray(raw) ? "an array" : typeof raw}, not a JSON object` };
}

function parsedToolArguments(raw: string): ToolArguments {
  const parsed = decodeModelJson(raw, jsonValue);
  if (!parsed.ok) return { arguments: {}, argumentsError: brokenJsonReason(stripCodeFence(raw)) };
  return isJsonObject(parsed.value) ? { arguments: parsed.value } : NOT_AN_OBJECT;
}

function runsOutOfText(prefix: string): boolean {
  try {
    JSON.parse(prefix);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const position = /position (\d+)/.exec(message);
    return /end of JSON|Unterminated|Unexpected end/.test(message) || (position !== null && Number(position[1]) >= prefix.length);
  }
}

function breakingOffset(text: string): number {
  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (runsOutOfText(text.slice(0, middle + 1))) low = middle + 1;
    else high = middle;
  }
  return low;
}

function brokenJsonReason(text: string): string {
  const offset = breakingOffset(text);
  if (offset >= text.length) return "the arguments were not valid JSON: they look cut off; send fewer items per call";
  const key = [...text.slice(0, offset).matchAll(/"([A-Za-z_][\w]*)"\s*:/g)].pop()?.[1];
  return `the arguments were not valid JSON: ${key ? `the value of "${key}"` : "the text"} breaks near character ${offset} with plain text where JSON belongs. Every value must be complete JSON; a list such as operations must spell out every object in full, never describe or refer to earlier ones`;
}
