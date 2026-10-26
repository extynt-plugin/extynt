// Request words for the parts of a glow, a shadow and a mosaic, in every language: which areas glow, how far a glow reaches, how strong it is, which way a shadow falls and how soft it is, how many blocks run across or down.
import type { ConceptRow } from "./resolution-concepts.js";
import { SHADOWS } from "./resolution-attribute-words-spread.js";
import { across } from "./resolution-word-pairs.js";

const ONLY =
  "only, just, " +
  "solo, solamente, " +
  "nur, " +
  "seul, seule, seules, seuls, " +
  "だけ, " +
  "只";

const HOTTEST =
  "brightest, hottest, lightest, hot, " +
  "claras, calientes, luminosas, " +
  "hellsten, heissesten, hellen, hellste, " +
  "claires, chaudes, lumineuses, " +
  "明るい, 熱い, 一番明るい, " +
  "亮, 热, 最亮, 最热";

const SPREADS =
  "spread, spreads, bleed, bleeds, reach, reaches, extend, extends, carry, " +
  "difumine, desborde, extienda, alcance, " +
  "ausbluten, ausbreiten, reicht, " +
  "deborde, rayonne, etale, " +
  "にじま, 広が, 届, " +
  "晕, 扩散, 散, 蔓延";

const FAR =
  "far, further, farther, " +
  "lejos, mas lejos, " +
  "weiter, " +
  "loin, plus loin, " +
  "遠く, " +
  "远, 更远";

const STRONG =
  "strong, stronger, strength, intensity, power, powerful, " +
  "fuerte, fuerza, intensidad, " +
  "stark, starke, intensitat, " +
  "fort, forte, force, intensite, puissance, " +
  "強, 強い, 強さ, 強度, " +
  "强, 强度, 强烈";

const STRENGTH =
  "strength, intensity, power, " +
  "fuerza, intensidad, " +
  "starke, stärke, staerke, intensitat, " +
  "force, intensite, puissance, " +
  "強さ, 強度, " +
  "强度";

const HOW =
  "how, " +
  "que tan, cuanto, " +
  "wie, " +
  "a quel point, " +
  "どれくらい, " +
  "有多";

const FALLS =
  "falls, fall, falling, cast, casts, " +
  "caiga, cae, cayendo, " +
  "fallt, fallen, falle, " +
  "tombe, tomber, " +
  "落ち, 落ちる, " +
  "落, 落在, 落向";

const SIDES =
  "side, left, right, " +
  "lado, izquierda, derecha, " +
  "seite, links, rechts, " +
  "cote, gauche, droite, " +
  "側, 左, 右, " +
  "侧, 左边, 右边";

const SOFTER =
  "soft, softer, diffuse, diffused, blurry, blurrier, fuzzy, " +
  "difusa, difuso, suave, mas suave, " +
  "weicher, diffuser, diffus, " +
  "doux, plus doux, diffuse, " +
  "柔らか, 拡散, ぼかし, " +
  "扩散, 柔和";

const BLOCKS =
  "block, blocks, tile, tiles, " +
  "bloque, bloques, " +
  "block, blocke, kachel, kacheln, " +
  "bloc, blocs, tuile, tuiles, " +
  "ブロック, " +
  "方块, 块";

const SIDEWAYS =
  "side by side, across, left to right, sideways, " +
  "lado a lado, de izquierda a derecha, " +
  "nebeneinander, von links nach rechts, " +
  "cote a cote, de gauche a droite, " +
  "左右, 横, 左から右, " +
  "左右, 横向";

const UPDOWN =
  "top to bottom, up and down, stacked, " +
  "arriba abajo, de arriba abajo, " +
  "ubereinander, uebereinander, von oben nach unten, " +
  "de haut en bas, les uns sur les autres, " +
  "上下, 縦, 上から下, " +
  "上下, 纵向";

/** The areas a glow lights, how far and how strongly, the side a shadow falls on and how diffuse it is, and the blocks of a mosaic counted across and down. */
export const PART_WORDS: ReadonlyArray<ConceptRow> = [
  [across(ONLY, HOTTEST), "threshold", 5],
  [across(SPREADS, FAR), "radius", 5],
  [across(HOW, STRONG), "intensity amount strength", 4.5],
  [STRENGTH, "intensity amount strength", 4.5],
  [across(FALLS, SIDES), "direction", 5],
  [across(SHADOWS, SOFTER), "softness diffusion", 5],
  [across(BLOCKS, SIDEWAYS), "horizontal", 5],
  [across(BLOCKS, UPDOWN), "vertical", 5],
];
