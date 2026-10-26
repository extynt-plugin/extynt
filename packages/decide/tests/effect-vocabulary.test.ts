// The effect words for the new vocabulary: four-colour gradients, radial zoom blur, keylight from a green backdrop, round iris wipes, German verwirbeln and Spanish barrido lineal.
import assert from "node:assert/strict";
import test from "node:test";
import { pickEffect } from "../src/resolution-effects.js";
import type { Candidate } from "../src/candidate-search.js";

const TITLES: Readonly<Record<string, string>> = { "ADBE Ramp": "Gradient Ramp", "ADBE 4ColorGradient": "4-Color Gradient" };

const candidate = (name: string, group: string): Candidate => ({ key: name, names: [name], group, title: TITLES[name] ?? name });

const GRADIENT: ReadonlyArray<Candidate> = [candidate("ADBE Ramp", "Generate"), candidate("ADBE 4ColorGradient", "Generate"), candidate("ADBE Tint", "Color Correction")];
const TWIRL: ReadonlyArray<Candidate> = [candidate("ADBE Twirl", "Distort"), candidate("ADBE Radial Blur", "Blur & Sharpen"), candidate("ADBE Turbulent Displace", "Distort"), candidate("ADBE Mosaic", "Stylize")];
const WIPE: ReadonlyArray<Candidate> = [candidate("ADBE Linear Wipe", "Transition"), candidate("ADBE Gradient Wipe", "Transition"), candidate("ADBE Iris Wipe", "Transition"), candidate("ADBE Radial Wipe", "Transition")];

test("a four-colour gradient with a colour in each corner picks the four-colour gradient, a plain two-colour gradient picks the Gradient Ramp", () => {
  assert.equal(pickEffect("four colour gradient with a colour in each corner", GRADIENT), "ADBE 4ColorGradient");
  assert.equal(pickEffect("four-colour gradient with one colour in each corner", GRADIENT), "ADBE 4ColorGradient");
  assert.equal(pickEffect("a two-colour linear gradient across the frame", GRADIENT), "ADBE Ramp");
});

test("twisting the picture around its middle or heart picks the Twirl, not the Radial Blur", () => {
  assert.equal(pickEffect("spin the picture into a swirl around its middle", TWIRL), "ADBE Twirl");
  assert.equal(pickEffect("wind the footage around its heart", TWIRL), "ADBE Twirl");
});

test("a German verwirbeln picks the Turbulent Displace", () => {
  assert.equal(pickEffect("das Bild verwirbeln", TWIRL), "ADBE Turbulent Displace");
});

test("a round opening from a point picks the Iris Wipe, and a Spanish barrido lineal picks the Linear Wipe", () => {
  assert.equal(pickEffect("reveal the picture through a round opening growing from the centre", WIPE), "ADBE Iris Wipe");
  assert.equal(pickEffect("un barrido lineal de izquierda a derecha sobre el título", WIPE), "ADBE Linear Wipe");
});

test("a colour that fades from top to bottom is a gradient, so it picks the Gradient Ramp", () => {
  assert.equal(pickEffect("a colour that fades from top to bottom", [candidate("ADBE Ramp", "Generate"), candidate("ADBE Fill", "Generate")]), "ADBE Ramp");
});

test("a plain fill with a colour is still the solid Fill", () => {
  assert.equal(pickEffect("fill it red", [candidate("ADBE Ramp", "Generate"), candidate("ADBE Fill", "Generate")]), "ADBE Fill");
});

test("a fill that fades is a gradient, so the solid Fill is never the answer to a fade", () => {
  const shortlist = [candidate("ADBE Ramp", "Generate"), candidate("ADBE Fill", "Generate"), candidate("ADBE Tint", "Color Correction")];
  assert.equal(pickEffect("fill the background with a colour that fades from top to bottom", shortlist), "ADBE Ramp");
  assert.equal(pickEffect("fill it red", shortlist), "ADBE Fill");
});
