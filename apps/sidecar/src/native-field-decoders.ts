// Field decoders for native pages: integer, ordinal and bounded-text readers shared by the strict native page decoders.
import { array, map, number, refine, string } from "@extynt/decode";
import type { Decoder } from "@extynt/decode";

/** A safe integer of at least `minimum`. */
export function integerFrom(minimum: number): Decoder<number> {
  return refine(number(), (value): value is number => Number.isSafeInteger(value) && value >= minimum, `safe integer of at least ${minimum}`);
}

/** A native ordinal: a safe integer of at least one. */
export const ordinal: Decoder<number> = integerFrom(1);

/** A non-empty string of at most `maxLength` characters. */
export function boundedText(maxLength: number): Decoder<string> {
  return string({ nonEmpty: true, maxLength });
}

/** A list of native ordinals with the given length limits, as a fresh mutable array. */
export function ordinalList(limits: { minLength: number; maxLength: number }): Decoder<number[]> {
  return map(array(ordinal, limits), (items) => [...items]);
}
