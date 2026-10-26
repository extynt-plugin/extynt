// Pins the review pre-screen's receipt rules: simple structural edits that every asked part's receipt proves are provable in any language, and anything with a look, a missing receipt or an unconfirmed read-back is not.
import assert from "node:assert/strict";
import test from "node:test";
import { REVIEW_PROVEN } from "../src/index.js";
import type { ReviewScreenCase } from "../src/index.js";

function receipts(goal: string, operations: ReadonlyArray<string>, specs: ReadonlyArray<string> = [], exact = 1): ReviewScreenCase {
  return { goal, specs, batches: 1, exact, approximate: 0, unconfirmed: 0, operations };
}

function proven(state: ReviewScreenCase): boolean {
  return REVIEW_PROVEN.deterministic(state);
}

test("a layer rename with its receipt is proven in several languages", () => {
  assert.equal(proven(receipts("Rename the glow layer to Halo", ["set_layer_name"], ["Layer named Halo"])), true);
  assert.equal(proven(receipts("Benenne die Ebene Schatten in Key um", ["set_layer_name"], ["Ebene heisst Key"])), true);
  assert.equal(proven(receipts("Renombra la capa Luz a Principal", ["set_layer_name"], ["Capa llamada Principal"])), true);
  assert.equal(proven(receipts("Rename the layer named Glow to Halo", ["set_layer_name"], ["Halo"])), true);
  assert.equal(proven(receipts("Name the background layer BG", ["set_layer_name"], ["BG"])), true);
  assert.equal(proven(receipts("Rename the light to Key", ["set_layer_name"], ["Key"])), true);
});

test("a rename and a lock, each with its receipt, are proven", () => {
  assert.equal(proven(receipts("Rename the background layer to BG and lock it", ["set_layer_name", "set_layer_attribute"], ["BG and locked"])), true);
  assert.equal(proven(receipts("Lock the light layer and rename it Key", ["set_layer_attribute", "set_layer_name"], ["Key locked"])), true);
});

test("literal position, rotation and scale values are proven even when a layer is named after a look", () => {
  assert.equal(proven(receipts("Set the rotation of the light to 45 degrees", ["set_layer_property"], ["Rotation 45"])), true);
  assert.equal(proven(receipts("Set the scale of the background to 150 percent", ["set_layer_property"], ["Scale 150"])), true);
  assert.equal(proven(receipts("Put the logo at 960, 540", ["set_layer_property"], ["Position 960,540"])), true);
  assert.equal(proven(receipts("Pon la escala de todas las capas al 80 por ciento", ["set_layer_property"], ["Escala 80"])), true);
});

test("removing keyframes is proven in several languages", () => {
  assert.equal(proven(receipts("Remove the keyframes from the title position", ["delete_keyframes"], ["No keyframes on position"])), true);
  assert.equal(proven(receipts("Remove all keyframes on the shadow layer", ["delete_keyframes"], ["No keyframes"])), true);
  assert.equal(proven(receipts("Entferne alle Keyframes der Skalierung", ["delete_keyframes"], ["Keine Keyframes"])), true);
  assert.equal(proven(receipts("Quita los fotogramas clave de la escala", ["delete_keyframes"], ["Sin fotogramas clave"])), true);
});

test("a time value with its timing receipt is proven although the word time is in it", () => {
  assert.equal(proven(receipts("Set the start time of the title layer to 2 seconds", ["set_layer_timing"], ["Starts at 2s"])), true);
});

test("a part with no receipt is never proven", () => {
  assert.equal(proven(receipts("Rename the layer to Hero and set its opacity to 50", ["set_layer_name"], ["Hero 50"])), false);
  assert.equal(proven(receipts("Remove the keyframes and rotate the title", ["delete_keyframes"], ["Title rotated"])), false);
  assert.equal(proven(receipts("Set the light layer rotation to 30 and rename it", ["set_layer_name"], ["Rotation 30"])), false);
});

test("a look, a colour, a judgement or a motion in any part keeps its review", () => {
  assert.equal(proven(receipts("Rename the glow layer to Halo and make it glow more", ["set_layer_name", "ensure_effect", "set_effect_control"])), false);
  assert.equal(proven(receipts("Set the rotation to 45 and make it look nicer", ["set_layer_property"], ["Rotation 45, looks nicer"])), false);
  assert.equal(proven(receipts("Remove the keyframes and make the motion feel smoother", ["delete_keyframes"], ["Smooth motion"])), false);
  assert.equal(proven(receipts("Rename the logo layer to Brand and make the background blue", ["set_layer_name", "set_layer_property"], ["Brand, blue background"])), false);
  assert.equal(proven(receipts("Set the background fill to #FF7A00 so the shot reads as warm sunset", ["set_layer_property"], ["Background fill reads as warm sunset"])), false);
  assert.equal(proven(receipts("Position the title above the logo so the two do not collide", ["set_layer_property"], ["Title above logo, no overlap"])), false);
});

test("a picture word in a spec keeps the review", () => {
  assert.equal(proven(receipts("Remove the keyframes from the title position", ["delete_keyframes"], ["Looks warm and cinematic"])), false);
  assert.equal(proven(receipts("Set the logo position to 960, 540", ["set_layer_property"], ["Logo centred"])), false);
});

test("a receipt that is approximate, unconfirmed or missing proves nothing", () => {
  assert.equal(proven({ ...receipts("Set the opacity of the layer to 50", ["set_layer_property"]), approximate: 1 }), false);
  assert.equal(proven({ ...receipts("Set the opacity of the layer to 50", ["set_layer_property"]), exact: 0, unconfirmed: 1 }), false);
  assert.equal(proven({ ...receipts("Rename the layer to Hero", ["set_layer_name"]), batches: 0 }), false);
  assert.equal(proven(receipts("Rename the layer to Hero", ["set_layer_name", "ensure_effect"])), false);
});

test("a goal that names nothing checkable is never proven", () => {
  assert.equal(proven(receipts("Do it", ["set_layer_name"])), false);
  assert.equal(proven(receipts("Make it nice", ["set_layer_property"])), false);
});
