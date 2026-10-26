// Checks the request-parts reading for negation, null and parent pairs, letter spacing, duplicate compositions, text mattes and stroke reveals, in English and in German, Spanish, French and Japanese.
import assert from "node:assert/strict";
import test from "node:test";
import { featuresAsked } from "../src/request-parts.js";
import type { FeatureId } from "../src/request-features.js";

function assertAsks(request: string, expected: ReadonlyArray<FeatureId>): void {
  assert.deepEqual([...featuresAsked(request)].sort(), [...expected].sort(), request);
}

test("a denied part is left out: no, without, instead of, rather than, excluded, forget, glow-free", () => {
  assertAsks("Add a drop shadow, no glow", ["drop-shadow"]);
  assertAsks("Add a glow, but not a drop shadow", ["glow"]);
  assertAsks("Add a drop shadow with no glow", ["drop-shadow"]);
  assertAsks("Add a glow, without a drop shadow", ["glow"]);
  assertAsks("Add a drop shadow instead of a glow", ["drop-shadow"]);
  assertAsks("Add a drop shadow rather than a glow", ["drop-shadow"]);
  assertAsks("Add a glow, drop shadow excluded", ["glow"]);
  assertAsks("Add a drop shadow, forget the glow", ["drop-shadow"]);
  assertAsks("Add a drop shadow, glow-free", ["drop-shadow"]);
  assertAsks("Add a drop shadow, nothing glowy", ["drop-shadow"]);
});

test("a denied part in other languages is left out", () => {
  assertAsks("Ajoute une ombre portée, pas de lueur", ["drop-shadow"]);
  assertAsks("Füge einen Schlagschatten hinzu, aber kein Leuchten", ["drop-shadow"]);
  assertAsks("Agrega una sombra paralela, sin resplandor", ["drop-shadow"]);
  assertAsks("グローを入れて、ドロップシャドウは無しで", ["glow"]);
});

test("a refusal list leaves out every item, and an and-clause after it is a new part", () => {
  assertAsks("No glow, shadow or blur on the title", []);
  assertAsks("Add a glow, no shadow, no blur, and a camera push", ["camera", "camera-move", "glow"]);
  assertAsks("Add a camera push, no glow, and a null", ["camera", "camera-move", "null"]);
});

test("linking layers to a null asks for the null and the parent", () => {
  assertAsks("Link these layers to a null", ["null", "parent"]);
  assertAsks("Tie the logo and the subtitle to a null", ["null", "parent"]);
  assertAsks("Attach the car to the null controller", ["null", "parent"]);
  assertAsks("Verbinde diese Ebenen mit einem Nullobjekt", ["null", "parent"]);
});

test("letter spacing and kerning are the tracking part", () => {
  assertAsks("Spread the letters out across the title", ["tracking"]);
  assertAsks("Loosen the spacing of the headline", ["tracking"]);
  assertAsks("Tighter kerning on the title please", ["tracking"]);
  assertAsks("Increase the tracking of the subtitle", ["tracking"]);
  assertAsks("Aumenta el espaciado entre letras del título", ["tracking"]);
  assertAsks("Erhöhe den Buchstabenabstand im Titel", ["tracking"]);
  assertAsks("Augmente l'espacement des lettres du titre", ["tracking"]);
  assertAsks("タイトルの文字間を広げて", ["tracking"]);
});

test("a copy, a version or a duplicate of a comp is the duplicate composition", () => {
  assertAsks("Make a copy of this comp", ["duplicate-composition"]);
  assertAsks("A square version of the comp", ["duplicate-composition"]);
  assertAsks("Duplicate the composition for the 9:16 cut", ["duplicate-composition"]);
});

test("text used as a matte or letters as a window give the matte and the text matte", () => {
  assertAsks("Make the title visible only through the letters, with the text used as a matte", ["matte", "text-matte"]);
  assertAsks("Use the letters as a window onto the footage", ["matte", "text-matte"]);
  assertAsks("Clip the video so it shows only inside the word", ["matte", "text-matte"]);
});

test("a stroke that animates on or off draws itself, even in a long batched brief", () => {
  assertAsks("Stroke animates on the logo outline", ["trim-paths"]);
  assertAsks("The path writes on from left to right", ["trim-paths"]);
  assertAsks("Die Linie zeichnet sich selbst unter dem Logo", ["trim-paths"]);
  assertAsks(
    "Make a 40 second reel. Scene one: a dark background, the stroke animates on under the logo, then a glow. Scene two: four cards pop in one by one, a drop shadow, a wiggle on the price, a camera push-in. Scene three: the title letters stagger, a null for the bar, a repeater on the dots. Scene four: an outro with markers at 2s, 4s and 6s and a 3D badge.",
    ["text-animator", "glow", "drop-shadow", "wiggle", "repeater", "trim-paths", "camera", "camera-move", "null", "markers", "three-d"],
  );
  assertAsks(
    "Make a 40 second reel. Scene one: a dark background with no glow and no blur, the logo stroke animates on, then four cards pop in one by one, a drop shadow, a wiggle on the price, a camera push-in, the title letters stagger, a null for the bar, a repeater on the dots, markers at 2s, 4s and 6s and a 3D badge.",
    ["text-animator", "drop-shadow", "wiggle", "repeater", "trim-paths", "camera", "camera-move", "null", "markers", "three-d"],
  );
});

test("a plain track of an object is not a tracking part, but stabilizing footage is", () => {
  assertAsks("Make the card slide in and track the car around the corner", []);
  assertAsks("Stabilize the footage, then increase the tracking of the subtitle", ["tracking"]);
});
