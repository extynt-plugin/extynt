// Described fonts that name a region, a script or a use: terminal, German grotesk and serif, rounded Japanese, bold sports and handwriting wording.
import assert from "node:assert/strict";
import test from "node:test";
import { fontChoice } from "../src/index.js";
import type { FontRecord } from "../src/index.js";

const BASE = [
  "Menlo", "Courier New", "Consolas", "Helvetica", "Arial", "Times New Roman", "Georgia", "Baskerville", "Yu Gothic", "Hiragino Sans", "Yu Mincho", "Brush Script MT", "Bradley Hand",
  "Apple Chancery", "Franklin Gothic Medium", "Impact", "Futura", "Gill Sans", "Cambria", "Garamond", "Palatino", "Noteworthy", "Comic Sans MS", "Cochin",
];

function inventory(extra: ReadonlyArray<string>): ReadonlyArray<FontRecord> {
  return [...BASE, ...extra].map((family) => ({ family, style: "Regular", postScriptName: family.replace(/ /g, "") }));
}

function pick(phrase: string, extra: ReadonlyArray<string> = []): string {
  return fontChoice(phrase, inventory(extra)).deterministic({ phrase });
}

const LOOKS: ReadonlyArray<readonly [accepted: ReadonlyArray<string>, phrases: ReadonlyArray<string>]> = [
  [["Menlo", "Courier New", "Consolas"], ["old school terminal text", "green screen terminal lettering", "eine Schrift wie ein Computerterminal", "teletype style", "text like an old computer console", "IDE style font", "a font for displaying source code"]],
  [["Helvetica", "Arial"], ["eine deutsche Grotesk", "German grotesk", "serifenlose Schrift, deutsch", "klare Grotesk wie aus Deutschland", "German sans serif", "neue Grotesk"]],
  [["Times New Roman", "Georgia", "Baskerville", "Garamond", "Palatino", "Cambria", "Cochin"], ["eine deutsche Serifenschrift", "German serif", "traditionelle deutsche Schrift"]],
  [["Franklin Gothic Medium", "Impact"], ["bold stadium scoreboard font", "bold sports font", "bold athletic typeface"]],
  [["Brush Script MT", "Bradley Hand", "Apple Chancery", "Noteworthy"], ["flowing script lettering", "like a hand-written note", "scribbled notes style", "pen-written signature style"]],
];

test("described looks that carry a region or a use word still answer with a fitting family", () => {
  const misses: string[] = [];
  for (const [accepted, phrases] of LOOKS) for (const phrase of phrases) if (!accepted.includes(pick(phrase))) misses.push(`${phrase} -> ${pick(phrase)}`);
  assert.deepEqual(misses, []);
});

const MARU = ["丸ゴシック", "丸みのある日本語フォント", "rounded Japanese font", "maru gothic", "柔らかい丸文字", "丸いゴシック体", "日本語の丸ゴ", "ラウンドゴシック"];

test("rounded Japanese wording picks the rounded Japanese family when one is installed", () => {
  for (const phrase of MARU) assert.equal(pick(phrase, ["Hiragino Maru Gothic ProN", "Arial Rounded MT Bold"]), "Hiragino Maru Gothic ProN", phrase);
});

test("rounded Japanese wording without a rounded Japanese family takes the closest Japanese sans over a Latin face", () => {
  for (const phrase of MARU) assert.ok(["Hiragino Sans", "Yu Gothic"].includes(pick(phrase, ["Arial Rounded MT Bold"])), phrase);
});

const CLASS_LOOKS: ReadonlyArray<readonly [accepted: ReadonlyArray<string>, phrases: ReadonlyArray<string>]> = [
  [["Menlo", "Monaco"], ["monospace terminal", "retro monospace terminal readout", "monospace lettering, terminal style, small and tidy", "a font like a command prompt", "a typewriter-like monospace", "text that looks like it's in a terminal window"]],
  [["Times", "Times New Roman"], ["German book text", "a book serif", "old German book serif", "readable serif for long passages of German prose", "traditional serif for long reading", "German book typography"]],
  [["Brush Script MT", "Bradley Hand"], ["handwriting", "natural handwriting", "personal handwriting feel", "brushed script", "like someone wrote it by hand", "handwritten cursive"]],
  [["Franklin Gothic Medium"], ["bold sports headlines", "heavy sports headline", "punchy bold sports titles", "bold sans for sports", "sports highlights headline font bold", "a bold sports score ticker"]],
];

