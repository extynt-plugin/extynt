// Decoders that never fail where the program has a sensible reading for bad input: a fallback value, a skipped entry or an absent field.
import type { Decoder } from "./decoder.js";
import { Failure, fail } from "./failure.js";
import { isArray, isRecord } from "./guards.js";

/** Yields the decoded value, or `value` for input the inner decoder rejects; never fails and renders no error. Use for a field whose wrong type has always meant "use the default"; `fallback(d, undefined)` and `fallback(d, null)` read a bad field as not given or as known-absent. The same `value` is returned every time, so it should be immutable. */
export function fallback<T, V>(inner: Decoder<T>, value: V): Decoder<T | V> {
  return {
    run(input) {
      const decoded = inner.run(input);
      return decoded instanceof Failure ? value : decoded;
    },
  };
}

/** Yields `value` when the input is absent (`undefined`) and otherwise the inner decoder's outcome, failure included. Use when only a missing field has a default and a present bad one must still be rejected. */
export function absentAs<T, V>(inner: Decoder<T>, value: V): Decoder<T | V> {
  return { run: (input) => (input === undefined ? value : inner.run(input)) };
}

function keepValid<T>(item: Decoder<T>, items: ReadonlyArray<unknown>, readLimit: number): ReadonlyArray<T> {
  const kept: T[] = [];
  for (let index = 0; index < Math.min(items.length, readLimit); index++) {
    const decoded = item.run(items[index]);
    if (!(decoded instanceof Failure)) kept.push(decoded);
  }
  return kept;
}

/** Accepts an array and keeps, in order, the entries the item decoder accepts; only the first `readLimit` entries are read. Anything that is not an array is rejected, so wrap it in `fallback(..., [])` when that should read as empty. */
export function skippingInvalid<T>(item: Decoder<T>, readLimit = Number.POSITIVE_INFINITY): Decoder<ReadonlyArray<T>> {
  return { run: (input) => (isArray(input) ? keepValid(item, input, readLimit) : fail("array", input)) };
}

/** Accepts an object and keeps the entries whose value the decoder accepts; an own key such as `__proto__` stays plain data. Anything that is not an object is rejected. */
export function skippingInvalidRecord<T>(value: Decoder<T>): Decoder<Readonly<Record<string, T>>> {
  return {
    run(input) {
      if (!isRecord(input)) return fail("object", input);
      const kept: Array<[string, T]> = [];
      for (const key of Object.keys(input)) {
        const decoded = value.run(input[key]);
        if (!(decoded instanceof Failure)) kept.push([key, decoded]);
      }
      return Object.fromEntries(kept);
    },
  };
}
