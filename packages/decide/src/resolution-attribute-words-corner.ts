// Request words for the roundness of corners, in every language: the corners of a rectangle made softer, rounder, less sharp or less pointed.
import type { ConceptRow } from "./resolution-concepts.js";
import { across } from "./resolution-word-pairs.js";

const CORNERS =
  "corner, corners, esquina, esquinas, ecke, ecken, coin, coins, angle, angles, 角, 四隅, 角張, 四个角, 四角";

const SOFTNESS =
  "soft, softer, soften, round, rounder, rounded, smooth, smoother, sharp, pointy, pointed, spiky, blunt, gentler, " +
  "suave, suaves, redond, afilad, puntiagud, punta, suaviza, " +
  "weich, rund, abrund, scharf, spitz, glatt, " +
  "doux, douce, adouc, rond, arrondi, pointu, aigu, " +
  "柔らか, 丸, 尖, 滑らか, " +
  "柔和, 磨圆, 圆, 尖, 光滑, 圆润";

/** The roundness of corners, said of a corner and how soft, round or sharp it is. */
export const CORNER_WORDS: ReadonlyArray<ConceptRow> = [
  ["corner, corners, esquina, esquinas, ecke, ecken, coin, coins", "corner", 1],
  [across(CORNERS, SOFTNESS), "=roundness", 6],
];
