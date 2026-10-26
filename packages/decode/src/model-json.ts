// Reads JSON a language model wrote: wrapped in a code fence, surrounded by prose, or with a trailing comma.
import type { DecodeResult, Decoder } from "./decoder.js";
import { decodeJson } from "./decoder.js";

/** The text without a surrounding Markdown code fence and the whitespace around it. */
export function stripCodeFence(text: string): string {
  return text.trim().replace(/^```[a-zA-Z0-9]*\s*\n?/, "").replace(/\n?\s*```\s*$/, "").trim();
}

function spanBetween(text: string, open: string, close: string): string[] {
  const start = text.indexOf(open);
  const end = text.lastIndexOf(close);
  return start >= 0 && end > start ? [text.slice(start, end + 1)] : [];
}

function candidatesOf(text: string): string[] {
  const unfenced = stripCodeFence(text);
  const readings = new Set([unfenced, ...spanBetween(unfenced, "{", "}"), ...spanBetween(unfenced, "[", "]")]);
  return [...readings].flatMap((reading) => [reading, reading.replace(/,(\s*[}\]])/g, "$1")]);
}

/** Decodes the JSON in a model's reply: the whole text, then the span from its first `{` to its last `}`, then from its first `[` to its last `]`, each also with trailing commas removed. The first reading the decoder accepts wins; otherwise the result is the failure of the whole text. */
export function decodeModelJson<T>(text: string, decoder: Decoder<T>): DecodeResult<T> {
  let wholeText: DecodeResult<T> | undefined;
  for (const candidate of candidatesOf(text)) {
    const attempt = decodeJson(candidate, decoder);
    if (attempt.ok) return attempt;
    wholeText ??= attempt;
  }
  return wholeText ?? decodeJson(text, decoder);
}
