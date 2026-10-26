// Pins the review pre-screen's reading of layer start phrasing, literal transform values, visual-sounding layer names, explanatory purpose clauses and create_layer: each is proven only when its own receipt is confirmed, and a look, judgement or motion in the request keeps its review.
import assert from "node:assert/strict";
import test from "node:test";
import { REVIEW_PROVEN } from "../src/index.js";
import type { ReviewScreenCase } from "../src/index.js";

function state(goal: string, operations: ReadonlyArray<string>, specs: ReadonlyArray<string> = []): ReviewScreenCase {
  return { goal, specs, batches: 1, exact: 1, approximate: 0, unconfirmed: 0, operations };
}

function proven(value: ReviewScreenCase): boolean {
  return REVIEW_PROVEN.deterministic(value);
}

test("a layer that starts at a frame or time is proven by its timing receipt in several phrasings", () => {
  assert.equal(proven(state("The title layer starts at frame 48", ["set_layer_timing"])), true);
  assert.equal(proven(state("Make the subtitle begin at 3 seconds", ["set_layer_timing"])), true);
  assert.equal(proven(state("Set the Sky layer in point at frame 12", ["set_layer_timing"], ["In point at 12"])), true);
  assert.equal(proven(state("Der Untertitel startet bei Frame 90", ["set_layer_timing"])), true);
  assert.equal(proven(state("The logo starts on frame 24", ["set_layer_timing"])), true);
  assert.equal(proven(state("The logo starts on frame 24", ["add_marker"])), false);
  assert.equal(proven(state("Die Ebene Schleier beginnt bei 4 Sekunden", ["set_layer_timing"])), true);
});

test("a start phrase without its timing receipt is never proven", () => {
  assert.equal(proven(state("The title layer starts at frame 48", ["set_layer_property"])), false);
  assert.equal(proven(state("Make the subtitle begin at 3 seconds", ["set_layer_property"])), false);
  assert.equal(proven({ ...state("The title layer starts at frame 48", ["set_layer_timing"]), approximate: 1 }), false);
  assert.equal(proven(state("The title layer starts at frame 48 and fades in", ["set_layer_timing"])), false);
});

test("a frame number with no start phrase still needs an alignment receipt, and a sync claim keeps its review", () => {
  assert.equal(proven(state("Put the caption on frame 48", ["set_layer_property"])), false);
  assert.equal(proven(state("Time the cut so the beat lands on frame 48", ["set_layer_timing"])), false);
});

test("literal transform values for several properties in one clause are proven", () => {
  assert.equal(proven(state("Set the Ebene Dunst position to X 200, Y 300 and scale to 120 percent", ["set_layer_property"])), true);
  assert.equal(proven(state("Set the anchor point of the Halo layer to 0, 0 and the opacity to 60 percent", ["set_layer_property"])), true);
  assert.equal(proven(state("Set the rotation of the Lichter layer to 15 degrees and scale to 90 percent", ["set_layer_property"])), true);
});

test("Japanese transform property words with a literal number are proven", () => {
  assert.equal(proven(state("タイトルのスケールを80%に", ["set_layer_property"])), true);
  assert.equal(proven(state("ロゴの不透明度を60%に", ["set_layer_property"])), true);
  assert.equal(proven(state("ロゴのアンカーポイントを0, 0に、回転を15度に", ["set_layer_property"])), true);
});

test("a transform value with a look word in its layer name is not a look", () => {
  assert.equal(proven(state("Set the Shadow layer scale to 110 percent and opacity to 40 percent", ["set_layer_property"])), true);
  assert.equal(proven(state("Set the Sky layer rotation to 30 degrees", ["set_layer_property"])), true);
});

test("visual-sounding names in rename, call and name clauses do not veto a proven rename", () => {
  assert.equal(proven(state("Renomme le calque Ombre en Lumiere", ["set_layer_name"])), true);
  assert.equal(proven(state("Renomme le calque Glow en Halo", ["set_layer_name"])), true);
  assert.equal(proven(state("Call the Glow null Halo", ["set_layer_name"])), true);
  assert.equal(proven(state("Call the Background null Anchor", ["set_layer_name"])), true);
  assert.equal(proven(state("Llama la capa Sombra Principal", ["set_layer_name"])), true);
  assert.equal(proven(state("Benenne die Ebene Himmel in Wolken um", ["set_layer_name"])), true);
  assert.equal(proven(state("Rename the layer to Shadow", ["set_layer_name"])), true);
  assert.equal(proven(state("Name the Sky layer Clouds", ["set_layer_name"])), true);
});

