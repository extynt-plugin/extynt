// Object decoders with exact inferred types, optional fields, and a choice of ignoring or rejecting unknown keys.
import type { AnyDecoder, Decoder, Infer } from "./decoder.js";
import { Failure, fail, within } from "./failure.js";
import { isRecord } from "./guards.js";
import type { KeyedInput } from "./guards.js";
import { assertDecoded } from "./trust.js";

/** The decoders for each field of an object, by key. */
export type Shape = Readonly<Record<string, AnyDecoder>>;

/** A decoder for a field that may be absent; the output type then has an optional key, never an explicit undefined. */
export type OptionalDecoder<T> = Decoder<T> & { readonly optional: true };

type OptionalKeys<S extends Shape> = { [K in keyof S]: S[K] extends { readonly optional: true } ? K : never }[keyof S];
type RequiredKeys<S extends Shape> = Exclude<keyof S, OptionalKeys<S>>;
type Flatten<T> = { [K in keyof T]: T[K] };

/** The output type of an object decoder: required keys for plain decoders, optional keys for `optional(...)`. */
export type ObjectOf<S extends Shape> = Flatten<
  { readonly [K in RequiredKeys<S>]: Infer<S[K]> } & { readonly [K in OptionalKeys<S>]?: Infer<S[K]> }
>;

interface Field {
  readonly key: string;
  readonly decoder: AnyDecoder;
  readonly isOptional: boolean;
}

/** Marks an object field as allowed to be absent; an absent or undefined input leaves the key out of the output. */
export function optional<T>(decoder: Decoder<T>): OptionalDecoder<T> {
  return { run: decoder.run, optional: true };
}

function fieldsOf(shape: Shape): ReadonlyArray<Field> {
  return Object.entries(shape).map(([key, decoder]) => ({ key, decoder, isOptional: "optional" in decoder }));
}

function decodeFields(fields: ReadonlyArray<Field>, input: KeyedInput): KeyedInput | Failure {
  const output: { [key: string]: unknown } = {};
  for (const field of fields) {
    const present = Object.hasOwn(input, field.key) ? input[field.key] : undefined;
    if (present === undefined && field.isOptional) continue;
    const decoded = field.decoder.run(present);
    if (decoded instanceof Failure) return within(decoded, field.key);
    output[field.key] = decoded;
  }
  return output;
}

function findExtraKey(input: KeyedInput, known: ReadonlySet<string>): string | null {
  for (const key in input) if (!known.has(key)) return key;
  return null;
}

function makeObject<S extends Shape>(shape: S, rejectOutside: ReadonlySet<string> | null): Decoder<ObjectOf<S>> {
  const fields = fieldsOf(shape);
  return {
    run(input) {
      if (!isRecord(input)) return fail("object", input);
      const decoded = decodeFields(fields, input);
      if (decoded instanceof Failure) return decoded;
      const extra = rejectOutside === null ? null : findExtraKey(input, rejectOutside);
      if (extra !== null) return within(new Failure("no such field", "present"), extra);
      assertDecoded<ObjectOf<S>>(decoded);
      return decoded;
    },
  };
}

/** Accepts an object with the shape's fields; other keys are ignored and dropped from the output. */
export function object<S extends Shape>(shape: S): Decoder<ObjectOf<S>> {
  return makeObject(shape, null);
}

/** Accepts an object with exactly the shape's fields; any other key is rejected by name. */
export function strictObject<S extends Shape>(shape: S): Decoder<ObjectOf<S>> {
  return makeObject(shape, new Set(Object.keys(shape)));
}
