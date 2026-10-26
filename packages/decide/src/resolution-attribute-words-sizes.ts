// Request words for how big or how strong a distortion is, in every language: the size of a swirl, how far it turns, the height and the length of a wave.
import type { ConceptRow } from "./resolution-concepts.js";
import { across } from "./resolution-word-pairs.js";

const SWIRLS =
  "swirl, swirls, twirl, spiral, vortex, whirl, whirlpool, " +
  "remolino, remolinos, torbellino, espiral, vortice, " +
  "wirbel, strudel, spirale, " +
  "tourbillon, spirale, vortex, " +
  "渦, 渦巻, 旋涡, 漩涡, 螺旋";

const BIGNESS =
  "size, big, bigger, large, larger, huge, area, zone, extent, range, region, " +
  "tamano, grande, grandes, mas grande, zona, area, rango, " +
  "grosse, gross, grosser, bereich, ausdehnung, " +
  "taille, grand, grande, plus grand, plus grande, zone, etendue, " +
  "大き, 範囲, 大小, 広さ, " +
  "大小, 大, 区域, 范围, 面积";

const TURNS =
  "spin, spins, turn, turns, twist, twists, rotate, rotates, wind, " +
  "gira, giran, retuerc, retuerz, torsion, " +
  "dreht, dreh, verdreh, verdrehen, " +
  "tourne, tourner, tord, tordre, torsion, " +
  "回る, 回し, 回って, ねじ, ひねり, " +
  "旋转, 转, 扭, 拧";

const DEGREE =
  "much, hard, harder, tight, tighter, tightly, more, most, how, extra, " +
  "cuanto, apret, mas, fuerte, " +
  "stark, starker, eng, enger, mehr, wie, " +
  "combien, serre, davantage, plus, point, fort, " +
  "どれだけ, どれくらい, もっと, 強, きつ, " +
  "多少, 有多, 多一点, 紧, 更, 再";

const WAVES =
  "wave, waves, crest, crests, ripple, ripples, " +
  "ola, olas, cresta, crestas, " +
  "welle, wellen, wellenkamm, wellenkamme, wellenberg, " +
  "vague, vagues, crete, cretes, " +
  "波, 波頭, 波浪, 波峰, 波纹";

const TALLER =
  "big, bigger, large, larger, high, higher, tall, taller, huge, " +
  "grande, grandes, mas grande, mas grandes, alta, altas, mas alta, mas altas, " +
  "gross, grosser, grossere, hoch, hoher, hohere, " +
  "grand, grands, grandes, plus grand, plus grandes, plus gros, plus grosses, plus haut, plus hautes, haut, " +
  "大き, 高, 高く, " +
  "大, 高, 大一点, 调高";

const LONGER =
  "wide, wider, long, longer, broad, broader, stretched, " +
  "ancha, anchas, mas ancha, mas anchas, larga, largas, mas larga, mas largas, " +
  "breit, breiter, lang, langer, lange, " +
  "large, larges, plus large, plus larges, long, longue, longues, plus long, plus longue, plus longues, " +
  "長, 広, 幅, " +
  "宽, 长, 变宽, 拉长, 加宽";

/** The size of a swirl, how far it turns, and the height and length of a wave. */
export const SIZE_WORDS: ReadonlyArray<ConceptRow> = [
  ["swirl, swirls, twirl, spiral, vortex, remolino, torbellino, wirbel, tourbillon, 渦, 旋涡, 漩涡", "swirl", 1],
  ["wave, waves, crest, crests, ola, olas, cresta, crestas, welle, wellen, wellenkamm, vague, vagues, crete, cretes, 波, 波頭, 波浪, 波峰", "wave", 1],
  [across(SWIRLS, BIGNESS), "radius", 5],
  [across(TURNS, DEGREE), "angle", 5],
  [across(WAVES, TALLER), "height", 5],
  [across(WAVES, LONGER), "width", 5],
];
