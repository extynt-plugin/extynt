// Offline picks for described fonts, Glow, Fill and Drop Shadow controls and metaphorical layer properties, each phrase in its own words and language.
import assert from "node:assert/strict";
import test from "node:test";
import { pickAttribute } from "../src/resolution-attributes.js";
import { pickFont } from "../src/resolution-fonts.js";

type Row = { key: string; names: string[]; group: string; title: string };

function named(titles: ReadonlyArray<string>, group = ""): ReadonlyArray<Row> {
  return titles.map((title) => ({ key: title, names: [title], group, title }));
}

const FAMILIES = named([
  "Arial", "Arial Black", "Arial Rounded MT Bold", "Andale Mono", "Apple Chancery", "Baskerville", "Bradley Hand", "Brush Script MT", "Calibri", "Candara", "Comic Sans MS", "Consolas",
  "Courier New", "Franklin Gothic Medium", "Garamond", "Georgia", "Helvetica", "Hiragino Sans", "Impact", "Kristen ITC", "Marker Felt", "Menlo", "Noteworthy", "Palatino",
  "Segoe Print", "Segoe Script", "Segoe UI", "Times New Roman", "Trebuchet MS", "Verdana", "Zapfino", "DIN Condensed", "Optima", "Futura",
]);

const SANS = ["Arial", "Helvetica", "Franklin Gothic Medium", "Segoe UI", "Calibri", "Futura", "Candara", "Trebuchet MS", "Verdana"];
const ROUNDED = ["Arial Rounded MT Bold", "Hiragino Sans", "Comic Sans MS", "Kristen ITC", "Marker Felt", "Noteworthy"];
const SPORTY = ["Impact", "Arial Black", "DIN Condensed", "Franklin Gothic Medium"];
const MONO = ["Andale Mono", "Consolas", "Courier New", "Menlo"];
const SERIF = ["Baskerville", "Garamond", "Georgia", "Palatino", "Times New Roman"];
const HAND = ["Bradley Hand", "Marker Felt", "Noteworthy", "Segoe Print", "Kristen ITC"];
const SCRIPT = ["Apple Chancery", "Brush Script MT", "Segoe Script", "Zapfino"];

const LOOKS: ReadonlyArray<readonly [accepted: ReadonlyArray<string>, phrases: ReadonlyArray<string>]> = [
  [ROUNDED, ["a soft rounded face for a toddler channel", "freundliche runde Schrift für ein Kinderbuch", "tipografía amigable y redondeada para peques", "une police ronde et amicale pour un dessin animé", "子供向けのやさしい丸ゴシック"]],
  [SPORTY, ["a punchy sporty typeface for team jerseys", "sportliche kräftige Schrift für ein Fußballplakat", "letra deportiva y contundente para un equipo", "police sportive très grasse pour un maillot", "スポーツチーム向けの太いフォント"]],
  [MONO, ["a terminal style typeface", "Schrift wie in einem Terminal", "una fuente que parezca de consola de programador", "une police à chasse fixe pour du code", "コードエディタ風の等幅フォント"]],
  [SANS, ["a grotesk for the headline", "eine nüchterne Grotesk", "una tipografía de palo seco", "une grotesque neutre", "シンプルなサンセリフ体"]],
  [SERIF, ["eine klassische Serifenschrift für den Roman", "a classic serif for a book cover", "una serif clásica para un libro", "une serif classique et sobre", "クラシックなセリフ体で"]],
  [HAND, ["handwriting like a diary page", "eine Handschrift wie im Tagebuch", "letra manuscrita informal", "une écriture manuscrite décontractée", "手書き風のフォント"]],
  [SCRIPT, ["an elegant script for wedding names", "Schreibschrift für die Einladung", "una cursiva caligráfica elegante", "une calligraphie élégante", "筆記体のようなフォント"]],
];

test("a described look picks an installed family that fits, in several languages", () => {
  const misses: string[] = [];
  for (const [accepted, phrases] of LOOKS) {
    for (const phrase of phrases) if (!accepted.includes(pickFont(phrase, FAMILIES, {}))) misses.push(`${phrase} -> ${pickFont(phrase, FAMILIES, {})}`);
  }
  assert.deepEqual(misses, []);
});

test("a family that is not installed still abstains", () => {
  assert.equal(pickFont("Futura Display Condensed Pro Max", FAMILIES, {}), "none");
  assert.equal(pickFont("something with a nice vibe", FAMILIES, {}), "none");
});

