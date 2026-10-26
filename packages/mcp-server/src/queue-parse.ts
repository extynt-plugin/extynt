// Array arguments that arrive as text: models sometimes send "operations" as a JSON string, fenced or wrapped in prose, and the text is read back into the array it holds.
import { array, decodeJson, type Decoder, type JsonArray, type JsonObject, jsonValue, stripCodeFence } from "@extynt/decode";
import { toolError } from "./tool-result.js";
import type { ToolFailure } from "./tool-result.js";

type ParsedArray =
  | { readonly ok: true; readonly value: JsonArray }
  | { readonly ok: false; readonly truncated: boolean; readonly position?: number };

const arrayValue: Decoder<JsonArray> = array(jsonValue);
const OUT_OF_TEXT = /end of JSON|Unterminated|Unexpected end|Expected/;

function syntaxMessage(text: string): string | undefined {
  const parsed = decodeJson(text, jsonValue);
  return parsed.ok ? undefined : parsed.error.found;
}

function endsEarly(prefix: string): boolean {
  const message = syntaxMessage(prefix);
  return message !== undefined && OUT_OF_TEXT.test(message) && !/position/.test(message);
}

function firstBadOffset(text: string): number {
  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (endsEarly(text.slice(0, middle + 1))) low = middle + 1;
    else high = middle;
  }
  return low;
}

function failurePosition(message: string, text: string): number {
  const named = /position (\d+)/.exec(message)?.[1];
  return named === undefined ? firstBadOffset(text) : Number(named);
}

function bracketDelta(char: string): number {
  if (char === "[" || char === "{") return 1;
  return char === "]" || char === "}" ? -1 : 0;
}

function looksCutOff(text: string): boolean {
  let depth = 0;
  let inString = false;
  for (let at = 0; at < text.length; at += 1) {
    const char = text.charAt(at);
    if (inString) {
      if (char === "\\") at += 1;
      else inString = char !== '"';
    } else {
      inString = char === '"';
      if (!inString) depth = Math.max(0, depth + bracketDelta(char));
    }
  }
  return inString || depth > 0;
}

function attemptsOf(unfenced: string): string[] {
  const open = unfenced.indexOf("[");
  const close = unfenced.lastIndexOf("]");
  const candidates = new Set([unfenced, ...(open >= 0 && close > open ? [unfenced.slice(open, close + 1)] : [])]);
  return [...candidates].flatMap((candidate) => [candidate, candidate.replace(/,(\s*)\]\s*$/, "$1]")]);
}

/** Reads the one array a string holds once a code fence, surrounding prose and a trailing comma are peeled away; anything else says whether the text was cut off and where it first goes wrong. */
export function parseArrayText(text: string): ParsedArray {
  const unfenced = stripCodeFence(text);
  const attempts = attemptsOf(unfenced);
  for (const attempt of attempts) {
    const parsed = decodeJson(attempt, arrayValue);
    if (parsed.ok) return { ok: true, value: parsed.value };
  }
  const truncated = looksCutOff(unfenced);
  for (const attempt of attempts) {
    const message = syntaxMessage(attempt);
    if (message !== undefined) return { ok: false, truncated, position: failurePosition(message, attempt) };
  }
  return { ok: false, truncated };
}

function arrayFromString(key: string, text: string, shape: string): JsonArray | ToolFailure {
  const parsed = parseArrayText(text);
  if (parsed.ok) return parsed.value;
  const head = `${key} must be an array of ${shape}, but a string was received that is not a JSON array.`;
  if (parsed.truncated) return toolError("INVALID_ARGUMENT", `${head} The ${key} text looks truncated (brackets are still open at its end); send fewer ${key} per call, as a real array.`);
  const near = parsed.position === undefined ? "" : ` (invalid JSON near character ${parsed.position})`;
  return toolError("INVALID_ARGUMENT", `${head}${near} Send ${key} as a real array, not as quoted text.`);
}

/** The array an argument holds, reading it out of text when it was sent as a string. */
export function arrayArgument(value: JsonArray | string, key: string, shape: string): JsonArray | ToolFailure {
  return typeof value === "string" ? arrayFromString(key, value, shape) : value;
}

/** The arguments with the string at `key` read as the array it stands for, or the refusal when it is not one; the arguments given are not changed. */
export function withArrayArg(args: JsonObject, key: string, shape: string): { readonly args: JsonObject } | ToolFailure {
  const value = args[key];
  if (typeof value !== "string") return { args };
  const parsed = arrayFromString(key, value, shape);
  return "error" in parsed ? parsed : { args: { ...args, [key]: parsed } };
}