function records(families: ReadonlyArray<string>): ReadonlyArray<FontRecord> {
  return families.map((family) => ({ family, style: "Regular", postScriptName: family.replace(/ /g, "") }));
}

test("a described style class picks an installed family of that class, and a bold sports headline takes Franklin Gothic over a condensed DIN", () => {
  const installed = ["Menlo", "Helvetica", "Times", "Brush Script MT", "Franklin Gothic Medium", "DIN Condensed", "Hiragino Sans", "Arial"];
  const misses: string[] = [];
  for (const [accepted, phrases] of CLASS_LOOKS) for (const phrase of phrases) if (!accepted.includes(fontChoice(phrase, records(installed)).deterministic({ phrase }))) misses.push(phrase);
  assert.deepEqual(misses, []);
});

test("a lone script family answers a handwriting request", () => {
  const installed = records(["Monaco", "Arial", "Georgia", "Zapfino", "Meiryo"]);
  for (const phrase of ["handwriting font", "natural handwriting", "brushed lettering"]) assert.equal(fontChoice(phrase, installed).deterministic({ phrase }), "Zapfino", phrase);
});

test("cute rounded Japanese wording in any order falls back to a Japanese sans when no rounded family is installed", () => {
  const phrases = ["cute rounded Japanese", "Japanese, cute and rounded", "rounded cute Japanese lettering", "cute Japanese font, rounded", "kawaii rounded Japanese lettering", "かわいい丸い日本語"];
  for (const phrase of phrases) assert.ok(["Hiragino Sans", "Yu Gothic"].includes(pick(phrase)), phrase);
});

test("an uninstalled family named with a capital still stops a look from picking another family", () => {
  assert.equal(pick("Proxima Nova"), "none");
  assert.equal(pick("a Gotham style bold"), "none");
});

const GERMAN_LOOKS: ReadonlyArray<readonly [accepted: ReadonlyArray<string>, phrases: ReadonlyArray<string>]> = [
  [["Arial", "Helvetica", "Franklin Gothic Medium"], ["eine klare Grotesk für Untertitel", "eine saubere Grotesk für den Untertitel", "eine groteske Schrift für die Überschrift"]],
  [["Times New Roman", "Georgia", "Baskerville", "Garamond", "Palatino", "Cambria", "Cochin"], ["eine klassische Serifenschrift für den Vorspann", "eine klassische Serifenschrift für den Abspann", "eine klassische Serifenschrift für Überschriften"]],
  [["Arial", "Helvetica", "Franklin Gothic Medium", "Impact"], ["eine fette Grotesk für Überschriften", "eine fette serifenlose Schrift für den Titel"]],
  [["Brush Script MT", "Bradley Hand", "Apple Chancery", "Noteworthy"], ["eine handgeschriebene Schrift für den Abspann", "eine Schreibschrift für den Vorspann"]],
  [["Menlo", "Consolas", "Courier New"], ["eine nichtproportionale Schrift für Code", "eine Monospace-Schrift für den Titel"]],
];

test("German style words, with title and caption words that name no family, pick the fitting family", () => {
  const misses: string[] = [];
  for (const [accepted, phrases] of GERMAN_LOOKS) for (const phrase of phrases) if (!accepted.includes(pick(phrase))) misses.push(`${phrase} -> ${pick(phrase)}`);
  assert.deepEqual(misses, []);
});

test("a German capitalised noun after a look does not veto the look when it is a title word", () => {
  assert.equal(pick("eine klare Grotesk für Untertitel"), pick("eine klare Grotesk"));
  assert.equal(pick("eine klassische Serifenschrift für den Vorspann"), pick("eine klassische Serifenschrift"));
});

test("a missing script family named outright does not become another script face", () => {
  const installed = records(["Monaco", "Arial", "Zapfino"]);
  for (const phrase of ["Brush Script", "Brush Scrip"]) assert.equal(fontChoice(phrase, installed).deterministic({ phrase }), "none", phrase);
});
