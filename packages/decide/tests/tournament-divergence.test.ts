// A strong vocabulary hit must win over siblings in a large list as it does in a short one, and a family named with trailing use words, or tied with its own extensions, stays named.
import assert from "node:assert/strict";
import test from "node:test";
import { compileConcepts } from "../src/resolution-concepts.js";
import { pickEffect } from "../src/resolution-effects.js";
import { settleBaseTies } from "../src/resolution-font-names.js";
import type { NameHit } from "../src/resolution-font-names.js";
import { fontChoice } from "../src/index.js";
import type { Candidate } from "../src/candidate-search.js";
import type { FontRecord } from "../src/index.js";

const effect = (matchName: string, title: string, group: string): Candidate => ({ key: matchName, names: [matchName, title], group, title });

const CATALOGUE: ReadonlyArray<Candidate> = [
  effect("ADBE Linear Wipe", "Linear Wipe", "Transition"), effect("ADBE Linear Color Key2", "Linear Color Key", "Keying"), effect("ADBE Gradient Wipe", "Gradient Wipe", "Transition"),
  effect("ADBE Radial Blur", "Radial Blur", "Blur & Sharpen"), effect("CC Radial Blur", "CC Radial Blur", "Blur & Sharpen"), effect("ADBE Radial Wipe", "Radial Wipe", "Transition"),
  effect("ADBE Iris Wipe", "Iris Wipe", "Transition"), effect("ADBE Circle", "Circle", "Generate"), effect("ADBE Mosaic", "Mosaic", "Stylize"), effect("ADBE Pixel Motion Blur", "Pixel Motion Blur", "Time"),
];

test("an exact vendor-prefixed vocabulary target names its effect and its loose stems no longer lift siblings", () => {
  assert.equal(pickEffect("un barrido lineal suave", CATALOGUE), "ADBE Linear Wipe");
  assert.equal(pickEffect("streak the shot outward from the centre like a zoom blur", CATALOGUE), "ADBE Radial Blur");
  assert.equal(pickEffect("reveal the next shot through a circular iris", CATALOGUE), "ADBE Iris Wipe");
  assert.equal(pickEffect("make the footage look pixelated", CATALOGUE), "ADBE Mosaic");
});

test("a concept whose exact effect is absent still reaches the loose stems", () => {
  const without = CATALOGUE.filter((entry) => entry.key !== "ADBE Linear Wipe");
  assert.equal(compileConcepts([["barrido", "=ADBE_Linear_Wipe linear wipe", 6]])[0]?.targets[0], "=linear_wipe@adbe");
  assert.notEqual(pickEffect("un barrido lineal", without), "ADBE Linear Wipe");
});

function records(families: ReadonlyArray<string>): ReadonlyArray<FontRecord> {
  return families.map((family) => ({ family, style: "Regular", postScriptName: family.replace(/ /g, "") }));
}

function pick(phrase: string, installed: ReadonlyArray<string>): string {
  return fontChoice(phrase, records(installed)).deterministic({ phrase });
}

const FAMILIES = ["Verdana", "Verdana Pro", "Georgia", "Georgia Pro", "Montserrat", "Montserrat Alternates", "Montserrat Subrayada", "Arial", "Arial Black"];

test("a family named with use words after style keeps its pick", () => {
  assert.equal(pick("verdana style sign text", FAMILIES), "Verdana");
  assert.equal(pick("georgia style wedding text", FAMILIES), "Georgia");
  assert.equal(pick("something in the style of a sign", FAMILIES), "none");
});

test("a typo and an X style request pick the base family over its extensions", () => {
  assert.equal(pick("Montserat", FAMILIES), "Montserrat");
  assert.equal(pick("montserat style", FAMILIES), "Montserrat");
});

test("a typo that fits only unrelated families still abstains", () => {
  assert.equal(pick("Arial Blak Verdana", ["Arial Black", "Verdana Pro"]), "none");
  assert.equal(pick("Montserat", ["Montserrat Alternates", "Montserrat Subrayada"]), "none");
});

function hit(key: string, matched: number): NameHit {
  return { key, score: 0.6, coverage: 1, precision: 1, distinct: true, unsaid: 0, lead: true, typo: true, clash: false, matched: new Set(Array.from({ length: matched }, (_, index) => `w${index}`)) };
}

test("a tie between a base family and its extensions settles on the base unless an unrelated family ties too", () => {
  const titles = new Map([["a", "Impact Label"], ["b", "Impact"], ["c", "Other Face"]]);
  assert.deepEqual(settleBaseTies([hit("a", 1), hit("b", 1)], titles).map((row) => row.key), ["b"]);
  assert.deepEqual(settleBaseTies([hit("a", 1), hit("b", 1), hit("c", 1)], titles).map((row) => row.key), ["a", "b", "c"]);
  assert.deepEqual(settleBaseTies([hit("a", 2), hit("b", 1)], titles).map((row) => row.key), ["a", "b"]);
});
