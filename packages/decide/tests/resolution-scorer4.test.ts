// The scorer breaks bare-kind ties by the profile's preferred member, tells names that differ by a function word apart, prefers the unqualified name and abstains when a strength word's own control is gone.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { decodeJson } from "@extynt/decode";
import { compileConcepts } from "../src/resolution-concepts.js";
import { pickAttribute } from "../src/resolution-attributes.js";
import { pickEffect } from "../src/resolution-effects.js";
import { readRequest, scoreCandidates, winnerOf } from "../src/resolution-score.js";
import type { Tuning } from "../src/resolution-score.js";
import { asEffectCandidate, effectCandidates } from "../src/index.js";
import type { Candidate } from "../src/candidate-search.js";

const CATALOGUE_PATH = new URL("../../../../tools/chat-tests/fixtures/decisions/effects-catalogue.json", import.meta.url);

function catalogue(): ReadonlyArray<Candidate> {
  const decoded = decodeJson(readFileSync(CATALOGUE_PATH, "utf8"), effectCandidates);
  if (!decoded.ok) throw new Error(decoded.error.message);
  return decoded.value.map(asEffectCandidate);
}

const effect = (matchName: string, title: string, group: string): Candidate => ({ key: matchName, names: [matchName, title], group, title });

test("a kind word with an object breaks its tie by the preferred member and a lone kind word stays ambiguous", () => {
  const list = catalogue();
  assert.equal(pickEffect("bevel the text", list), "ADBE Bevel Alpha");
  assert.equal(pickEffect("blur the background", list), "ADBE Gaussian Blur 2");
  assert.equal(pickEffect("blur the numbers", list), "ADBE Gaussian Blur 2");
  assert.equal(pickEffect("blur it", list), "none");
  assert.equal(pickEffect("bevel", list), "none");
  assert.equal(pickEffect("blur", list), "none");
});

const TWIN_TUNING: Tuning = {
  concepts: compileConcepts([["recolour exactly, plain recolour", "=change_color", 5], ["swap colour to another, recolour to a target", "=change_to_color", 5]]),
  context: new Set(), strict: 4, denyNames: true, attribute: false,
};

const TWINS: ReadonlyArray<Candidate> = [effect("ADBE Change To Color", "Change to Color", "Color Correction"), effect("ADBE Change Color", "Change Color", "Color Correction"), effect("ADBE Tint", "Tint", "Color Correction")];

function twinPick(phrase: string): string {
  return winnerOf(scoreCandidates(readRequest(phrase, TWIN_TUNING), TWINS, TWIN_TUNING, {}));
}

test("exact targets keep the function word that tells two catalogue names apart", () => {
  assert.equal(twinPick("plain recolour"), "ADBE Change Color");
  assert.equal(twinPick("recolour to a target"), "ADBE Change To Color");
});

test("an exact target without a twin still holds a name that has a function word", () => {
  const alone = TWINS.filter((entry) => entry.key !== "ADBE Change Color");
  const tuning: Tuning = { ...TWIN_TUNING, concepts: compileConcepts([["recolour exactly", "=change_color", 5]]) };
  assert.equal(winnerOf(scoreCandidates(readRequest("recolour exactly", tuning), alone, tuning, {})), "ADBE Change To Color");
});

test("the name without an unsaid qualifier wins and the qualifier wins when it is said", () => {
  const list = [effect("ADBE Radial Blur", "Radial Blur", "Blur & Sharpen"), effect("ADBE Radial Fast Blur", "Radial Fast Blur", "Blur & Sharpen"), effect("ADBE Gaussian Blur 2", "Gaussian Blur", "Blur & Sharpen"), effect("ADBE Box Blur2", "Box Blur", "Blur & Sharpen")];
  assert.equal(pickEffect("spin blur", list), "ADBE Radial Blur");
  assert.equal(pickEffect("radial blur", list), "ADBE Radial Blur");
  assert.equal(pickEffect("fast radial blur", list), "ADBE Radial Fast Blur");
});

const control = (title: string, index: number): Candidate => ({ key: `ADBE Glo2-000${index}`, names: [title], group: "Property", title });

const GLOW = ["Glow Based On", "Glow Threshold", "Glow Radius", "Glow Intensity", "Composite Original"].map(control);

test("a strength word picks the intensity control and abstains rather than falling to the radius", () => {
  const without = GLOW.filter((entry) => entry.title !== "Glow Intensity");
  assert.equal(pickAttribute("glow a bit stronger", "Glow", GLOW), "ADBE Glo2-0003");
  assert.equal(pickAttribute("glow a bit stronger", "Glow", without), "none");
  assert.equal(pickAttribute("make it more intense", "Glow", without), "none");
  assert.equal(pickAttribute("make the glow wider", "Glow", without), "ADBE Glo2-0002");
});
