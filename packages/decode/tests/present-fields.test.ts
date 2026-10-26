/** presentFields: undefined means absent at runtime and in the type, while null, false, zero and empty values are kept. */
import assert from "node:assert/strict";
import test from "node:test";
import { presentFields } from "../src/index.js";
import type { Present } from "../src/index.js";

type Equals<A, B> = (<X>() => X extends A ? 1 : 2) extends <X>() => X extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

export type Checks = [
  Expect<Equals<Present<{ a: string; b: number | undefined }>, { readonly a: string; readonly b?: number }>>,
  Expect<Equals<Present<{ a: string | null }>, { readonly a: string | null }>>,
];

test("presentFields drops only the keys that hold undefined", () => {
  const fields = presentFields({ zero: 0, empty: "", no: false, nothing: null, gone: undefined });
  assert.deepEqual(fields, { zero: 0, empty: "", no: false, nothing: null });
  assert.equal("gone" in fields, false);
});

test("presentFields yields a type whose possibly-undefined keys are optional", () => {
  const maybe: number | undefined = Number("7") > 5 ? undefined : 1;
  const fields = presentFields({ id: "a", count: maybe });
  const id: string = fields.id;
  const count: number | undefined = fields.count;
  assert.equal(id, "a");
  assert.equal(count, undefined);
  assert.deepEqual(Object.keys(fields), ["id"]);
});

test("presentFields keeps a __proto__ key as plain data and does not change the prototype", () => {
  const source: { [key: string]: number | undefined } = Object.fromEntries([["__proto__", 1], ["ok", 2], ["gone", undefined]]);
  const fields = presentFields(source);
  assert.equal(Object.getPrototypeOf(fields), Object.prototype);
  assert.deepEqual(Object.keys(fields), ["__proto__", "ok"]);
});

test("presentFields does not mutate its argument", () => {
  const source = { a: 1, b: undefined };
  presentFields(source);
  assert.ok("b" in source);
});
