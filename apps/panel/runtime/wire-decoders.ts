/**
 * Panel-local decoder helpers built on @extynt/decode. They hold only what the panel needs beyond the shared decoders: a
 * count that rounds down, the sidecar's acknowledgement, and the two input-adapting combinators.
 */
import { Failure, fallback, literal, map, number, object } from "@extynt/decode";
import type { Decoder } from "@extynt/decode";

/** The same type with every field assignable, for values the panel updates in place after decoding them. */
export type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** Hands an absent field to the inner decoder as null. */
export function nullIfAbsent<T>(inner: Decoder<T>): Decoder<T> {
  return { run: (input) => inner.run(input === undefined ? null : input) };
}

/** Decodes with `first`, then reads the same input with the decoder `choose` picks from what `first` yielded. */
export function andThen<A, B>(first: Decoder<A>, choose: (decoded: A) => Decoder<B>): Decoder<B> {
  return {
    run(input) {
      const decoded = first.run(input);
      return decoded instanceof Failure ? decoded : choose(decoded).run(input);
    },
  };
}

/** A count: a finite number rounded down to a whole number of at least zero; anything else reads as zero. */
export const wholeCount: Decoder<number> = map(fallback(number(), 0), (amount) => (amount > 0 ? Math.floor(amount) : 0));

/** The sidecar's UI and log routes answer `{ ok: true, ... }` when they did what was asked; the rest of the body is not read. */
export const acknowledged = object({ ok: literal(true) });

/** Accepts any input without reading it; for an answer whose content nobody uses. */
export const ignored: Decoder<null> = map(fallback(object({}), null), () => null);
