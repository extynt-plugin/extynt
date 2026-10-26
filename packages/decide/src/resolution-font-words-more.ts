// More request words for the look of a typeface: French, Chinese and Korean ways of describing handwriting, typewriter, monospace, serif and sans looks, and programming fonts.
import type { ConceptRow } from "./resolution-concepts.js";

/** Concept rows from look words to the style tags of resolution-font-tags, beyond the base table. */
export const MORE_LOOK_WORDS: ReadonlyArray<ConceptRow> = [
  ["ecriture manuscrite, manuscrite, ecrite a la main, a la main, cursive, script elegant, 手写, 手寫, 手写体, 손글씨, 필기체", "hand", 3],
  ["machine a ecrire, 打字机, 打字機, 타자기", "typewriter", 4],
  ["chasse fixe, a chasse fixe, fuente de codigo, fuente de programacion, codigo, programacion, 等宽, 等寬, 고정폭, 코딩", "mono code", 3],
  ["empattement, avec empattement, 衬线, 襯線, 세리프, 명조", "serif", 2],
  ["sans empattement, 无衬线, 無襯線, 산세리프, 고딕", "sans", 2],
  ["gras, tres gras, 粗体, 굵은", "heavy", 2],
  ["arrondie, arrondi, 圆体, 圓體, 둥근", "rounded", 3],
  ["retro, ancien, ancienne, 复古, 復古, 레트로", "retro", 2],
  ["comme un journal, como un diario, como periodico", "news serif", 3],
  ["etroite, condense, condensee, 窄体, 좁은", "condensed", 3],
  ["calligraphie, calligraphique, 书法, 書法, 캘리그라피, kalligrafisch, kalligrafische, kalligraphisch, 毛筆, 筆文字, 筆書き", "script", 3],
];
