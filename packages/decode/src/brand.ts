// Branded types for identifiers that must not mix, and RawJson for payloads kept deliberately opaque.
import type { Decoder } from "./decoder.js";
import { Failure, fail, failShowing } from "./failure.js";
import { assertDecoded } from "./trust.js";

declare const brandName: unique symbol;

/** A `T` that the type system tells apart from every other `T` by name, as in `Brand<string, "LayerId">`. */
export type Brand<T, N extends string> = T & { readonly [brandName]: N };

/** JSON text for a payload the program passes along without looking inside; valid JSON when it was decoded. */
export type RawJson = Brand<string, "RawJson">;

/** Decodes with the given decoder, optionally requires `accepts`, and brands the value with the name. */
export function brand<N extends string, T>(name: N, decoder: Decoder<T>, accepts: (value: T) => boolean = () => true): Decoder<Brand<T, N>> {
  return {
    run(input) {
      const decoded = decoder.run(input);
      if (decoded instanceof Failure) return decoded;
      if (!accepts(decoded)) return failShowing(name, decoded);
      assertDecoded<Brand<T, N>>(decoded);
      return decoded;
    },
  };
}

function serialize(input: unknown): string | null {
  if (typeof input === "number" && !Number.isFinite(input)) return null;
  try {
    const text: string | undefined = JSON.stringify(input);
    return text ?? null;
  } catch {
    return null;
  }
}

/** Accepts any JSON value and keeps it as its JSON text; the contents are not inspected further. */
export function rawJson(): Decoder<RawJson> {
  return {
    run(input) {
      const text = serialize(input);
      if (text === null) return fail("JSON value", input);
      assertDecoded<RawJson>(text);
      return text;
    },
  };
}
