// Pins the deterministic decision gaps: plain structural edits proven by their receipts, a wanted part after a negated one, text animators and mattes, hand-drawn marks, casual amount requests, letter spacing and habit-only family words.
import assert from "node:assert/strict";
import test from "node:test";
import { DRAWN_SCENE_REQUEST, REQUEST_PARTS, REVIEW_PROVEN, effectChoice, featuresAsked, propertyChoice } from "../src/index.js";
import type { EffectCandidate, FeatureId, PropertyCandidate, ReviewScreenCase } from "../src/index.js";

function proven(goal: string, operations: ReadonlyArray<string>, specs: ReadonlyArray<string> = []): boolean {
  const state: ReviewScreenCase = { goal, specs, batches: 1, exact: 3, approximate: 0, unconfirmed: 0, operations };
  return REVIEW_PROVEN.deterministic(state);
}

function parts(request: string): ReadonlyArray<FeatureId> {
  return featuresAsked(request);
}

function drawn(request: string): string {
  return DRAWN_SCENE_REQUEST.deterministic({ request });
}

function property(title: string, group: string): PropertyCandidate {
  return { key: `P/${title}`, title, group };
}

const GLOW = [property("Glow Threshold", "Effect Controls"), property("Glow Radius", "Effect Controls"), property("Glow Intensity", "Effect Controls"), property("Glow Colors", "Effect Controls")];
const SHADOW = [property("Shadow Color", "Effect Controls"), property("Opacity", "Effect Controls"), property("Direction", "Effect Controls"), property("Distance", "Effect Controls"), property("Softness", "Effect Controls")];
const BLUR = [property("Blurriness", "Effect Controls"), property("Blur Dimensions", "Effect Controls"), property("Repeat Edge Pixels", "Effect Controls")];
const TEXT = [property("Font Size", "Character"), property("Text Tracking", "Character"), property("Fill Color", "Character"), property("Leading", "Paragraph")];

function pick(candidates: ReadonlyArray<PropertyCandidate>, target: string, phrase: string): string {
  return propertyChoice(candidates).deterministic({ phrase, target });
}

test("renames, in and out points, trims, locks and hides, and numeric text tracking are proven by exact receipts", () => {
  assert.equal(proven("Rename the layers to match the shot list", ["set_layer_name"], ["Layers named S01 to S06 as in the shot list"]), true);
  assert.equal(proven("Rename the layers Shot 1, Shot 2 and Shot 3", ["set_layer_name"]), true);
  assert.equal(proven("Move the in point of the title layer to 2 seconds", ["set_layer_timing"]), true);
  assert.equal(proven("Trim the layer's end so it stops at 3s", ["set_layer_timing"]), true);
  assert.equal(proven("Lock the logo layer and hide the guide layers", ["set_layer_attribute"]), true);
  assert.equal(proven("Solo the title layer", ["set_layer_attribute"]), true);
  assert.equal(proven("Set the text tracking to 50", ["set_layer_property"]), true);
  assert.equal(proven("Set the tracking of the title to 120", ["set_text_document"]), true);
});

test("a look, a feel, a reference or an approximate read-back still keeps the review", () => {
  assert.equal(proven("Rename the layers to match the style of the reference", ["set_layer_name"]), false);
  assert.equal(proven("Set the tracking to 50 so the title feels airy", ["set_layer_property"]), false);
  assert.equal(proven("Move the in point to 2 seconds and make it feel punchy", ["set_layer_timing"]), false);
  assert.equal(proven("Mute the audio so it feels calm", ["set_layer_attribute"]), false);
  assert.equal(REVIEW_PROVEN.deterministic({ goal: "Lock all the layers", specs: [], batches: 1, exact: 2, approximate: 1, unconfirmed: 0, operations: ["set_layer_attribute"] }), false);
});

test("a wanted part after a negated one is kept, in English and Spanish", () => {
  assert.deepEqual(parts("Skip the blur, only a glow on the title"), ["glow"]);
  assert.deepEqual(parts("Without the glow, just a drop shadow please"), ["drop-shadow"]);
  assert.deepEqual(parts("Sin sombra, solo un resplandor"), ["glow"]);
  assert.deepEqual(parts("Make the title wiggle, no glow, just a shadow"), ["drop-shadow", "wiggle"]);
});

test("a refusal still reaches its own list and a substitute", () => {
  assert.deepEqual(parts("No glow, blur or shadow"), []);
  assert.deepEqual(parts("Add a drop shadow instead of a glow"), ["drop-shadow"]);
});

