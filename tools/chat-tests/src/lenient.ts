/** Decoders for JSON the harness reads without failing on its shape: a wrong member is absent, a malformed row is skipped. */
import { array, map, optional, rawJson, union } from "@extynt/decode";
import type { Decoder } from "@extynt/decode";

const absent = map(rawJson(), () => undefined);

/** An object member that may be missing or of the wrong type, either of which reads as undefined. */
export function lenient<T>(decoder: Decoder<T>) {
  return optional(union(decoder, absent));
}

/** An array that keeps the rows the decoder accepts and drops the others. */
export function skippingInvalid<T>(row: Decoder<T>): Decoder<T[]> {
  return map(array(union(row, absent)), (rows) => rows.filter((entry): entry is T => entry !== undefined));
}
