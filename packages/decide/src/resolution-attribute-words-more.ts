// More request words for effect controls and layer properties: Glow colour pair, blend operation and original, Fill masks, feather and colour names, shadow edge, fading, doubling and text on a path.
import type { ConceptRow } from "./resolution-concepts.js";

/** Rows for the controls and properties that plain speech reaches by metaphor, colour name or position in a pair, beyond the base tables. */
export const MORE_ATTRIBUTE_WORDS: ReadonlyArray<ConceptRow> = [
  ["colour a, color a, first colour, first color, first glow colour, first glow color, colour one, color one, colour 1, color 1, farbe a, erste farbe, primer color, premiere couleur, couleur 1, 色a, 1つ目の色, 最初の色, 一つ目の色", "a", 4],
  ["colour b, color b, second colour, second color, second glow colour, second glow color, colour two, color two, colour 2, color 2, farbe b, zweite farbe, segundo color, seconde couleur, deuxieme couleur, couleur 2, 色b, 2つ目の色, 二つ目の色", "b", 4],
  ["midpoint, mid point, middle point, balance between, where the colours meet, where the colors meet, how the two colours mix, how the two colors mix, mittelpunkt, punto medio, point milieu, 中間点", "midpoint", 4],
  ["glow farben, farben des glow, a and b colors, a and b colours, two tone, two tones, duotone, glow palette, glow gradient, farbpalette, paleta de colores", "colors", 3],
  ["picture underneath, image underneath, footage underneath, picture beneath, image beneath, keep the picture, keep the image, keep the footage, keep the source, source footage, original footage, original picture, original behalten, originalbild, bild darunter, image d'origine, image originale, imagen de abajo, 元の映像, 元画像, 元のまま, 下の映像", "original composite", 3],
  ["every mask, each mask, all masks, jede maske, alle masken, cada mascara, todas las mascaras, chaque masque, tous les masques, toutes les masques, 全マスク, すべてのマスク, 全てのマスク", "all", 4],
  ["weichzeichnung, kantenweichzeichnung, weiche kante, weiche kanten, kantenschaerfe, federn, feder, calado, calar, contour progressif, adoucir les bords, 境界のぼかし, エッジのぼかし, 縁をぼかす, 輪郭をぼかす", "feather", 3],
  ["shadow edge, shadow edges, edge of the shadow, shadows edge, blur the shadow, shadow blur, blurry shadow, hard edge, hard edged, hard shadow, crisp edge, crisp shadow, sharp edge, sharp shadow, sharper shadow, harder shadow, harder edge, schattenkante, schattenrand, borde de la sombra, bordes de la sombra, bord de l'ombre, bords de l'ombre, 影の縁, 影のエッジ, 影の端", "softness", 4],
  ["doux, douce, plus doux, plus douce, adoucir, adoucis", "softness feather", 3],
  ["dissolve, dissolves, dissolve away, evaporate, evaporates, go away, goes away, slip away, melt away, wipe away, invisible, unseen, verschwinden, verschwinde, verschwindet, ausblenden, ausgeblendet, desaparecer, desaparece, esfumar, desvanecer, desvanece, disparaitre, disparait, estomper, fondu, フェード, 消える, 消して, 見えなく, 透明に", "opacity", 3],
  ["double it, doubled, double, doppelt, verdoppeln, verdopple, verdoppelt, duplica, duplicalo, dobla, doblalo, doubler, double le, zweimal so, dos veces, deux fois, 半分, 倍に", "scale", 3],
  ["baseline, along the baseline, on the baseline, bend, bends, bent, bending, wrap, wraps, arch, arched, arc, along a curve, along the curve, around a circle, circular, kurve, bogen, entlang, curva, courbe, 湾曲, カーブ", "path", 3],
];

/** Colour names a request may use in place of the word colour. */
export const COLOUR_NAME_WORDS: ReadonlyArray<ConceptRow> = [
  ["mint, coral, lavender, salmon, turquoise, crimson, scarlet, maroon, burgundy, olive, lime, indigo, peach, beige, cream, ivory, khaki, aqua, aquamarine, azure, cobalt, sky blue, sea green, forest green, emerald, ruby, amber, lilac, mauve, plum, fuchsia, charcoal, slate, lemon, mustard, rust, copper, bronze, tangerine, apricot, orchid, sand, cherry, chocolate, mocha, teal blue, hot pink, neon green, off white", "color", 2],
  ["rot, grun, gelb, blau, schwarz, weiss, rosa, lila, turkis, minze, minzgrun, korall, hellblau, dunkelblau, hellgrun, dunkelgrun, grau, braun, golden, silbern", "color", 2],
  ["rojo, verde, amarillo, azul, negro, blanco, rosado, morado, naranja, turquesa, menta, celeste, gris, marron, dorado, plateado, violeta, lavanda", "color", 2],
  ["rouge, vert, jaune, bleu, noir, blanc, violet, turquoise, menthe, corail, gris, marron, orange, dore, argente, lavande", "color", 2],
  ["赤, 青, 緑, 黄色, 白, 黒, ピンク, ミント, コーラル, 水色, 紫, オレンジ, 灰色, 金色, 銀色", "color", 2],
];