test("a Spanish text animator by characters or letters is the text-animator part", () => {
  assert.deepEqual(parts("Añade un animador de caracteres al título"), ["text-animator"]);
  assert.deepEqual(parts("Crea un animador de letras"), ["text-animator"]);
});

test("matting a layer with the text is only a text matte, while a plain track matte stays both", () => {
  assert.deepEqual(parts("Matte the footage with the text so it shows through the letters"), ["text-matte"]);
  assert.deepEqual(parts("Use a track matte so the video only shows inside the letters"), ["matte", "text-matte"]);
  assert.equal(REQUEST_PARTS.deterministic({ request: "Matte the clip with the text" }).includes("matte"), false);
});

test("a wavy line, a squiggle, a scribble or a hand-drawn mark is a drawn scene, a plain line is not", () => {
  assert.equal(drawn("Draw a wavy line under the title"), "drawn-scene");
  assert.equal(drawn("Add a scribble over the logo"), "drawn-scene");
  assert.equal(drawn("Draw a hand-drawn circle around the word SALE"), "drawn-scene");
  assert.equal(drawn("Dibuja una línea ondulada"), "drawn-scene");
  assert.equal(drawn("Zeichne eine Wellenlinie unter dem Titel"), "drawn-scene");
  assert.equal(drawn("Draw a thin line across the screen under the title"), "arranged-layers");
  assert.equal(drawn("Use a handwritten font and a line of text"), "arranged-layers");
});

test("more or less of an effect, in casual words, picks the effect's main amount control", () => {
  assert.equal(pick(GLOW, "Glow", "more glow pls"), "P/Glow Intensity");
  assert.equal(pick(GLOW, "Glow", "a bit less glow"), "P/Glow Intensity");
  assert.equal(pick(BLUR, "Gaussian Blur", "less blur"), "P/Blurriness");
  assert.equal(pick(BLUR, "Gaussian Blur", "more blur pls"), "P/Blurriness");
});

test("too strong, tone it down and dial it back pick the strength control", () => {
  assert.equal(pick(GLOW, "Glow", "the glow is too strong, tone it down"), "P/Glow Intensity");
  assert.equal(pick(BLUR, "Gaussian Blur", "dial it back"), "P/Blurriness");
  assert.equal(pick(SHADOW, "Drop Shadow", "shadow is too strong, dial it back"), "P/Opacity");
  assert.equal(pick(GLOW, "Glow", "dial the glow back a bit"), "P/Glow Intensity");
});

test("spreading letters apart picks tracking, not font size, in English, German and Spanish", () => {
  assert.equal(pick(TEXT, "Text layer", "spread the letters apart"), "P/Text Tracking");
  assert.equal(pick(TEXT, "Text layer", "Buchstaben weiter auseinander"), "P/Text Tracking");
  assert.equal(pick(TEXT, "Text layer", "Laufweite vergrößern"), "P/Text Tracking");
  assert.equal(pick(TEXT, "Text layer", "más espacio entre letras"), "P/Text Tracking");
  assert.equal(pick(TEXT, "Text layer", "make the text bigger"), "P/Font Size");
});

const COLOUR_EFFECTS: ReadonlyArray<EffectCandidate> = [
  { matchName: "ADBE Tint", displayName: "Tint", category: "Color Correction" },
  { matchName: "ADBE Change Color", displayName: "Change Color", category: "Color Correction" },
  { matchName: "ADBE Colorama", displayName: "Colorama", category: "Color Correction" },
  { matchName: "ADBE HUE SATURATION", displayName: "Hue/Saturation", category: "Color Correction" },
];

function habitual(matchName: string): { readonly score: Readonly<Record<string, number>>; readonly note: Readonly<Record<string, string>> } {
  return { score: { [matchName]: 5 }, note: { [matchName]: "the user's usual choice" } };
}

test("a vague family phrase picks the habitual effect and abstains without a habit", () => {
  const phrase = "the colour thing";
  assert.equal(effectChoice(COLOUR_EFFECTS, habitual("ADBE Tint")).deterministic({ phrase }), "ADBE Tint");
  assert.equal(effectChoice(COLOUR_EFFECTS, habitual("ADBE HUE SATURATION")).deterministic({ phrase: "that colour thing again" }), "ADBE HUE SATURATION");
  assert.equal(effectChoice(COLOUR_EFFECTS, habitual("ADBE Tint")).deterministic({ phrase: "das Farbdings" }), "ADBE Tint");
  assert.equal(effectChoice(COLOUR_EFFECTS).deterministic({ phrase }), "none");
});
