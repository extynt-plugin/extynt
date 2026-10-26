// A loose word such as twist names no effect by itself: a habit decides between Twirl and CC Twister, and without one the resolver abstains.
import assert from "node:assert/strict";
import test from "node:test";
import { effectChoice } from "../src/index.js";
import type { EffectCandidate } from "../src/index.js";

const EFFECTS: ReadonlyArray<EffectCandidate> = [
  { matchName: "ADBE Twirl", displayName: "Twirl", category: "Distort" }, { matchName: "CC Twister", displayName: "CC Twister", category: "Distort" },
  { matchName: "ADBE Ripple", displayName: "Ripple", category: "Distort" }, { matchName: "ADBE Bulge", displayName: "Bulge", category: "Distort" },
];

function pick(phrase: string, habit?: Readonly<Record<string, number>>): string {
  const habits = habit === undefined ? undefined : { score: habit, note: Object.fromEntries(Object.keys(habit).map((key) => [key, "the user's usual choice"])) };
  return effectChoice(EFFECTS, habits).deterministic({ phrase });
}

const PHRASES = ["twist the logo", "twist", "give it a twist", "make it twist", "twisted look"];

test("a Twirl habit wins every twist wording, even against a CC Twister habit of the same size", () => {
  for (const phrase of PHRASES) {
    assert.equal(pick(phrase, { "ADBE Twirl": 1 }), "ADBE Twirl", phrase);
    assert.equal(pick(phrase, { "ADBE Twirl": 3, "CC Twister": 1 }), "ADBE Twirl", phrase);
  }
});

test("a CC Twister habit wins the twist wording", () => {
  for (const phrase of PHRASES) assert.equal(pick(phrase, { "CC Twister": 3 }), "CC Twister", phrase);
});

test("twist with no habit, or a habit for an unrelated effect, abstains", () => {
  for (const phrase of PHRASES) {
    assert.equal(pick(phrase), "none", phrase);
    assert.equal(pick(phrase, { "ADBE Ripple": 5 }), "none", phrase);
  }
});

test("naming an effect outright still beats a habit for another", () => {
  assert.equal(pick("twirl the logo", { "CC Twister": 5 }), "ADBE Twirl");
  assert.equal(pick("cc twister"), "CC Twister");
});
