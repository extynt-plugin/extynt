// Pins the review pre-screen's casual phrasing: folder moves, parenting, polite renames, terse timing, text content, composition settings and layer names that look like looks are proven by their receipts, while every reference match, look, judgement or motion still keeps its review.
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

const FOLDER_MOVE = ["create_folder", "move_item_to_folder"];

test("a folder made and filled with a counted set of files is structural in several languages", () => {
  assert.equal(proven(state("Make a folder called Shots and move the three mp4s into it", FOLDER_MOVE)), true);
  assert.equal(proven(state("Crea una carpeta Shots y mueve los tres mp4 dentro", FOLDER_MOVE)), true);
  assert.equal(proven(state("Erstelle einen Ordner Shots und verschiebe die drei mp4 hinein", FOLDER_MOVE)), true);
  assert.equal(proven(state("Crée un dossier Shots et mets les trois mp4 dedans", FOLDER_MOVE)), true);
  assert.equal(proven(state("フォルダ Shots を作って、3つのmp4を入れて", FOLDER_MOVE)), true);
});

test("parenting is proven with its receipt, including typos and the phrasings of each language", () => {
  assert.equal(proven(state("Parnet the Halo layer to Rig", ["set_layer_parent"])), true);
  assert.equal(proven(state("Make Halo a child of Rig", ["set_layer_parent"])), true);
  assert.equal(proven(state("Halo を Rig の子にして", ["set_layer_parent"])), true);
  assert.equal(proven(state("Haz que la capa Halo sea hijo de Rig", ["set_layer_parent"])), true);
  assert.equal(proven(state("Emparenta la capa Halo con Rig", ["set_layer_parent"])), true);
  assert.equal(proven(state("Parente die Ebene Halo an Rig", ["set_layer_parent"])), true);
  assert.equal(proven(state("Ordne die Ebene Halo dem Rig unter", ["set_layer_parent"])), true);
  assert.equal(proven(state("Lie le calque Halo à Rig", ["set_layer_parent"])), true);
});

test("a polite or casual tail does not stop a rename from being proven", () => {
  assert.equal(proven(state("Rename the Warm layer to Ember, thanks", ["set_layer_name"])), true);
  assert.equal(proven(state("Rename the Shadow layer to Ember please", ["set_layer_name"])), true);
  assert.equal(proven(state("Renomme la couche Warm en Ember merci", ["set_layer_name"])), true);
  assert.equal(proven(state("Renomme le calque Glow en Halo s'il te plaît", ["set_layer_name"])), true);
  assert.equal(proven(state("Benenne die Ebene Warm in Ember um, bitte", ["set_layer_name"])), true);
  assert.equal(proven(state("Renombra la capa Glow a Ember porfa", ["set_layer_name"])), true);
  assert.equal(proven(state("Renombra la capa Glow a Halo, gracias", ["set_layer_name"])), true);
  assert.equal(proven(state("レイヤー名を Warm から Ember に変更 お願いします", ["set_layer_name"])), true);
  assert.equal(proven(state("レイヤー名を Glow から Halo に変更してください", ["set_layer_name"])), true);
});

test("a Japanese rename of a look-named layer is proven, the old and new names being layer identifiers", () => {
  assert.equal(proven(state("グローレイヤーの名前を Ember に変更", ["set_layer_name"])), true);
  assert.equal(proven(state("グローの名前を Halo にして", ["set_layer_name"])), true);
  assert.equal(proven(state("レイヤー名を Warm から Ember に変更", ["set_layer_name"])), true);
});

test("a terse start, in point or duration with its timing receipt is proven", () => {
  assert.equal(proven(state("Title in at f30", ["set_layer_timing"])), true);
  assert.equal(proven(state("The title layer in at 2s", ["set_layer_timing"])), true);
  assert.equal(proven(state("Starts at 2s and runs 90 frames", ["set_layer_timing"])), true);
  assert.equal(proven(state("The title starts at frame 30 and runs for 90 frames", ["set_layer_timing"])), true);
  assert.equal(proven(state("Die Ebene startet bei 2s und läuft 90 Frames", ["set_layer_timing"])), true);
});

test("an alignment claim with its own timing and a timing receipt is proven", () => {
  assert.equal(proven(state("Title in at f30 so it lines up with the beat", ["set_layer_timing"])), true);
  assert.equal(proven(state("The title layer starts at 2s so it lines up with the beat", ["set_layer_timing"])), true);
  assert.equal(proven(state("The title starts at 2s so the beat lands on frame 48", ["set_layer_timing"])), true);
  assert.equal(proven(state("Die Ebene startet bei 2s, damit er auf den Beat passt", ["set_layer_timing"])), true);
});

test("a text value in several languages is proven with its text receipt", () => {
  assert.equal(proven(state("Mets le texte du titre à Bonjour", ["set_text_document"])), true);
  assert.equal(proven(state("Pon el texto del título en Hola", ["set_text_document"])), true);
  assert.equal(proven(state("Setz den Text auf Hallo", ["set_text_document"])), true);
  assert.equal(proven(state("テキストを Hallo に", ["set_text_document"])), true);
});

test("composition settings with units are proven with the composition receipt", () => {
  assert.equal(proven(state("コンポを 30fps にして", ["set_composition_settings"])), true);
  assert.equal(proven(state("Set the frame rate to 24 fps", ["set_composition_settings"])), true);
  assert.equal(proven(state("Set the frame size to 1920 by 1080", ["set_composition_settings"])), true);
  assert.equal(proven(state("Stelle die Bildrate auf 25 ein", ["set_composition_settings"])), true);
  assert.equal(proven(state("Make the comp 10 seconds long", ["set_composition_settings"])), true);
});

