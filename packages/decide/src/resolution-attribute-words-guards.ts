// Request words for the quantities an effect either has or lacks, in every language: how fast something runs and which way it points. Asked of an effect with no such control they answer none.
import type { ConceptRow } from "./resolution-concepts.js";

/** Speed and angle said outright, held firmly enough that an effect without the control is not given another one. */
export const QUANTITY_WORDS: ReadonlyArray<ConceptRow> = [
  [
    "how fast, how quick, faster, speed, speeds, quicker, ~geschwindigkeit, wie schnell, schneller, schnell, velocidad, que tan rapido, mas rapido, rapido, vitesse, a quelle vitesse, plus vite, plus rapide, rapide, " +
      "どれくらい速, どれだけ速, もっと速, 速く, 速い, スピード, 速度, 多快, 快一点, 更快, 速度快",
    "speed rate velocity",
    5,
  ],
  [
    "angle, angles, winkel, angulo, angulos, 角度",
    "angle direction",
    5,
  ],
  [
    "color of, colors of, colour of, farbe des, farbe der, farbe von, color del, color de la, couleur du, couleur de la, couleur des, 色, 颜色",
    "color",
    5,
  ],
];
