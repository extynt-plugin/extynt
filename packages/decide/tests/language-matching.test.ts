// Tests for matching across the six request languages: width, accent and kana folding, French elisions, German compounds and unsegmented Japanese and Chinese.
import assert from "node:assert/strict";
import test from "node:test";
import { mentions } from "../src/evidence-words.js";
import { containsWord, foldRequest, phraseRegex } from "../src/request-text.js";
import { compileConcepts, conceptHits } from "../src/resolution-concepts.js";
import type { ConceptRow } from "../src/resolution-concepts.js";
import { clausesOf, normaliseText } from "../src/resolution-text.js";

const ROWS: ReadonlyArray<ConceptRow> = [
  ["blur, flou, desenfoque, weichzeichn, ぼかし, ボケ, 模糊", "blur", 3],
  ["shadow, ombre, sombra, schatten, 影, 阴影", "shadow", 3],
  ["glow, ~leucht, 发光", "glow", 3],
];

const CONCEPTS = compileConcepts(ROWS);

function phrases(request: string): ReadonlyArray<string> {
  return conceptHits(clausesOf(request), CONCEPTS).filter((hit) => !hit.negated).map((hit) => hit.phrase);
}

function denied(request: string): ReadonlyArray<string> {
  return conceptHits(clausesOf(request), CONCEPTS).filter((hit) => hit.negated).map((hit) => hit.phrase);
}

test("English: full-width letters fold to plain ones", () => {
  assert.deepEqual(phrases("add a ＢＬＵＲ"), ["blur"]);
});

test("Spanish: accents and ñ fold, sin denies", () => {
  assert.equal(normaliseText("Desenfoque Más Suave, año"), "desenfoque mas suave, ano");
  assert.deepEqual(phrases("añade una sombra"), ["sombra"]);
  assert.deepEqual(denied("sin desenfoque"), ["desenfoque"]);
});

test("German: umlauts and ß fold, compounds match inside, ohne denies", () => {
  assert.equal(normaliseText("Schärfer Weiß Straße"), "scharfer weiss strasse");
  assert.deepEqual(phrases("Gaußscher Weichzeichner"), ["weichzeichn"]);
  assert.deepEqual(phrases("Gaußweichzeichner"), ["weichzeichn"]);
  assert.deepEqual(phrases("ein Neonleuchten"), ["leucht"]);
  assert.deepEqual(denied("ohne Schatten"), ["schatten"]);
});

test("French: accents and œ fold, elisions split, sans denies", () => {
  assert.equal(normaliseText("l'œuvre d'été, qu'il"), "l oeuvre d ete, qu il");
  assert.deepEqual(phrases("ajoute l'ombre portée"), ["ombre"]);
  assert.deepEqual(phrases("un flou d'image"), ["flou"]);
  assert.deepEqual(denied("sans flou"), ["flou"]);
  assert.equal(normaliseText("don't it's"), "dont its");
});

test("Japanese: half-width kana, katakana against hiragana and unsegmented text", () => {
  assert.deepEqual(phrases("ｶﾞｳｽぼかしを追加"), ["ぼかし"]);
  assert.deepEqual(phrases("ぼけを足して"), ["ボケ"]);
  assert.deepEqual(phrases("タイトルにドロップシャドウを追加"), []);
  assert.deepEqual(denied("ぼかしなし"), ["ぼかし"]);
});

test("Chinese: ideographs match as a substring and negation words deny the clause", () => {
  assert.deepEqual(phrases("给标题添加模糊"), ["模糊"]);
  assert.deepEqual(phrases("加个阴影，不要发光"), ["阴影"]);
  assert.deepEqual(denied("加个阴影，不要发光"), ["发光"]);
  assert.deepEqual(phrases("添加模糊，但是没有阴影"), ["模糊"]);
});

test("request phrases fold their own accents and match kana in either script", () => {
  assert.equal(foldRequest("Prüfe die Straße œuvre ＡＢＣ"), "Prufe die Strasse oeuvre ABC");
  assert.ok(containsWord(foldRequest("Bitte prüfen"), phraseRegex(["prüf"])));
  assert.ok(containsWord(foldRequest("ボケを足す"), phraseRegex(["ぼけ"])) === false);
  assert.ok(containsWord(foldRequest("ぼけを足す"), phraseRegex(["ボケ"])));
  assert.ok(containsWord(foldRequest("手描き風"), phraseRegex(["手描"])));
  assert.ok(containsWord(foldRequest("Gaußweichzeichner"), phraseRegex(["~weichzeichn"])));
});

test("evidence roots fold width and accents, match kana in either script and compounds with ~", () => {
  assert.ok(mentions("Überprüfe das Ｌogo", ["uberpruf", "logo"]));
  assert.ok(mentions("ぼけを足す", ["ボケ"]));
  assert.ok(mentions("Neonleuchten", ["~leucht"]));
  assert.ok(!mentions("Neonleuchten", ["leucht"]));
  assert.ok(!mentions("sans logo", ["logo"]));
});

test("evidence roots in Japanese and Chinese are denied by a negator in the same clause", () => {
  assert.ok(mentions("タイトルをフェードさせて", ["フェード"]));
  assert.ok(!mentions("フェードなしで", ["フェード"]));
  assert.ok(!mentions("アニメーションは不要です", ["アニメ"]));
  assert.ok(mentions("アニメは要らない、背景をぼかして", ["ぼかし", "ぼかして"]));
  assert.ok(!mentions("不要加动画", ["动画"]));
  assert.ok(mentions("不要加阴影，标题淡入", ["淡入"]));
  assert.ok(mentions("没有阴影但是要淡入", ["淡入"]));
});
