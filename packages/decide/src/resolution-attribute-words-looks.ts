// Request words for the colour of a tone, the spacing of copies and the shape of a gradient, in every language: the colour the bright or dark parts become, how far apart the echoes sit, a round gradient asked for instead of a straight one.
import type { ConceptRow } from "./resolution-concepts.js";
import { across } from "./resolution-word-pairs.js";

const COLOURS =
  "color, colors, colour, colours, " +
  "color, colores, " +
  "farbe, farben, " +
  "couleur, couleurs, " +
  "色, " +
  "颜色";

const BRIGHTS =
  "bright, brights, light areas, light parts, lighter parts, highlights, whites, white parts, " +
  "claras, claros, luminosas, luminosos, iluminadas, " +
  "hellen, helle, hell, lichter, " +
  "claires, clair, lumineuses, lumineux, " +
  "明るい, 明るいところ, 明部, " +
  "亮的, 亮部, 高光, 白色部分";

const DARKS =
  "dark parts, dark areas, darks, shadows, blacks, black parts, " +
  "oscuras, oscuros, sombras, " +
  "dunklen, dunkle, schatten, " +
  "sombres, ombres, " +
  "暗い, 影の部分, 暗部, " +
  "暗的, 阴影, 黑色部分";

const COPIES =
  "copies, echoes, echo, duplicates, " +
  "copias, ecos, eco, " +
  "kopien, echos, " +
  "echos, copies, " +
  "コピー, エコー, " +
  "副本, 回声";

const FADES =
  "fade out, fades out, fade away, dies away, die off, die out, dying out, " +
  "se desvanece, desvanecer, se apaga, " +
  "ausblenden, verblassen, abklingen, " +
  "s'estompe, s'efface, disparaitre, " +
  "消えて, 消える, フェードアウト, 薄れ, " +
  "淡出, 消失, 衰减";

const QUICKER =
  "faster, quicker, slower, sooner, " +
  "mas rapido, mas lento, " +
  "schneller, langsamer, " +
  "plus vite, plus lentement, " +
  "速く, 早く, ゆっくり, " +
  "更快, 更慢, 快一点, 慢一点";

const ECHOES =
  "echoes, echo, " +
  "ecos, eco, " +
  "echos, " +
  "echos, " +
  "エコー, " +
  "回声";

const GAPS =
  "spacing, gap, space, apart, distance, between, interval, spread, " +
  "espacio, separacion, separa, " +
  "abstand, lucke, auseinander, " +
  "espacement, ecart, ecarte, " +
  "間隔, 空き, 離, " +
  "间距, 间隔, 拉开, 距离";

const MORE =
  "more, extra, additional, add, increase, " +
  "dame mas, mas, anade, " +
  "mehr, " +
  "plus d, plus de, davantage, " +
  "増やし, 増や, もっと, " +
  "多加, 加, 多";

const ROUND_OR_STRAIGHT =
  "round, circular, radial, circle, straight, linear, " +
  "redondo, circular, radial, recto, lineal, " +
  "rund, kreisformig, radial, gerade, linear, " +
  "rond, circulaire, radial, droit, lineaire, " +
  "丸, 円形, 放射状, 丸い, 直線, リニア, 線形, " +
  "圆, 圆形, 径向, 直, 线性, 直线";

const INSTEAD =
  "instead of, rather than, not, instead, " +
  "en vez de, en lugar de, no, " +
  "statt, anstatt, nicht, " +
  "au lieu de, plutot que, pas, " +
  "ではなく, じゃなく, ではなくて, " +
  "而不是, 不要, 不是";

const GRADIENTS =
  "gradient, ramp, " +
  "degradado, " +
  "verlauf, " +
  "degrade, " +
  "グラデーション, " +
  "渐变";

/** The colour of the bright and dark parts, the gap between copies, how many copies there are, and a round gradient asked for in place of a straight one. */
export const LOOK_WORDS: ReadonlyArray<ConceptRow> = [
  [across(BRIGHTS, COLOURS), "white", 4],
  [across(DARKS, COLOURS), "black", 4],
  [across(COPIES, GAPS), "time", 4],
  [across(ECHOES, GAPS), "time", 5],
  [across(FADES, QUICKER), "decay", 4],
  [across(ECHOES, MORE), "=number_of_echoes", 5],
  [across(ROUND_OR_STRAIGHT, INSTEAD), "=ramp_shape", 5],
  [across(GRADIENTS, ROUND_OR_STRAIGHT), "=ramp_shape", 5],
];
