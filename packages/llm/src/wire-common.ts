/** Decoder helpers shared by the provider wire modules: JSON values, fields a provider may omit or mistype without failing the body, and token counts. */
import { array, decode, fallback, optional } from "@extynt/decode";
import type { Decoder, OptionalDecoder } from "@extynt/decode";
import type { ProviderCompletion } from "./types.js";

type CompletionUsage = NonNullable<ProviderCompletion["usage"]>;

interface TokenCounts {
  input?: number | undefined;
  output?: number | undefined;
  total?: number | undefined;
  cached?: number | undefined;
}

export const ignored: Decoder<undefined> = { run: () => undefined };

export function present<T>(value: T | undefined): value is T {
  return value !== undefined;
}

/** A field that reads as absent when the provider omitted it or sent another type. */
export function softly<T>(decoder: Decoder<T>): OptionalDecoder<T | undefined> {
  return optional(fallback(decoder, undefined));
}

/** A list whose malformed items read as undefined, so positions stay as the provider sent them. */
export function lenientList<T>(item: Decoder<T>): OptionalDecoder<ReadonlyArray<T | undefined> | undefined> {
  return softly(array(fallback(item, undefined)));
}

/** The decoded response body, or the fallback when the body is not the shape the decoder describes. */
export async function readBody<T>(response: Response, decoder: Decoder<T>, fallback: T): Promise<T> {
  const decoded = decode(decoder, await response.json());
  return decoded.ok ? decoded.value : fallback;
}

/** Token counts in the completion shape, leaving out every count the provider did not report. */
export function completionUsage(counts: TokenCounts): CompletionUsage {
  return {
    ...(counts.input === undefined ? {} : { inputTokens: counts.input }),
    ...(counts.output === undefined ? {} : { outputTokens: counts.output }),
    ...(counts.total === undefined ? {} : { totalTokens: counts.total }),
    ...(counts.cached === undefined ? {} : { cachedInputTokens: counts.cached }),
  };
}
