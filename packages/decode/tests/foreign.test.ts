/** Foreign: a module loaded at run time is reachable only by checked steps, and its answers are typed only by a decoder. */
import assert from "node:assert/strict";
import test from "node:test";
import { Foreign, importFunctions, number, object, string } from "../src/index.js";

const MODULE = `data:text/javascript,${encodeURIComponent("export function double(n) { return n * 2; } export class Box { constructor(v) { this.v = v; } read() { return { v: this.v }; } } export const notAFunction = 3;")}`;

test("an import whose named exports are functions is accepted", async () => {
  const module = await importFunctions(MODULE, ["double", "Box"]);
  assert.equal(module.read("double").apply([4]).into(number()), 8);
});

test("an export that is missing or not a function is refused by name", async () => {
  await assert.rejects(importFunctions(MODULE, ["missing"]), /\.missing: expected a function, found undefined/);
  await assert.rejects(importFunctions(MODULE, ["notAFunction"]), /\.notAFunction: expected a function, found number/);
});

test("a constructed instance answers through invoke and a decoder", async () => {
  const module = await importFunctions(MODULE, ["Box"]);
  const box = module.read("Box").construct(["seven"]);
  assert.deepEqual(box.invoke("read", []).into(object({ v: string() })), { v: "seven" });
  assert.throws(() => box.invoke("read", []).into(object({ v: number() })), /expected finite number/);
});

test("a promise is awaited before it is decoded", async () => {
  assert.equal(await new Foreign(Promise.resolve(3)).intoAwaited(number()), 3);
});

test("reading a member of a primitive or calling a non-function is refused", () => {
  assert.throws(() => new Foreign(1).read("x"), /expected an object, found number/);
  assert.throws(() => new Foreign({}).invoke("nothing", []), /expected a function, found undefined/);
});
