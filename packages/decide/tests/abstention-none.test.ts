// Tests for the confidence of a "none" answer: a denial is decisive, a request whose words no candidate holds is unsure, a tie between same-family candidates is unsure, and a font name only partly named or a look that fits nothing is not a sure pick.
import assert from "node:assert/strict";
import test from "node:test";
import { decide, effectChoice, fontChoice } from "../src/index.js";

const INSTALLED = [
  { matchName: "ADBE Gaussian Blur 2", displayName: "Gaussian Blur", category: "Blur & Sharpen" },
  { matchName: "ADBE Box Blur2", displayName: "Box Blur", category: "Blur & Sharpen" },
  { matchName: "ADBE Glo2", displayName: "Glow", category: "Stylize" },
];

const FONTS = [
  { family: "Helvetica Neue", style: "Regular", postScriptName: "HelveticaNeue" },
  { family: "Roboto", style: "Regular", postScriptName: "Roboto-Regular" },
  { family: "Roboto Condensed", style: "Bold", postScriptName: "RobotoCondensed-Bold" },
];

test("a none that rests on a denial is a decisive, answered none", async () => {
  const result = await decide({ phrase: "no glow" }, effectChoice(INSTALLED));
  assert.deepEqual([result.label, result.abstained], ["none", false]);
  assert.ok(result.confidence >= 0.6, `${result.confidence}`);
});

test("a none from words no candidate holds abstains and is less sure than a request with no content words", async () => {
  const unknown = await decide({ phrase: "zzqx wobble" }, effectChoice(INSTALLED));
  const empty = await decide({ phrase: "the" }, effectChoice(INSTALLED));
  assert.deepEqual([unknown.label, unknown.abstained], ["none", true]);
  assert.ok(unknown.confidence < 0.6 && unknown.confidence < empty.confidence, `${unknown.confidence} vs ${empty.confidence}`);
});

test("a none from a tie between same-family candidates stays unsure", async () => {
  const result = await decide({ phrase: "blur" }, effectChoice(INSTALLED));
  assert.deepEqual([result.label, result.abstained], ["none", true]);
  assert.ok(result.confidence < 0.6, `${result.confidence}`);
});

test("a font named only in part is less sure than the same family named in full", async () => {
  const full = await decide({ phrase: "Roboto Condensed" }, fontChoice("Roboto", FONTS));
  const partial = await decide({ phrase: "Roboto Condensed Lite" }, fontChoice("Roboto", FONTS));
  assert.ok(partial.confidence < full.confidence, `${partial.confidence} should be below ${full.confidence}`);
});

test("a font look that fits no installed family abstains", async () => {
  const result = await decide({ phrase: "condensed bold" }, fontChoice("Roboto", FONTS));
  assert.equal(result.abstained, true);
});
