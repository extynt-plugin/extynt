// Exact vocabulary targets hold by display name or match name and never dangle; a distinctive partial font name names the one family that extends it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { decodeJson } from "@extynt/decode";
import { compileConcepts, isExactTarget } from "../src/resolution-concepts.js";
import { pickEffect } from "../src/resolution-effects.js";
import { FIGURATIVE_WORDS } from "../src/resolution-effect-words-figurative.js";
import { HABIT_WORDS } from "../src/resolution-effect-words-habit.js";
import { LOOK_WORDS } from "../src/resolution-effect-words-look.js";
import { MOTION_WORDS } from "../src/resolution-effect-words-motion.js";
import { VAGUE_WORDS } from "../src/resolution-effect-words-vague.js";
import { PLAIN_COLOUR_WORDS } from "../src/resolution-effect-words-plain-colour.js";
import { PLAIN_LOOK_WORDS } from "../src/resolution-effect-words-plain-look.js";
import { PLAIN_SHAPE_WORDS } from "../src/resolution-effect-words-plain-shape.js";
import { profileOf } from "../src/resolution-profile.js";
import { holds } from "../src/resolution-score.js";
import { asEffectCandidate, effectCandidates, fontChoice } from "../src/index.js";
import type { Candidate } from "../src/candidate-search.js";
import type { FontRecord } from "../src/index.js";

const CATALOGUE_PATH = new URL("../../../../tools/chat-tests/fixtures/decisions/effects-catalogue.json", import.meta.url);

function catalogue(): ReadonlyArray<Candidate> {
  const decoded = decodeJson(readFileSync(CATALOGUE_PATH, "utf8"), effectCandidates);
  if (!decoded.ok) throw new Error(decoded.error.message);
  return decoded.value.map(asEffectCandidate);
}

test("every exact vocabulary target is held by at least one bundled effect", () => {
  const profiles = catalogue().map(profileOf);
  const rows = [...LOOK_WORDS, ...MOTION_WORDS, ...FIGURATIVE_WORDS, ...HABIT_WORDS, ...VAGUE_WORDS, ...PLAIN_LOOK_WORDS, ...PLAIN_COLOUR_WORDS, ...PLAIN_SHAPE_WORDS];
  const targets = compileConcepts(rows).flatMap((concept) => concept.targets).filter(isExactTarget);
  const dead = [...new Set(targets)].filter((target) => !profiles.some((profile) => holds(profile, target)));
  assert.deepEqual(dead, []);
});

test("an exact target is held through the match name when the display name differs", () => {
  const renamed: Candidate = { key: "ADBE Radial Blur", names: ["Spin Smear", "ADBE Radial Blur"], group: "Blur & Sharpen", title: "Spin Smear" };
  assert.equal(holds(profileOf(renamed), compileConcepts([["x", "=ADBE_Radial_Blur", 1]])[0]?.targets[0] ?? ""), true);
});

test("a request to fill with a gradient still picks the gradient ramp when the solid fill is set aside", () => {
  const list = catalogue().filter((entry) => ["ADBE Fill", "ADBE Ramp", "ADBE 4ColorGradient", "ADBE Gradient Wipe", "ADBE Tint"].includes(entry.key));
  assert.equal(pickEffect("flood the backdrop layer with a smooth gradient", list), "ADBE Ramp");
});

const record = (family: string): FontRecord => ({ family, style: "Regular", postScriptName: family.replace(/ /gu, "") });

function pick(phrase: string, families: ReadonlyArray<string>): string {
  return fontChoice(phrase, families.map(record)).deterministic({ phrase });
}

test("a partial name picks the family that extends it when the base is absent", () => {
  assert.equal(pick("bebas", ["Bebas Neue", "Arial", "Georgia"]), "Bebas Neue");
  assert.equal(pick("set it in avenir", ["Avenir Next", "Arial", "Georgia"]), "Avenir Next");
  assert.equal(pick("helvetica", ["Helvetica Neue", "Arial", "Georgia"]), "Helvetica Neue");
});

test("the base family wins over its extensions, and two different extensions abstain", () => {
  assert.equal(pick("avenir", ["Avenir", "Avenir Next", "Georgia"]), "Avenir");
  assert.equal(pick("roboto", ["Roboto Mono", "Roboto Slab", "Georgia"]), "none");
});
