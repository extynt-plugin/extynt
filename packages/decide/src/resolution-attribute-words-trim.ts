// Request words for the ends of a drawn line in every language: the front end (start), the tail (end) and a dashed pattern running along the path (offset).
import type { ConceptRow } from "./resolution-concepts.js";
import { across } from "./resolution-word-pairs.js";

const LINES = "line, stroke, path, outline, linea, trazo, contorno, linie, strich, kontur, pfad, ligne, trait, trace, contour";

/** Rows for the front end, the tail and the travelling pattern of a line that is drawn on: what a designer calls its ends or its movement along the path. */
export const TRIM_WORDS: ReadonlyArray<ConceptRow> = [
  [
    "front end of the line, front end of the stroke, front end, front of the line, leading end, head of the line, head of the stroke, near end of the line, first end of the line, beginning of the line, forward end, " +
    "extremo delantero, extremo frontal, punta delantera, parte delantera de la linea, cabeza de la linea, principio del trazo, " +
    "vordere ende der linie, vorderes ende der linie, vorderen ende der linie, vorderes ende, vordere ende, vorderen ende, kopf der linie, anfang des strichs, " +
    "extremite avant, bout avant, bout de devant, tete du trait, tete de la ligne, avant du trait, " +
    "先頭側の端, 先頭の端, 先端, 前側の端, 手前側の端, 線の先頭, 始まりの端, 始まり側, 前端, 线条前端, 线的前端, 线头, 线的头部, 开头一端, 起头, " +
    across(LINES, "starts, begins, should start, should begin, starts from, begins from, empiece, empieza, comience, comienza, beginnen, beginnt, anfangen, startet, commence, commencer, demarre, debute"),
    "start",
    5,
  ],
  [
    "starts from, begins from, start from the middle, begin from the middle, start from the center, begin from the center, start in the middle, begin in the middle, " +
    "desde el centro, desde el medio, in der mitte beginnen, in der mitte anfangen, au milieu, depuis le milieu, a partir du milieu, から始め, から始まる, からスタート, 始め, 始まる, 从中间开始, 从中心开始, 从中央开始, 从头开始, 开始",
    "start",
    4,
  ],
  [
    "tail of the line, tail of the stroke, tail of the path, tail end, trailing end, far end, other end, back end of the line, rear end, finish of the line, finishing end, last end of the line, " +
    "cola de la linea, cola del trazo, extremo final, extremo trasero, otro extremo, punta final, final de la linea, " +
    "schwanz der linie, schwanz des strichs, schweif der linie, hinteres ende, hintere ende, hinteren ende, anderes ende, anderen ende, " +
    "queue du trait, queue de la ligne, extremite arriere, extremite finale, l autre bout, autre bout, bout arriere, bout final, " +
    "線の尻尾, 尻尾, しっぽ, 後端, 末端, 終わりの端, 後ろ側の端, 终点一端, 尾巴, 线的末端, 末端, 后端, 尾端, 线条尾部, 线的尾部, 线尾, " +
    across(LINES, "ends, finishes, stops, should end, should stop, ends at, stops at, termine, termina, acabe, acaba, finalice, endet, enden, aufhort, stoppt, finit, finisse, s arrete"),
    "end",
    5,
  ],
  [
    "stop earlier, stops earlier, end earlier, ends earlier, stop sooner, end sooner, finish earlier, finish sooner, antes, fruher, plus tot, 止めて, 止まる, 手前で止, 停下, 停止, 早点停",
    "end",
    4,
  ],
  [
    across("dash, dashes, dashed line, dotted line, dotted, pattern of dashes, dash pattern, dashes pattern, guion, guiones, rayas, linea discontinua, linea punteada, striche, strichmuster, gestrichelte linie, tirets, trait discontinu, ligne pointillee, " +
      "ダッシュ, 破線, 点線, 虚线, 点线", "chase, chases, run, runs, race, travel, crawl, march, slide, slides, sliding, move, moves, flow, scroll, shift, circle, corra, corre, correr, deslice, desliza, deslizar, mueva, mueve, recorra, laufen, lauf, lasst, schieb, schieben, wandern, bewegen, gleiten, courir, courent, glisser, glissent, defiler, 走らせ, 滑らせ, 動かし, 流し, 移動, 跑, 滑动, 移动, 滚动, 流动, 走"),
    "offset",
    5,
  ],
  [
    "chase, chasing, chases, race around, run around, runs around, crawl around, march around, travel around, slide around, slide along, move along the, run along, laufen lassen, um die form laufen, entlang laufen, " +
    "alrededor de la forma, corra alrededor, corre alrededor, hacer correr, fais courir, fais glisser, le long du contour, autour de la forme, 走らせて, 走らせ, 滑らせて, 滑らせ, 沿って滑, 沿って動, 绕着, 跑, 滑动, 沿着轮廓",
    "offset",
    4,
  ],
];
