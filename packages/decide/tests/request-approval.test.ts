// A request asks for the design first only in words that say so, in each of the six languages; a plain design request and a refused approval do not.
import assert from "node:assert/strict";
import test from "node:test";
import { approvalFirstLanguage } from "../src/request-approval.js";
import type { RequestLanguage } from "../src/request-approval-words.js";

const HOLDS: ReadonlyArray<readonly [request: string, language: RequestLanguage]> = [
  ["Design a logo for Ember and show me the design first", "en"],
  ["Draw a sun behind two hills, but wait for my go-ahead before you build it", "en"],
  ["Make a title card. Let me approve it before you build anything.", "en"],
  ["Create the lower third, then check with me first", "en"],
  ["Diseña un logo para Ember y muéstrame el diseño primero", "es"],
  ["Dibuja un sol detrás de dos colinas, espera mi aprobación antes de construirlo", "es"],
  ["Crea una animación de cohete; quiero ver el diseño antes de que lo hagas", "es"],
  ["Entwirf ein Logo für Ember und zeig mir zuerst den Entwurf", "de"],
  ["Zeichne eine Sonne hinter zwei Hügeln, warte auf meine Freigabe", "de"],
  ["Bevor du baust, will ich das Design sehen: ein Rakete mit Ring", "de"],
  ["Conçois un logo pour Ember et montre-moi le design d'abord", "fr"],
  ["Dessine un soleil derrière deux collines, attends mon feu vert avant de construire", "fr"],
  ["Je veux voir la conception avant de commencer", "fr"],
  ["Emberのロゴを作って、先にデザインを見せてください", "ja"],
  ["丘の後ろに太陽を描いて。承認するまで待ってください", "ja"],
  ["タイトルカードを作る前に確認させてください。OKが出るまで作らないで", "ja"],
  ["给 Ember 设计一个标志，先给我看设计", "zh-Hans"],
  ["在两座山后面画一个太阳，等我批准后再做", "zh-Hans"],
  ["做一个火箭动画，开始之前先给我看方案", "zh-Hans"],
];

const PLAIN: ReadonlyArray<string> = [
  "Draw a sun behind two hills",
  "Design a logo for a coffee shop called Ember, then animate it in",
  "Make a rocket orbit a planet with a ring over ten seconds",
  "Dibuja un sol detrás de dos colinas",
  "Diseña un logo para una cafetería llamada Ember y anímalo",
  "Zeichne eine Sonne hinter zwei Hügeln",
  "Entwirf ein Logo für das Café Ember und animiere es",
  "Dessine un soleil derrière deux collines",
  "Conçois un logo pour le café Ember puis anime-le",
  "丘の後ろに太陽を描いて",
  "Emberというカフェのロゴをデザインして、アニメーションで登場させて",
  "在两座山后面画一个太阳",
  "给咖啡店 Ember 设计一个标志，然后做入场动画",
  "Show the title at two seconds and approve nothing yet",
  "Make the glow softer",
];

const REFUSED: ReadonlyArray<string> = [
  "Draw a sun behind two hills, no need to wait for my approval",
  "Design a logo for Ember and build it without waiting for my go-ahead, do not show me the design first",
  "Dibuja un sol, sin esperar mi aprobación",
  "Zeichne eine Sonne, ohne auf meine Freigabe zu warten",
  "Dessine un soleil, pas besoin d'attendre mon feu vert",
  "太陽を描いて。承認なしで進めて、確認するまで待たないで",
  "画一个太阳，不需要等我批准",
];

test("a request that asks to see the design first or to wait for a go-ahead holds, and names its language", () => {
  for (const [request, language] of HOLDS) assert.equal(approvalFirstLanguage(request), language, request);
});

test("a plain request to design or draw does not hold", () => {
  for (const request of PLAIN) assert.equal(approvalFirstLanguage(request), undefined, request);
});

test("a request that refuses the wait does not hold", () => {
  for (const request of REFUSED) assert.equal(approvalFirstLanguage(request), undefined, request);
});
