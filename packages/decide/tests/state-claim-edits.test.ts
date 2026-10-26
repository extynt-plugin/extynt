// Pins the state-claim reading of a user's own edit and of where something is now, in six languages: a report is a claim, a request or a question is not.
import assert from "node:assert/strict";
import test from "node:test";
import { assertsCurrentState } from "../src/index.js";

test("a report of the user's own edit, or of where something is now, is a state claim in six languages", () => {
  for (const message of [
    "I fixed the timing, now add a fade", "The logo is now at 100, 200", "Ya moví el logo, ahora añade un desvanecimiento", "Ich habe das Logo schon verschoben, jetzt füge eine Überblendung hinzu",
    "J'ai déjà supprimé la lueur du titre, ajoute maintenant un fondu", "ロゴはもう動かしたので、次はフェードを足して", "我已经把logo移了，现在加一个淡入", "Le titre est à 2 secondes maintenant",
  ]) assert.equal(assertsCurrentState(message), true, message);
});

test("a request or a question with no claim about the project is not a state claim", () => {
  for (const message of [
    "Fix the timing and add a fade", "Can you move the logo to 100, 200?", "If I moved it, undo", "Mueve el logo a la izquierda", "Kannst du den Glow vom Titel löschen?", "Déplace le logo vers la gauche",
    "ロゴを左に動かして", "レイヤーを消したらアニメーションは壊れる？", "我想把logo删了", "现在把logo移到左边",
  ]) assert.equal(assertsCurrentState(message), false, message);
});