test("a visual-sounding name still keeps its review when the clause asks for a look", () => {
  assert.equal(proven(state("Renomme le calque Glow en Halo pour la rendre plus jolie", ["set_layer_name"])), false);
  assert.equal(proven(state("Rename the Sky layer to Clouds with a warm glow", ["set_layer_name"])), false);
  assert.equal(proven(state("Call the Glow null Halo and make the glow brighter", ["set_layer_name", "set_effect_control"])), false);
});

test("an explanatory purpose clause does not veto a structural edit", () => {
  assert.equal(proven(state("Name the Glow layer Halo so the expression can find it", ["set_layer_name"])), true);
  assert.equal(proven(state("Rename the Sky layer to Ciel so I can find it later", ["set_layer_name"])), true);
  assert.equal(proven(state("Rename the Logo layer to Mark para encontrarlo", ["set_layer_name"])), true);
  assert.equal(proven(state("Benenne die Ebene Logo in Mark um, damit ich sie wiederfinde", ["set_layer_name"])), true);
  assert.equal(proven(state("Set the Glow layer position to 100, 200 so the expression can find it", ["set_layer_property"])), true);
});

test("a purpose clause that asks for a look or a judgement still vetoes", () => {
  assert.equal(proven(state("Rename the Glow layer to Halo so it pops", ["set_layer_name"])), false);
  assert.equal(proven(state("Rename the layer to Mark so it feels warmer", ["set_layer_name"])), false);
  assert.equal(proven(state("Set the title position to 100, 200 so it feels smooth", ["set_layer_property"])), false);
  assert.equal(proven(state("Renombra la capa Luz a Principal para que se vea bonita", ["set_layer_name"])), false);
});

test("creating a null or solid layer is never proven, whatever its name", () => {
  assert.equal(proven(state("Create a null layer called Controller", ["create_layer"])), false);
  assert.equal(proven(state("Create a null layer called Glow", ["create_layer"])), false);
  assert.equal(proven(state("Create a solid layer named Sky", ["create_layer", "set_layer_name"])), false);
});

test("a camera or a light that exists, with a z value, is proven in six languages and a look keeps its review", () => {
  assert.equal(proven(state("Add a camera and put it at z -1200", ["create_layer", "set_layer_property"])), true);
  assert.equal(proven(state("Asegúrate de que haya una luz en la composición", ["create_layer"])), true);
  assert.equal(proven(state("カメラを追加してZ位置を-1200にして", ["create_layer", "set_layer_property"])), true);
  assert.equal(proven(state("确保合成里有一盏灯光", ["create_layer"])), true);
  assert.equal(proven(state("Add a warm light on the left of the logo", ["create_layer", "set_layer_property"])), false);
  assert.equal(proven(state("Add a camera so the scene feels cinematic", ["create_layer"])), false);
  assert.equal(proven(state("Add a camera", ["create_layer", "ensure_effect"])), false);
});

test("an effect control given as a number is proven unless a look, colour or feel is named", () => {
  const effect = ["ensure_effect", "set_effect_control"];
  assert.equal(proven(state("Add a drop shadow to the card with a distance of 20", effect)), true);
  assert.equal(proven(state("Füge der Karte einen Schlagschatten mit Abstand 20 hinzu", effect)), true);
  assert.equal(proven(state("カードにドロップシャドウを追加して、距離を20にして", effect)), true);
  assert.equal(proven(state("Add a blue glow with radius 30", effect)), false);
  assert.equal(proven(state("Add a dark shadow, distance 10", effect)), false);
  assert.equal(proven(state("Add a drop shadow so the card feels lifted", effect)), false);
});

test("a font size, a case, a work area, a comp rename and a blend mode are exact settings", () => {
  assert.equal(proven(state("Setze die Schriftgröße der Überschrift auf 72", ["set_text_document"])), true);
  assert.equal(proven(state("Make the title read SALE ENDS SOON in capitals", ["set_text_document"])), true);
  assert.equal(proven(state("Règle la zone de travail de 1 seconde à 6 secondes", ["set_composition_settings"])), true);
  assert.equal(proven(state("Benenne die Komposition in Abspann um", ["set_composition_settings"])), true);
  assert.equal(proven(state("把所有图层的混合模式设为正片叠底", ["set_layer_property"])), true);
  assert.equal(proven(state("Set the font size so the headline looks balanced", ["set_text_document"])), false);
  assert.equal(proven(state("Set the blend mode of every layer to Screen so the shot glows", ["set_layer_property"])), false);
});
