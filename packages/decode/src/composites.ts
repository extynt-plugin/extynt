// Decoders built from other decoders: arrays, tuples, open maps, nullable values, mapping, refinement and recursion.
import type { AnyDecoder, Decoder, Infer } from "./decoder.js";
import { Failure, fail, failShowing, within } from "./failure.js";
import { isArray, isRecord } from "./guards.js";
import type { KeyedInput } from "./guards.js";
import { assertDecoded } from "./trust.js";

/** Optional bounds on how many items an array holds. */
export interface ArrayLimits {
  readonly minLength?: number;
  readonly maxLength?: number;
}

/** The output of a tuple decoder: each position has the type its decoder produces. */
export type TupleOf<D extends readonly AnyDecoder[]> = { readonly [K in keyof D]: Infer<D[K]> };

function lengthProblem(length: number, limits: ArrayLimits): string | null {
  if (limits.minLength !== undefined && length < limits.minLength) return `array of at least ${limits.minLength} items`;
  if (limits.maxLength !== undefined && length > limits.maxLength) return `array of at most ${limits.maxLength} items`;
  return null;
}

function decodeItems<T>(item: Decoder<T>, input: ReadonlyArray<unknown>): ReadonlyArray<T> | Failure {
  const items: T[] = [];
  for (let index = 0; index < input.length; index++) {
    const decoded = item.run(input[index]);
    if (decoded instanceof Failure) return within(decoded, index);
    items.push(decoded);
  }
  return items;
}

/** Accepts an array whose every item the given decoder accepts, within the length limits. */
export function array<T>(item: Decoder<T>, limits: ArrayLimits = {}): Decoder<ReadonlyArray<T>> {
  return {
    run(input) {
      if (!isArray(input)) return fail("array", input);
      const problem = lengthProblem(input.length, limits);
      return problem === null ? decodeItems(item, input) : fail(problem, input);
    },
  };
}

function decodePositions(decoders: readonly AnyDecoder[], input: ReadonlyArray<unknown>): ReadonlyArray<unknown> | Failure {
  const positions: unknown[] = [];
  for (let index = 0; index < decoders.length; index++) {
    const decoded = decoders[index]?.run(input[index]);
    if (decoded instanceof Failure) return within(decoded, index);
    positions.push(decoded);
  }
  return positions;
}

/** Accepts an array of exactly as many items as there are decoders, each decoded by the decoder at its position. */
export function tuple<const D extends readonly AnyDecoder[]>(...decoders: D): Decoder<TupleOf<D>> {
  return {
    run(input) {
      if (!isArray(input) || input.length !== decoders.length) return fail(`array of exactly ${decoders.length} items`, input);
      const positions = decodePositions(decoders, input);
      if (positions instanceof Failure) return positions;
      assertDecoded<TupleOf<D>>(positions);
      return positions;
    },
  };
}

function decodeEntries<K extends string, V>(key: Decoder<K>, value: Decoder<V>, input: KeyedInput): Array<[K, V]> | Failure {
  const entries: Array<[K, V]> = [];
  for (const name of Object.keys(input)) {
    const decodedKey = key.run(name);
    if (decodedKey instanceof Failure) return within(decodedKey, name);
    const decodedValue = value.run(input[name]);
    if (decodedValue instanceof Failure) return within(decodedValue, name);
    entries.push([decodedKey, decodedValue]);
  }
  return entries;
}

/** Accepts a genuinely open map: every key passes the key decoder and every value passes the value decoder. */
export function record<K extends string, V>(key: Decoder<K>, value: Decoder<V>): Decoder<Readonly<Record<K, V>>> {
  return {
    run(input) {
      if (!isRecord(input)) return fail("object", input);
      const entries = decodeEntries(key, value, input);
      if (entries instanceof Failure) return entries;
      const keyed = Object.fromEntries(entries);
      assertDecoded<Readonly<Record<K, V>>>(keyed);
      return keyed;
    },
  };
}

/** Accepts `null` or whatever the given decoder accepts. */
export function nullable<T>(decoder: Decoder<T>): Decoder<T | null> {
  return { run: (input) => (input === null ? null : decoder.run(input)) };
}

/** Decodes with the given decoder, then converts the value; the conversion cannot fail. */
export function map<A, B>(decoder: Decoder<A>, convert: (value: A) => B): Decoder<B> {
  return {
    run(input) {
      const decoded = decoder.run(input);
      return decoded instanceof Failure ? decoded : convert(decoded);
    },
  };
}

/** Decodes with the given decoder, then keeps only values the guard accepts, narrowing the output type. */
export function refine<A, B extends A>(decoder: Decoder<A>, guard: (value: A) => value is B, expected: string): Decoder<B> {
  return {
    run(input) {
      const decoded = decoder.run(input);
      if (decoded instanceof Failure) return decoded;
      return guard(decoded) ? decoded : failShowing(expected, decoded);
    },
  };
}

/** Defers building a decoder until first use, so a decoder can refer to itself; annotate the constant with its type. */
export function lazy<T>(create: () => Decoder<T>): Decoder<T> {
  let built: Decoder<T> | null = null;
  return {
    run(input) {
      built ??= create();
      return built.run(input);
    },
  };
}
