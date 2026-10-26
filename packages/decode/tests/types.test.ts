/** Type-level tests: each alias below fails the build unless Infer yields exactly the stated type. */
import assert from "node:assert/strict";
import test from "node:test";
import { array, boolean, brand, literal, lazy, map, nullValue, nullable, number, object, optional, rawJson, record, string, strictObject, taggedUnion, tuple, union } from "../src/index.js";
import { valueOf } from "./support.js";
import type { Brand, Decoder, Infer, RawJson } from "../src/index.js";

type Equals<A, B> = (<X>() => X extends A ? 1 : 2) extends <X>() => X extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

const layer = object({ id: brand("LayerId", string()), name: string(), opacity: optional(number()), tags: array(string()) });
const shape = taggedUnion("kind", {
  circle: object({ kind: literal("circle"), radius: number() }),
  square: object({ kind: literal("square"), side: number() }),
});
interface Tree {
  readonly children: ReadonlyArray<Tree>;
}
const tree: Decoder<Tree> = lazy(() => object({ children: array(tree) }));

export type Checks = [
  Expect<Equals<Infer<ReturnType<typeof string>>, string>>,
  Expect<Equals<Infer<ReturnType<typeof boolean>>, boolean>>,
  Expect<Equals<Infer<typeof nullValue>, null>>,
  Expect<Equals<Infer<ReturnType<typeof number>>, number>>,
  Expect<Equals<Infer<typeof layer>, { readonly id: Brand<string, "LayerId">; readonly name: string; readonly opacity?: number; readonly tags: ReadonlyArray<string> }>>,
  Expect<Equals<Infer<ReturnType<typeof literal<["a", "b"]>>>, "a" | "b">>,
  Expect<Equals<Infer<typeof shape>, { readonly kind: "circle"; readonly radius: number } | { readonly kind: "square"; readonly side: number }>>,
  Expect<Equals<Infer<ReturnType<typeof tuple<[Decoder<string>, Decoder<number>]>>>, readonly [string, number]>>,
  Expect<Equals<Infer<typeof tree>, Tree>>,
  Expect<Equals<Infer<ReturnType<typeof rawJson>>, RawJson>>,
  Expect<Equals<Infer<ReturnType<typeof record<string, number>>>, Readonly<Record<string, number>>>>,
  Expect<Equals<Infer<ReturnType<typeof nullable<string>>>, string | null>>,
  Expect<Equals<Infer<ReturnType<typeof union<[Decoder<string>, Decoder<number>]>>>, string | number>>,
  Expect<Equals<Infer<ReturnType<typeof strictObject<{ a: Decoder<string> }>>>, { readonly a: string }>>,
  Expect<Equals<Infer<ReturnType<typeof map<string, number>>>, number>>,
  Expect<Equals<{ id: Brand<string, "LayerId">; name: string; opacity: undefined; tags: [] } extends Infer<typeof layer> ? true : false, false>>,
];

test("an optional field decodes to an absent key, not an undefined value", () => {
  const output = valueOf(layer, { id: "x", name: "n", tags: [] });
  assert.equal("opacity" in output, false);
});
