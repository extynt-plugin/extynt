// Union decoders: trial-and-error unions for mixed shapes, and lookup-based tagged unions for discriminated ones.
import type { AnyDecoder, Decoder, Infer } from "./decoder.js";
import { Failure, describeRelativePath, fail, failShowing, kindOf, within } from "./failure.js";
import { isRecord } from "./guards.js";
import { assertDecoded } from "./trust.js";

function describeAlternative(failure: Failure): string {
  const place = describeRelativePath(failure.path);
  return place === "" ? failure.expected : `${failure.expected} at ${place}`;
}

function unionFailure(decoders: readonly AnyDecoder[], input: unknown): Failure {
  const alternatives: string[] = [];
  for (const decoder of decoders) {
    const outcome = decoder.run(input);
    if (outcome instanceof Failure) alternatives.push(describeAlternative(outcome));
  }
  return new Failure(alternatives.join(" or "), kindOf(input));
}

/** Accepts what the first matching decoder accepts, trying them in order; the error lists every alternative. */
export function union<const D extends readonly AnyDecoder[]>(...decoders: D): Decoder<Infer<D[number]>> {
  return {
    run(input) {
      for (const decoder of decoders) {
        const outcome = decoder.run(input);
        if (outcome instanceof Failure) continue;
        assertDecoded<Infer<D[number]>>(outcome);
        return outcome;
      }
      return unionFailure(decoders, input);
    },
  };
}

type Variants<Tag extends string, M> = { readonly [K in keyof M & string]: Decoder<{ readonly [T in Tag]: K }> };

/** Accepts an object by looking up its tag field in the variants, so only one variant decoder ever runs; each variant must decode the tag to its own key. */
export function taggedUnion<const Tag extends string, M extends Readonly<Record<string, AnyDecoder>> & Variants<Tag, M>>(
  tag: Tag,
  variants: M,
): Decoder<Infer<M[keyof M]>> {
  const byTag: ReadonlyMap<string, AnyDecoder> = new Map(Object.entries(variants));
  const expected = Object.keys(variants).map((name) => JSON.stringify(name)).join(" or ");
  return {
    run(input) {
      if (!isRecord(input)) return fail("object", input);
      const name = input[tag];
      const variant = typeof name === "string" ? byTag.get(name) : undefined;
      if (variant === undefined) return within(failShowing(expected, name), tag);
      const outcome = variant.run(input);
      if (outcome instanceof Failure) return outcome;
      assertDecoded<Infer<M[keyof M]>>(outcome);
      return outcome;
    },
  };
}
