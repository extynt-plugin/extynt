// Pins the review pre-screen's structural reading: rename verbs in several languages, literal coordinates, keyframe removal and beat or timing claims are proven by their receipts, while any look, judgement or purpose word still keeps the review.
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

test("naming verbs in English, Spanish, German, French and Japanese are proven, with the object as a layer name", () => {
  assert.equal(proven(state("Name the title layer Hero", ["set_layer_name"])), true);
  assert.equal(proven(state("Call the logo layer Mark", ["set_layer_name"])), true);
  assert.equal(proven(state("Label the glow layer as Halo", ["set_layer_name"])), true);
  assert.equal(proven(state("Title the layer Shadow Main", ["set_layer_name"])), true);
  assert.equal(proven(state("Nombra la capa Sombra como Principal", ["set_layer_name"])), true);
  assert.equal(proven(state("Llama la capa de fondo Principal", ["set_layer_name"])), true);
  assert.equal(proven(state("Nenne die Ebene Glanz Key", ["set_layer_name"])), true);
  assert.equal(proven(state("Nomme le calque Ombre Principal", ["set_layer_name"])), true);
  assert.equal(proven(state("Appelle le calque Lumiere Key", ["set_layer_name"])), true);
  assert.equal(proven(state("背景レイヤーの名前をHeroに変更", ["set_layer_name"])), true);
  assert.equal(proven(state("ロゴレイヤーの名を Mark に変更", ["set_layer_name"])), true);
  assert.equal(proven(state("グローのレイヤーをHaloという名前にして", ["set_layer_name"])), true);
});

test("literal coordinates are proven in every language, including a split x and y pair", () => {
  assert.equal(proven(state("Put the title at x 960 and y 540", ["set_layer_property"])), true);
  assert.equal(proven(state("Place the logo at 960, 540", ["set_layer_property"])), true);
  assert.equal(proven(state("Pon el logo en x 960 y 540", ["set_layer_property"])), true);
  assert.equal(proven(state("Setze das Logo auf x 960 und y 540", ["set_layer_property"])), true);
  assert.equal(proven(state("Place le titre à x 100 et y 200", ["set_layer_property"])), true);
  assert.equal(proven(state("ロゴをx 960 y 540に配置", ["set_layer_property"])), true);
});

test("specs that only restate coordinates on a layer named after a look are not layout judgements", () => {
  assert.equal(proven(state("Set the glow layer position to 100, 200", ["set_layer_property"], ["Glow at 100, 200"])), true);
  assert.equal(proven(state("Set the title position to 100, 200", ["set_layer_property"], ["Text at 100, 200"])), true);
});

test("removing keyframes is proven whatever the layer is called, in several languages", () => {
  assert.equal(proven(state("Remove all keyframes from the logo", ["delete_keyframes"])), true);
  assert.equal(proven(state("Delete the keyframes on the title", ["delete_keyframes"])), true);
  assert.equal(proven(state("Clear all keyframes from the background layer", ["delete_keyframes"])), true);
  assert.equal(proven(state("Entferne alle Keyframes vom Logo", ["delete_keyframes"])), true);
  assert.equal(proven(state("Supprime toutes les images clés du logo", ["delete_keyframes"])), true);
  assert.equal(proven(state("ロゴのキーフレームを削除", ["delete_keyframes"])), true);
  assert.equal(proven(state("Remove all keyframes from the glow layer", ["set_layer_property"])), true);
  assert.equal(proven(state("Remove the keyframes from the title", ["delete_keyframes"], ["No keyframes on the background"])), true);
  assert.equal(proven(state("Entferne die Keyframes vom Titel", ["delete_keyframes"], ["Keine Keyframes auf dem Logo"])), true);
});

test("a beat or timing claim is proven only with a timing receipt", () => {
  assert.equal(proven(state("Add a marker at each beat of the 120 bpm track for 8 bars", ["add_marker"])), true);
  assert.equal(proven(state("Set the reveal to start at the downbeat", ["set_layer_timing"], ["Beat lands on the reveal"])), true);
  assert.equal(proven(state("Keyframe the title opacity on the hit at frame 48", ["set_keyframes"], ["the hit lands on frame 48"])), true);
  assert.equal(proven(state("Rename the logo layer to Mark", ["set_layer_name"], ["Beat lands on the reveal"])), false);
  assert.equal(proven(state("Set the title position to 100, 200", ["set_layer_property"], ["the hit lands on frame 48"])), false);
  assert.equal(proven(state("Name the reveal layer Hit", ["set_layer_name"], ["Reveal syncs to the downbeat"])), false);
  assert.equal(proven(state("Put the logo at 960, 540 on the beat", ["set_layer_property"])), false);
  assert.equal(proven(state("Make the reveal bounce on the beat", ["animate_property"])), false);
});

test("look, judgement and purpose words still keep the review, even inside structural clauses", () => {
  assert.equal(proven(state("Make the background feel warmer", ["set_layer_property"])), false);
  assert.equal(proven(state("Make the logo pop", ["set_layer_property"])), false);
  assert.equal(proven(state("Call the logo layer Mark and make it pop", ["set_layer_name"])), false);
  assert.equal(proven(state("Label the glow layer Halo and make the glow look nicer", ["set_layer_name"])), false);
  assert.equal(proven(state("Name the background layer Stage so the frame feels balanced", ["set_layer_name"])), false);
  assert.equal(proven(state("Rename the glow layer to Halo and make it glow more", ["set_layer_name"])), false);
  assert.equal(proven(state("Put the logo at 960, 540 and make it balanced", ["set_layer_property"])), false);
  assert.equal(proven(state("Put the title at x 960 and y 540 so it feels centred", ["set_layer_property"])), false);
  assert.equal(proven(state("Put the logo at 960, 540, make it warmer", ["set_layer_property"])), false);
  assert.equal(proven(state("Set the logo position to 960, 540", ["set_layer_property"], ["Logo centred at 960, 540"])), false);
  assert.equal(proven(state("Remove all keyframes from the logo and make the background glow", ["delete_keyframes"])), false);
  assert.equal(proven(state("Remove the keyframes from the logo, make it warmer", ["delete_keyframes"])), false);
  assert.equal(proven(state("Remove all keyframes from the title", ["delete_keyframes"], ["Title is warm and cinematic"])), false);
  assert.equal(proven(state("キーフレームを削除して、もっと綺麗に", ["delete_keyframes"])), false);
  assert.equal(proven(state("Do not remove the keyframes from the logo", ["delete_keyframes"])), false);
});

test("animation words in a literal or rename clause still need their own receipt", () => {
  assert.equal(proven(state("Rename the logo to Mark and fade it in over 2 seconds", ["set_layer_name"])), false);
  assert.equal(proven(state("Set the title opacity to 50 and fade it in over 2 seconds", ["set_layer_property"])), false);
  assert.equal(proven({ ...state("Name the light layer Key", ["set_layer_name"]), exact: 0, approximate: 1 }), false);
  assert.equal(proven({ ...state("Place the logo at 960, 540", ["set_layer_property"]), exact: 0, unconfirmed: 1 }), false);
  assert.equal(proven(state("Place the logo at 960, 540 and draw a rocket", ["set_layer_property", "create_layer"])), false);
});