test("colour words inside a layer name are not a colour request in a structural edit", () => {
  assert.equal(proven(state("Set the Red Box position to 100, 200", ["set_layer_property"])), true);
  assert.equal(proven(state("Set the Blue Bar scale to 80 percent", ["set_layer_property"])), true);
  assert.equal(proven(state("Rename the Red Box layer to Crate, thanks", ["set_layer_name"])), true);
});

test("a colour word given as the requested value still keeps the review", () => {
  assert.equal(proven(state("Make the box red", ["set_layer_property"])), false);
  assert.equal(proven(state("Set the box to red", ["set_layer_property"])), false);
  assert.equal(proven(state("Set the Blue Bar position to 100, 200 and make it blue", ["set_layer_property"])), false);
});

test("a reference, comp, mockup or style-frame match keeps its review whatever words it uses", () => {
  assert.equal(proven(state("Make the logo exactly like the reference image", ["set_layer_property"])), false);
  assert.equal(proven(state("Setze es wie im Referenzbild", ["set_layer_property"])), false);
  assert.equal(proven(state("Benenne die Ebene wie im Referenzbild", ["set_layer_name"])), false);
  assert.equal(proven(state("Ponlo como en la referencia", ["set_layer_property"])), false);
  assert.equal(proven(state("Mets-le comme la référence", ["set_layer_property"])), false);
  assert.equal(proven(state("参考画像のように配置して", ["set_layer_property"])), false);
  assert.equal(proven(state("Match the ref layer position to 960, 540", ["set_layer_property"])), false);
  assert.equal(proven(state("Match the mockup, 960, 540", ["set_layer_property"])), false);
  assert.equal(proven(state("Match the comp to the styleframe", ["set_layer_property"])), false);
  assert.equal(proven(state("Rename the layer to match the reference", ["set_layer_name"])), false);
  assert.equal(proven(state("Exactly like in the reference image, rename it Key", ["set_layer_name"])), false);
  assert.equal(proven(state("Make the title exactly like the Vorlage", ["set_layer_property"])), false);
  assert.equal(proven(state("Put the logo at 960, 540 exactly like the reference", ["set_layer_property"])), false);
});

test("risky look, judgement and motion sentences with casual phrasing keep their review", () => {
  assert.equal(proven(state("Make the background feel warmer", ["set_layer_property"])), false);
  assert.equal(proven(state("Make the logo pop on the beat", ["add_marker"])), false);
  assert.equal(proven(state("Ease the title in over 2 seconds", ["set_keyframes"])), false);
  assert.equal(proven(state("Title in at f30 and make it bouncier", ["set_layer_timing"])), false);
  assert.equal(proven(state("Title in at f30 with a soft fade", ["set_layer_timing"])), false);
  assert.equal(proven(state("The title starts at 2s and feels snappier", ["set_layer_timing"])), false);
  assert.equal(proven(state("Set the text to Hello and make it glow", ["set_text_document"])), false);
  assert.equal(proven(state("Make the text feel bolder", ["set_text_document"])), false);
  assert.equal(proven(state("Set the comp to 30 fps and make it cinematic", ["set_composition_settings"])), false);
  assert.equal(proven(state("Make the comp look sharper at 30 fps", ["set_composition_settings"])), false);
  assert.equal(proven(state("Rename the Hero layer to Mark and brighten the sky", ["set_layer_name"])), false);
  assert.equal(proven(state("Parent the glow to the rig so it looks cinematic", ["set_layer_parent"])), false);
  assert.equal(proven(state("Parent the layer to Rig and make it prettier", ["set_layer_parent"])), false);
  assert.equal(proven(state("Name the Hero layer Mark so it reads nicely", ["set_layer_name"])), false);
  assert.equal(proven(state("Set the logo to 960, 540 and make it gorgeous", ["set_layer_property"])), false);
  assert.equal(proven(state("Set the title opacity to 50, nicely", ["set_layer_property"])), false);
  assert.equal(proven(state("Put the logo at 960, 540 so the layout feels balanced", ["set_layer_property"])), false);
  assert.equal(proven(state("Scale the logo to 80 percent so it feels premium", ["set_layer_property"])), false);
  assert.equal(proven(state("Set the Sky position to 100, 200 so it looks warmer", ["set_layer_property"])), false);
  assert.equal(proven(state("Center the logos at 960, 540 and make them pop", ["set_layer_property"])), false);
  assert.equal(proven(state("Set the Red Box position to 100, 200 and make it look cinematic", ["set_layer_property"])), false);
  assert.equal(proven(state("Set the logo position to 960, 540 and make it prettier", ["set_layer_property"])), false);
  assert.equal(proven(state("Set the logo position to 960, 540 and make it sharper", ["set_layer_property"])), false);
  assert.equal(proven(state("Place the title at 100, 200 and make it feel calmer", ["set_layer_property"])), false);
  assert.equal(proven(state("Line up the three logos in a row", ["set_layer_property"])), false);
  assert.equal(proven(state("Lay the logos out evenly in a grid", ["set_layer_property"])), false);
});

test("a polite tail on a look request does not make it a structural edit", () => {
  assert.equal(proven(state("Please make it look better, thanks", ["set_layer_name"])), false);
  assert.equal(proven(state("Rename the Glow layer to Halo, thanks, make it pop", ["set_layer_name"])), false);
});