const GLOW = named(["Glow Based On", "Glow Threshold", "Glow Radius", "Glow Intensity", "Composite Original", "Glow Operation", "Glow Colors", "Color Looping", "Color Phase", "A & B Midpoint", "Color A", "Color B"]);
const FILL = named(["Fill Mask", "All Masks", "Color", "Invert", "Horizontal Feather", "Vertical Feather", "Opacity"]);
const SHADOW = named(["Shadow Color", "Opacity", "Direction", "Distance", "Softness", "Shadow Only"]);
const LAYER = named(["Anchor Point", "Position", "Scale", "Rotation", "Opacity"]);
const TEXT = named(["Source Text", "Path Options", "More Options", "Transform"]);

const CONTROLS: ReadonlyArray<readonly [owner: string, list: ReadonlyArray<Row>, wanted: string, phrases: ReadonlyArray<string>]> = [
  ["Glow", GLOW, "Color A", ["set the first glow colour to amber", "Farbe A auf Orange", "cambia el color A", "mets la couleur 1 en rouge", "色Aを青にして"]],
  ["Glow", GLOW, "Color B", ["second colour should be violet", "Farbe B anpassen", "pon el segundo color en verde", "couleur 2 plus claire", "二つ目の色を変えて"]],
  ["Glow", GLOW, "Glow Operation", ["pick another blend mode for the glow", "wie der Glow mischt", "modo de fusión del brillo", "mode de fusion de la lueur", "グローの描画モード"]],
  ["Glow", GLOW, "Composite Original", ["keep the footage underneath the glow", "Originalbild behalten", "conserva la imagen de abajo", "garde l'image d'origine", "元画像を残して"]],
  ["Fill", FILL, "All Masks", ["apply it to each mask", "auf alle Masken anwenden", "en todas las máscaras", "sur tous les masques", "すべてのマスクに"]],
  ["Fill", FILL, "Color", ["turn it coral", "make it mint", "hazlo turquesa", "mach es lila", "ミントにして"]],
  ["Fill", FILL, "Horizontal Feather", ["feather the sides horizontally", "Kanten horizontal weichzeichnen", "calar los bordes en horizontal", "adoucir les bords à l'horizontale", "水平方向に境界をぼかす"]],
  ["Drop Shadow", SHADOW, "Softness", ["crisper shadow edge", "weichere Schattenkanten", "bordes de la sombra más suaves", "bords de l'ombre plus doux", "影の縁をやわらかく"]],
];

test("Glow, Fill and Drop Shadow controls resolve from plain speech in several languages", () => {
  const misses: string[] = [];
  for (const [owner, list, wanted, phrases] of CONTROLS) {
    for (const phrase of phrases) if (pickAttribute(phrase, owner, list) !== wanted) misses.push(`${phrase} -> ${pickAttribute(phrase, owner, list)} (${wanted})`);
  }
  assert.deepEqual(misses, []);
});

test("gradually is not a number of degrees, and an amount like a bit is no colour A", () => {
  assert.equal(pickAttribute("let it fade away gradually", "Layer", LAYER), "Opacity");
  assert.equal(pickAttribute("make it vanish step by step", "Layer", LAYER), "Opacity");
  assert.equal(pickAttribute("lass es langsam verschwinden", "Layer", LAYER), "Opacity");
  assert.equal(pickAttribute("rotate it 20 Grad", "Layer", LAYER), "Rotation");
  assert.notEqual(pickAttribute("make the colour a bit warmer", "Glow", GLOW), "Color A");
});

const PROPERTIES: ReadonlyArray<readonly [owner: string, list: ReadonlyArray<Row>, wanted: string, phrases: ReadonlyArray<string>]> = [
  ["Layer", LAYER, "Opacity", ["have it ghost out", "dissolve it into nothing", "hazlo esfumarse", "fais-le disparaître", "フェードアウトさせて"]],
  ["Layer", LAYER, "Scale", ["doppelt so groß", "dobla su tamaño", "il faut le doubler", "double it", "二倍にして"]],
  ["Text layer", TEXT, "Path Options", ["bend the lettering along the baseline", "Text entlang einer Kurve biegen", "que el texto siga una curva", "texte courbé sur un arc", "文字をカーブに沿わせる"]],
];

test("metaphors reach the layer and text property", () => {
  const misses: string[] = [];
  for (const [owner, list, wanted, phrases] of PROPERTIES) {
    for (const phrase of phrases) if (pickAttribute(phrase, owner, list) !== wanted) misses.push(`${phrase} -> ${pickAttribute(phrase, owner, list)} (${wanted})`);
  }
  assert.deepEqual(misses, []);
});

test("a quantified request that no control names still sweeps to none", () => {
  const blur = named(["Blurriness", "Blur Dimensions"]);
  assert.equal(pickAttribute("blurriness on each mask", "Gaussian Blur", blur), "none");
});
