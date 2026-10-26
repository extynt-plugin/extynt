// Pins that a colour-phase or hue control is found when its request is phrased as a rotation or a cycle of colour, and that quantifiers still refuse a whole-set request.
import assert from "node:assert/strict";
import test from "node:test";
import { NO_MATCH, controlChoice } from "../src/index.js";
import type { ControlCandidate } from "../src/index.js";

const GLOW: ReadonlyArray<ControlCandidate> = [
  { matchName: "ADBE Glo2-0001", displayName: "Glow Based On", valueType: "menu" },
  { matchName: "ADBE Glo2-0003", displayName: "Glow Radius", valueType: "slider" },
  { matchName: "ADBE Glo2-0007", displayName: "Glow Colors", valueType: "menu" },
  { matchName: "ADBE Glo2-0008", displayName: "Color Looping", valueType: "menu" },
  { matchName: "ADBE Glo2-0009", displayName: "Color Loops", valueType: "slider" },
  { matchName: "ADBE Glo2-0010", displayName: "Color Phase", valueType: "angle" },
  { matchName: "ADBE Glo2-0012", displayName: "Color A", valueType: "color" },
];

function pick(phrase: string): string {
  return controlChoice(GLOW).deterministic({ phrase, effect: "Glow" });
}

test("a rotation of the colour phase resolves to the colour phase control", () => {
  assert.equal(pick("rotate the colour phase"), "ADBE Glo2-0010");
  assert.equal(pick("spin the colour phase of the glow"), "ADBE Glo2-0010");
  assert.equal(pick("turn the color phase"), "ADBE Glo2-0010");
  assert.equal(pick("rota la fase del color"), "ADBE Glo2-0010");
});

test("cycling the hue round the wheel resolves to the colour phase control", () => {
  assert.equal(pick("cycle the hue round the wheel"), "ADBE Glo2-0010");
  assert.equal(pick("shift the hue phase"), "ADBE Glo2-0010");
  assert.equal(pick("rotate the colour phase all the way round"), "ADBE Glo2-0010");
});

test("a whole-set request still refuses, and an idiom with all does not", () => {
  assert.equal(pick("cycle the colour phase for every glow"), NO_MATCH);
  assert.equal(pick("rotate all the colour phases"), NO_MATCH);
  assert.equal(pick("rotate the colour phase every time"), "ADBE Glo2-0010");
});
