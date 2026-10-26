// General phrasings for the offline effect and control resolvers: object nouns, uncertain looks, quantified controls and distortion synonyms.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { decodeJson } from "@extynt/decode";
import { asEffectCandidate, effectCandidates } from "../src/effect-choice.js";
import { pickAttribute } from "../src/resolution-attributes.js";
import { pickEffect } from "../src/resolution-effects.js";
import type { Candidate } from "../src/candidate-search.js";

const CATALOGUE = join(import.meta.dirname, "..", "..", "..", "..", "tools", "chat-tests", "fixtures", "decisions", "effects-catalogue.json");
const decoded = decodeJson(readFileSync(CATALOGUE, "utf8"), effectCandidates);
if (!decoded.ok) throw new Error(`effects-catalogue.json: ${decoded.error.message}`);
const candidates = decoded.value.map(asEffectCandidate);

function effectFor(phrase: string): string {
  return pickEffect(phrase, candidates);
}

test("an object noun does not steer the effect search", () => {
  assert.equal(effectFor("pixelate the face"), "ADBE Mosaic");
  assert.equal(effectFor("pixelate the logo"), "ADBE Mosaic");
  assert.equal(effectFor("glow the numbers"), "ADBE Glo2");
});

test("an uncertain look resolves to none rather than a nearby effect", () => {
  assert.equal(effectFor("a sparkle look"), "none");
  assert.equal(effectFor("blur it"), "none");
});

test("distortion concepts map to the AE-bundled Distort effects", () => {
  assert.equal(effectFor("bulge"), "ADBE Bulge");
  assert.equal(effectFor("zoom bulge"), "ADBE Bulge");
  assert.equal(effectFor("swirl the image"), "ADBE Twirl");
  assert.equal(effectFor("twirl the text"), "ADBE Twirl");
});

test("a quantified control request resolves to none", () => {
  const owner = "Gaussian Blur";
  const controls: ReadonlyArray<Candidate> = [
    { key: "Blurriness", names: ["Blurriness"], group: "", title: "Blurriness" },
    { key: "Blur Dimensions", names: ["Blur Dimensions"], group: "", title: "Blur Dimensions" },
  ];
  assert.equal(pickAttribute("blurriness on every mask", owner, controls), "none");
  assert.equal(pickAttribute("set all masks blurriness to 5", owner, controls), "none");
});
