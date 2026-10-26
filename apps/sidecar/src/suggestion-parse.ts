// Reads a model's reply into the short, one-line prompt suggestions the panel offers; anything that does not fit is dropped, never repaired.
import { array, decodeJson, map, object, union, type Decoder } from "@extynt/decode";

/** What a suggestion may be: a short request, one line, in plain words. */
export const SUGGESTION_LIMITS = { minimum: 2, maximum: 4, characters: 22, words: 5, shortest: 3 } as const;

const FENCE = /^```(?:json)?\s*([\s\S]*?)\s*```$/i;
const FORBIDDEN = /[\u0000-\u001f\u007f-\u009f\u2028\u2029{}[\]<>`\\]/;

function plainRequest(value: string): string | null {
  if (FORBIDDEN.test(value)) return null;
  const text = value.trim();
  const words = text.split(/\s+/).length;
  const fits = text.length >= SUGGESTION_LIMITS.shortest && text.length <= SUGGESTION_LIMITS.characters && words <= SUGGESTION_LIMITS.words;
  return fits && !/^https?:/i.test(text) ? text : null;
}

const suggestionEntry: Decoder<string | null> = { run: (input) => (typeof input === "string" ? plainRequest(input) : null) };

const suggestionList = union(array(suggestionEntry), map(object({ suggestions: array(suggestionEntry) }), (reply) => reply.suggestions));

function jsonText(reply: string): string {
  const bare = reply.trim();
  return FENCE.exec(bare)?.[1] ?? bare;
}

function distinct(entries: ReadonlyArray<string | null>): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const text of entries) {
    if (text === null || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    kept.push(text);
  }
  return kept;
}

/**
 * The model's reply as 2 to 4 distinct, short, one-line strings, or undefined. The reply must be one JSON value: an object
 * with a `suggestions` array, or the array itself (one surrounding code fence is tolerated). An entry that is not a string
 * or breaks a rule is dropped, as are repeats; fewer than two survivors means no suggestions at all.
 */
export function parseSuggestions(reply: string): string[] | undefined {
  const decoded = decodeJson(jsonText(reply), suggestionList);
  if (!decoded.ok) return undefined;
  const kept = distinct(decoded.value);
  return kept.length >= SUGGESTION_LIMITS.minimum ? kept.slice(0, SUGGESTION_LIMITS.maximum) : undefined;
}
