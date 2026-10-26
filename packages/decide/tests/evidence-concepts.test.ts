// Checks the deterministic evidence reading on sentences written for the reading itself: sequencing, delay, counting, static moves, structural edits, layout words in other languages, and continuation phrases.
import assert from "node:assert/strict";
import test from "node:test";
import { continuationReading } from "../src/evidence-continuation.js";
import { goalConcepts } from "../src/evidence-concepts.js";
import { goalIsLiteralValues, goalIsTemporal, goalIsVisual } from "../src/index.js";

test("sequencing, delay and counting wording asks for motion evidence", () => {
  const motion = [
    "Stagger the words so they appear one after another",
    "Show the bullets in turn, one by one",
    "Lass die Zeilen nacheinander einblenden",
    "テキストを順番に表示して",
    "The logo should appear after 1.5 s",
    "Der Titel erscheint nach 1,5 Sekunden",
    "Count from 0 to 500 over 2 s",
    "数字を0から500まで2秒でカウントアップ",
  ];
  for (const goal of motion) assert.equal(goalIsTemporal(goal), true, goal);
});

test("structural edits to names and composition settings are neither motion nor a look", () => {
  const structural = [
    "Rename the precomp 'Fade out'",
    "Rename the layer to Glow Pass",
    "Set the composition frame rate to 30",
    "Set the composition duration to 12 seconds",
    "Set the comp to 60 frames long",
  ];
  for (const goal of structural) {
    assert.equal(goalIsTemporal(goal), false, goal);
    assert.equal(goalIsVisual(goal), false, goal);
  }
});

test("a static placement or rotation is a transform, not motion", () => {
  const moves = ["Put the logo at 100, 200", "Move the title to x 300", "Rotate the logo to 15 degrees", "ロゴの位置を300に移動"];
  for (const goal of moves) {
    assert.equal(goalIsTemporal(goal), false, goal);
    assert.equal(goalIsLiteralValues(goal), true, goal);
  }
});

test("layout and colour wording in other languages reads as a look", () => {
  const looks = ["Order the cards in a row", "Ordena las tarjetas en una fila", "Ordne die Karten in einer Reihe", "カードを横に並べて", "Change the title to crimson", "Make the headline navy"];
  for (const goal of looks) assert.equal(goalIsVisual(goal), true, goal);
  assert.equal(goalIsVisual("Ordena las capas por nombre"), false);
});

test("a layer's sorting words do not read as an arrangement", () => {
  assert.equal(goalConcepts("Ordena las capas por nombre").has("layout"), false);
});

test("a go-ahead with nothing else resumes the stopped job", () => {
  for (const message of ["continue", "ok, go for it", "ya, sigue", "続けて"]) {
    assert.equal(continuationReading(message), "resume", message);
  }
});

test("a no-change clause resumes the job whatever else it says", () => {
  assert.equal(continuationReading("carry on with the rest, nothing else"), "resume");
  assert.equal(continuationReading("そのまま続けて"), "resume");
});

test("a go-ahead with new words amends the job, and a message without a go-ahead starts a new request", () => {
  assert.equal(continuationReading("continue and make the title red"), "amend-and-resume");
  assert.equal(continuationReading("Make the title red"), "new-request");
});
