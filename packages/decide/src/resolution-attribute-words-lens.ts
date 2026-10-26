// Request words for a camera's focus and for blur turned up or down, in every language: the background defocused, a subject brought into focus, a blur made stronger or weaker.
import type { ConceptRow } from "./resolution-concepts.js";
import { across } from "./resolution-word-pairs.js";

const BACKGROUNDS =
  "background, " +
  "fondo, " +
  "hintergrund, " +
  "arriere plan, arriere, " +
  "後ろ, 背景, " +
  "背景, 背后";

const DEFOCUS =
  "defocus, blur, bokeh, " +
  "desenfoque, " +
  "defokus, unscharfe, " +
  "defocalisation, flou, " +
  "デフォーカス, ボケ, ぼかし, " +
  "失焦, 模糊, 虚化";

const FOCUSING =
  "focus, in focus, sharp, " +
  "enfoca, enfoque, en foco, " +
  "scharf, fokussier, " +
  "net, nettete, mise au point, " +
  "ピント, 焦点, " +
  "焦点, 对焦, 聚焦";

const SUBJECTS =
  "foreground, background, subject, logo, " +
  "primer plano, fondo, sujeto, " +
  "vordergrund, hintergrund, motiv, " +
  "premier plan, arriere plan, sujet, " +
  "前景, 被写体, ロゴ, " +
  "前景, 背景, 标志, 主体";

const BLURS =
  "blur, " +
  "desenfoque, difumin, desenfoc, " +
  "unscharfe, verschwommen, verwisch, " +
  "flou, " +
  "ぼかし, " +
  "模糊";

const TURNS =
  "up, down, crank, turn, raise, lower, increase, decrease, reduce, boost, max, " +
  "sube, baja, aumenta, reduce, " +
  "erhoh, senke, viel, " +
  "monte, baisse, augmente, diminue, fond, " +
  "増, 減, 強, 弱, " +
  "调, 最大, 减弱, 加强, 增强, 调低, 调高";

/** The blur of a camera's background, the subject it focuses on, and a blur asked for more or less. */
export const LENS_WORDS: ReadonlyArray<ConceptRow> = [
  [across(BACKGROUNDS, DEFOCUS), "=blur_level", 7],
  [across(FOCUSING, SUBJECTS), "=focus_distance", 6],
  [across(BLURS, TURNS), "blurriness amount radius strength", 4.5],
];
