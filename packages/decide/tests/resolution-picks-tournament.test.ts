// The tournament and the spec agree on described fonts, a bare weight names no font, and a loose effect word counts only with a matching habit.
import assert from "node:assert/strict";
import test from "node:test";
import { effectChoice, fontChoice, resolveFont } from "../src/index.js";
import type { EffectCandidate, FontRecord } from "../src/index.js";

const FAMILIES = [
  "Menlo", "Courier New", "Consolas", "Helvetica", "Arial", "Times New Roman", "Georgia", "Baskerville", "Yu Gothic", "Hiragino Sans", "Arial Rounded MT Bold", "Brush Script MT",
  "Bradley Hand", "Apple Chancery", "Franklin Gothic Medium", "Impact", "Stencil", "Futura", "Gill Sans", "Optima", "Verdana", "Tahoma", "Trebuchet MS", "Calibri", "Cambria",
  "Garamond", "Palatino", "Rockwell", "Papyrus", "Copperplate", "Marker Felt", "Noteworthy", "Comic Sans MS", "Avenir", "Didot", "Bodoni 72", "Charter", "Cochin", "Big Caslon",
  "Hoefler Text", "Lucida Grande", "Geneva", "Segoe UI", "Yu Mincho",
];

const INSTALLED: ReadonlyArray<FontRecord> = FAMILIES.map((family) => ({ family, style: "Regular", postScriptName: family.replace(/ /g, "") }));

const LOOKS: ReadonlyArray<readonly [accepted: ReadonlyArray<string>, phrases: ReadonlyArray<string>]> = [
  [["Menlo", "Courier New", "Consolas"], ["Schrift im Terminal-Stil", "Konsolenschrift, Monospace", "retro computer terminal text", "fuente de terminal", "police de console"]],
  [["Helvetica", "Arial"], ["eine neutrale Grotesk", "una tipografía grotesca", "グロテスクな書体"]],
  [["Times New Roman", "Georgia", "Baskerville", "Garamond", "Palatino", "Charter", "Cambria", "Big Caslon", "Cochin", "Hoefler Text"], ["eine elegante Antiqua", "une police à empattement comme un journal", "Serifenschrift wie in der Zeitung"]],
  [["Arial Rounded MT Bold", "Hiragino Sans", "Yu Gothic"], ["丸ゴシック体", "丸みのあるゴシック体"]],
  [["Brush Script MT", "Bradley Hand", "Apple Chancery", "Marker Felt", "Noteworthy"], ["eine kalligrafische Schrift", "tipografía de firma", "毛筆風の書体", "a signature script"]],
  [["Franklin Gothic Medium", "Impact", "Arial", "Arial Black"], ["fuente deportiva en negrita", "sporty bold lettering"]],
];

test("the tournament answers every described look with an installed family that fits", async () => {
  const misses: string[] = [];
  for (const [accepted, phrases] of LOOKS) {
    for (const phrase of phrases) {
      const { key } = await resolveFont(phrase, INSTALLED, { models: [], decisionTimeoutMs: 100 });
      if (!accepted.includes(key)) misses.push(`${phrase} -> ${key}`);
    }
  }
  assert.deepEqual(misses, []);
});

test("the tournament and the spec choice agree", async () => {
  for (const phrase of LOOKS.flatMap(([, phrases]) => phrases)) {
    const { key } = await resolveFont(phrase, INSTALLED, { models: [], decisionTimeoutMs: 100 });
    assert.equal(fontChoice(phrase, INSTALLED).deterministic({ phrase }), key, phrase);
  }
});

test("a bare weight or emphasis names no font", async () => {
  for (const phrase of ["make it heavier", "bolder please", "mach es dicker", "hazlo más pesado", "plus gras", "もっと太く", "make it thicker"]) {
    const { key } = await resolveFont(phrase, INSTALLED, { models: [], decisionTimeoutMs: 100 });
    assert.equal(key, "none", phrase);
  }
});

const EFFECTS: ReadonlyArray<EffectCandidate> = [
  { matchName: "ADBE Magnify", displayName: "Magnify", category: "Distort" }, { matchName: "ADBE Bulge", displayName: "Bulge", category: "Distort" },
  { matchName: "ADBE Glo2", displayName: "Glow", category: "Stylize" }, { matchName: "ADBE Lens Flare", displayName: "Lens Flare", category: "Generate" },
  { matchName: "ADBE Twirl", displayName: "Twirl", category: "Distort" }, { matchName: "ADBE Ripple", displayName: "Ripple", category: "Distort" },
];

function pick(phrase: string, habit?: string): string {
  const habits = habit === undefined ? undefined : { score: { [habit]: 5 }, note: { [habit]: "the user's usual choice" } };
  return effectChoice(EFFECTS, habits).deterministic({ phrase });
}

const HABITUAL: ReadonlyArray<readonly [phrase: string, habit: string]> = [
  ["zoom in look", "ADBE Magnify"], ["ズーム", "ADBE Magnify"], ["sparkle", "ADBE Glo2"], ["destello", "ADBE Lens Flare"], ["膨らみ", "ADBE Bulge"],
  ["verdrehen", "ADBE Twirl"], ["twisted look", "ADBE Twirl"], ["ねじれ", "ADBE Twirl"],
];

test("a loose effect word with a matching habit picks the habitual effect", () => {
  for (const [phrase, habit] of HABITUAL) assert.equal(pick(phrase, habit), habit, phrase);
});

test("the same loose word without a habit answers none", () => {
  for (const [phrase] of HABITUAL) assert.equal(pick(phrase), "none", phrase);
});
