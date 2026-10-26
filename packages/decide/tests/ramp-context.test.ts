// The word ramp read by its context: a colour or gradient ramp is the Gradient Ramp effect, a timing or easing ramp is not, and a bare ramp with no context abstains; in English, Spanish and German.
import assert from "node:assert/strict";
import test from "node:test";
import { rampReading, withoutBareRamp } from "../src/ramp-context.js";
import { featuresAsked, partsConfidence } from "../src/request-parts.js";
import { pickEffect } from "../src/resolution-effects.js";
import type { Candidate } from "../src/candidate-search.js";

const GRADIENT_EN = ["Add a gradient ramp behind the text", "Add a colour ramp to the background", "a ramp from blue to black behind the logo", "a background ramp, dark at the bottom", "make it a gradient ramp from red to yellow"];
const GRADIENT_ES = ["añade una rampa de color detrás del título", "una rampa de azul a negro en el fondo", "un degradado con rampa de color"];
const GRADIENT_DE = ["füge eine Farbverlauf-Ramp hinter dem Text hinzu", "eine Ramp von Blau nach Schwarz im Hintergrund", "eine Farbe-Ramp von Rot zu Gelb"];

const TIMING_EN = ["love it, now i want better curve management please. more ramp please", "more ramp on the pop-in animation", "give the pop a speed ramp", "ramp up the energy toward the end", "ramp it down at the end of the ease"];
const TIMING_ES = ["más rampa en la animación de entrada", "dale una rampa de velocidad al rebote", "rampa la aceleración del movimiento"];
const TIMING_DE = ["mehr Ramp bei der Animation des Logos", "Ramp die Beschleunigung der Bewegung", "eine Speed-Ramp auf die Einblendung"];

const AMBIGUOUS = ["more ramp please", "a bit more ramp", "más rampa por favor", "mehr Ramp bitte"];

const CANDIDATES: ReadonlyArray<Candidate> = [
  { key: "ADBE Glo2", names: ["Glow", "ADBE Glo2"], group: "Stylize", title: "Glow" },
  { key: "ADBE Ramp", names: ["Gradient Ramp", "ADBE Ramp"], group: "Generate", title: "Gradient Ramp" },
  { key: "ADBE Mosaic", names: ["Mosaic", "ADBE Mosaic"], group: "Stylize", title: "Mosaic" },
];

test("a colour or gradient ramp reads as gradient in English, Spanish and German", () => {
  for (const request of [...GRADIENT_EN, ...GRADIENT_ES, ...GRADIENT_DE]) assert.equal(rampReading(request), "gradient", request);
});

test("a ramp of timing, speed or easing on an animation reads as timing in English, Spanish and German", () => {
  for (const request of [...TIMING_EN, ...TIMING_ES, ...TIMING_DE]) assert.equal(rampReading(request), "timing", request);
});

test("a bare ramp with no context abstains: it is neither read as gradient nor as timing", () => {
  for (const request of AMBIGUOUS) assert.equal(rampReading(request), "ambiguous", request);
  assert.equal(rampReading("make the logo glow"), "none");
});

test("the gradient feature is asked only for a gradient ramp, never for a timing ramp or an ambiguous one", () => {
  assert.ok(featuresAsked("Add a gradient ramp behind the text").includes("ramp"));
  assert.ok(featuresAsked("una rampa de color detrás del título").includes("ramp"));
  assert.ok(featuresAsked("Eine Farbverlauf-Ramp hinter dem Text").includes("ramp"));
  for (const request of [...TIMING_EN, ...TIMING_ES, ...TIMING_DE, ...AMBIGUOUS]) assert.ok(!featuresAsked(request).includes("ramp"), request);
});

test("an ambiguous bare ramp lowers the confidence of the feature reading so the model decides", () => {
  assert.ok(partsConfidence("more ramp please", []) < 0.6);
  assert.ok(partsConfidence("more ramp on the pop-in animation", []) >= 0.6);
});

test("the effect a bare ramp names is removed unless it is a gradient, and a speed ramp keeps its name", () => {
  assert.equal(withoutBareRamp("more ramp please").replace(/\s+/gu, " ").trim(), "more please");
  assert.equal(withoutBareRamp("a gradient ramp behind the text"), "a gradient ramp behind the text");
  assert.equal(withoutBareRamp("give the pop a speed ramp"), "give the pop a speed ramp");
});

test("effect resolution picks the Gradient Ramp only for a gradient, and never for a timing or unclear ramp", () => {
  assert.equal(pickEffect("a gradient ramp behind the text", CANDIDATES), "ADBE Ramp");
  assert.equal(pickEffect("more ramp please", CANDIDATES), "none");
  assert.equal(pickEffect("more ramp on the pop-in animation", CANDIDATES), "none");
});
