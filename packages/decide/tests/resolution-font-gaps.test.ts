// Font requests in the gap classes: a family with a comparative modifier, a family named as a style, typed-wrong family names, Japanese style words and the Spanish comic look.
import assert from "node:assert/strict";
import test from "node:test";
import { fontChoice } from "../src/index.js";
import type { FontRecord } from "../src/index.js";

function records(families: ReadonlyArray<string>): ReadonlyArray<FontRecord> {
  return families.map((family) => ({ family, style: "Regular", postScriptName: family.replace(/ /g, "") }));
}

function pick(phrase: string, installed: ReadonlyArray<string>): string {
  return fontChoice(phrase, records(installed)).deterministic({ phrase });
}

const WEIGHTS = ["Helvetica", "Helvetica Neue", "Arial", "Arial Black", "Georgia"];

test("a named family with a weight or width modifier resolves to that family", () => {
  assert.equal(pick("similar to helvetica but thinner", WEIGHTS), "Helvetica");
  assert.equal(pick("like arial but bolder", WEIGHTS), "Arial");
  assert.equal(pick("like helvetica neue but lighter", WEIGHTS), "Helvetica Neue");
});

test("a modified family abstains when it is not installed, even with a sibling family", () => {
  assert.equal(pick("similar to helvetica but thinner", ["Helvetica Neue", "Arial Black"]), "none");
  assert.equal(pick("like gotham but thinner", WEIGHTS), "none");
});

test("a family named as a style resolves to that family", () => {
  const shelf = ["Franklin Gothic Book", "Franklin Gothic Medium", "Chalkboard", "Chalkboard SE", "Arial", "Gill Sans"];
  assert.equal(pick("Franklin Gothic Book style", shelf), "Franklin Gothic Book");
  assert.equal(pick("Chalkboard SE style caption", shelf), "Chalkboard SE");
  assert.equal(pick("gill-sans-style", shelf), "Gill Sans");
  assert.equal(pick("arial style caption", shelf), "Arial");
});

test("a typed-wrong family name with one edit resolves to the installed family", () => {
  const shelf = ["Verdana", "Garamond", "Monaco", "Helvetica"];
  assert.equal(pick("xerdana", shelf), "Verdana");
  assert.equal(pick("Garamnd", shelf), "Garamond");
  assert.equal(pick("onaco", shelf), "Monaco");
  assert.equal(pick("helvetika", shelf), "Helvetica");
});

test("a typed-wrong name only resolves when it matches the whole family name, and a tie between typed matches abstains", () => {
  assert.equal(pick("Robotoo", ["Roboto Slab", "Roboto Mono"]), "none");
  assert.equal(pick("Robotoo", ["Roboto", "Roboto Mono"]), "Roboto");
  assert.equal(pick("Harbor", ["Harbora", "Harbord"]), "none");
});

test("a Japanese mincho or gothic word never picks a Latin family", () => {
  const latin = ["Times New Roman", "Georgia", "Arial", "Verdana"];
  for (const phrase of ["明朝体", "丸ゴシック", "ゴシック体", "丸みのあるフォント"]) assert.equal(pick(phrase, latin), "none", phrase);
});

test("a Japanese rounded or gothic word picks the installed Japanese family for it", () => {
  const japanese = ["Times New Roman", "Arial", "Hiragino Maru Gothic ProN", "Hiragino Kaku Gothic ProN", "Hiragino Mincho ProN", "Yu Mincho"];
  assert.equal(pick("丸ゴシック", japanese), "Hiragino Maru Gothic ProN");
  assert.equal(pick("丸み", japanese), "Hiragino Maru Gothic ProN");
  assert.equal(pick("ゴシック体", japanese), "Hiragino Kaku Gothic ProN");
  assert.ok(["Hiragino Mincho ProN", "Yu Mincho"].includes(pick("明朝", japanese)));
});

test("a Spanish comic font request picks a comic face, preferring Comic Sans MS or Marker Felt over other casual faces", () => {
  assert.ok(["Comic Sans MS", "Marker Felt"].includes(pick("fuente de cómic", ["Comic Sans MS", "Marker Felt", "Kristen ITC", "Arial"])));
  assert.ok(["Comic Sans MS", "Marker Felt"].includes(pick("fuente cómica", ["Comic Sans MS", "Marker Felt", "Kristen ITC", "Arial"])));
  assert.equal(pick("fuente de cómic", ["Kristen ITC", "Arial"]), "Kristen ITC");
});
