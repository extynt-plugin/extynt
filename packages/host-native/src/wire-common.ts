// Decoder helpers every wire module shares: members a newer or older plugin may leave out, and the error and timing objects that frame each reply.
import { array, map, number, object, optional, string, union, literal } from "@extynt/decode";
import type { Decoder, Infer, OptionalDecoder } from "@extynt/decode";

const nullWhenMismatched: Decoder<null> = { run: () => null };
const emptyWhenMismatched: Decoder<""> = { run: () => "" };
const undefinedWhenMismatched: Decoder<undefined> = { run: () => undefined };

/** A member that reads as null when it is absent or null; a present member of another type is rejected. */
export function absentAsNull<T>(decoder: Decoder<T>): Decoder<T | null> {
  return { run: (input) => (input === undefined || input === null ? null : decoder.run(input)) };
}

/** A member that reads as null whenever it is not what the decoder accepts. */
export function nullUnlessValid<T>(decoder: Decoder<T>): Decoder<T | null> {
  return union(decoder, nullWhenMismatched);
}

/** An array member as a mutable array, the shape callers that build on a decoded value expect. */
export function list<T>(decoder: Decoder<T>): Decoder<T[]> {
  return map(array(decoder), (items) => [...items]);
}

/** A string member that reads as the empty string whenever it is absent or not a string. */
export const stringOrEmpty: Decoder<string> = union(string(), emptyWhenMismatched);

/** An optional member that reads as undefined when it is present but not what the decoder accepts. */
export function softly<T>(decoder: Decoder<T>): OptionalDecoder<T | undefined> {
  return optional(union(decoder, undefinedWhenMismatched));
}

const wireErrorFields = object({ code: string(), message: string(), aeErr: softly(number()) });

/** The error a failed reply carries: the plugin's code, its message and, when After Effects gave one, its error number. */
export interface WireError { readonly code: string; readonly message: string; readonly aeErr?: number }

/** Decodes the `error` object of a failed reply; an `aeErr` that is not a number is left out. */
export const wireError: Decoder<WireError> = map(wireErrorFields, ({ code, message, aeErr }) => (aeErr === undefined ? { code, message } : { code, message, aeErr }));

/** The `timing` object every successful reply carries. */
export const wireTiming = object({
  queuedMs: number(), walkMs: number(), hashMs: number(), serializeMs: number(),
  totalMainThreadMs: number(), bytes: number(), getterCalls: number(), dispatchedBy: literal("idle", "socket"),
});
export type WireTiming = Infer<typeof wireTiming>;
