// Request words for the point a layer scales or turns about, in every language: a pivot named outright, or a transform said to start from a corner, an edge or the bottom.
import type { ConceptRow } from "./resolution-concepts.js";
import { chain } from "./resolution-word-pairs.js";

const TRANSFORMS =
  "scale, scaling, rotate, rotating, spin, turn, resize, grow, shrink, flip, " +
  "escal, gira, giro, rota, agrand, encog, redimension, " +
  "skalier, dreh, rotier, vergrosser, verkleiner, schrumpf, " +
  "echelle, agrandi, retreci, tourn, pivot, redimension, " +
  "回転, 拡大, 縮小, 回し, 回す, スケール, 缩放, 旋转, 放大, 缩小, 拉伸, 转动";

const OUTSETS = "from, around, about, desde, alrededor, en torno, von, um, depuis, partir, autour, 从, 围绕, 绕着, 绕";

const SPOTS =
  "corner, bottom, top, edge, side, left, right, rim, base, 底部, 顶部, 边缘, 角, 底端, 左下, 右下, 左上, 右上, 底边, " +
  "esquina, abajo, arriba, borde, lado, izquierda, derecha, " +
  "ecke, rand, unten, unter, oben, ober, seite, links, rechts, kante, " +
  "coin, bas, haut, bord, cote, gauche, droite";

const CJK_SPOTS =
  "下から, 上から, 端から, 角から, 隅から, 左から, 右から, 縁から, 底から, 下の中央から, 下の真ん中から, 端を中心に, 角を基点に, 角を中心に, 端を軸に, 角を軸に";

const CJK_CENTRES = "角为中心, 边缘为中心, 边为中心, 底部为中心, 角为轴";

/** The pivot of a transform: said by name in each language, or by where the turning or scaling starts from. */
export const PIVOT_WORDS: ReadonlyArray<ConceptRow> = [
  [
    "pivot, pivote, punto de pivote, punto de anclaje, ancla, drehpunkt, point de pivot, point pivot, point d ancrage, ancrage, ピボット, 基点, 支点, 回転軸, 中心点, 轴心, 锚点, 旋转中心, 缩放中心",
    "anchor",
    10,
  ],
  [
    `${chain(TRANSFORMS, OUTSETS, SPOTS)}, ${chain(OUTSETS, SPOTS, TRANSFORMS)}, ${chain(CJK_SPOTS, TRANSFORMS)}, ${chain("以", CJK_CENTRES, TRANSFORMS)}`,
    "anchor",
    6,
  ],
];
