// Request words for dialling an effect's main amount up or down ("more glow pls", "too strong, tone it down") and for spreading letters apart.
import type { ConceptRow } from "./resolution-concepts.js";

/** Concept rows for the casual ways of asking for more or less of an effect, which mean its strength control, and for the spacing between letters, which means tracking. */
export const ADJUST_WORDS: ReadonlyArray<ConceptRow> = [
  [
    "more glow, less glow, more blur, less blur, more shadow, less shadow, more of it, less of it, tone it down, tone down, toned down, dial it back, dial back, dial it down, dial down, " +
    "turn it down, turn down, dial the glow back, dial the blur back, dial the shadow back, back it off, back off, ease off, ease it off, pull it back, too strong, too intense, too much, too heavy, too harsh, too powerful, too bright, weaker, subtler, stronger, mehr glow, weniger glow, mehr unschärfe, " +
    "weniger unschärfe, mehr schatten, weniger schatten, zu stark, zu viel, más brillo, menos brillo, más desenfoque, menos desenfoque, más sombra, menos sombra, demasiado fuerte",
    "amount strength level opacity blurriness intensity",
    3,
  ],
  [
    "apart, letters apart, spread the letters, spread letters, space the letters, space out the letters, spacing between letters, distance between letters, space between letters, letter spacing, " +
    "kerning, tracking, auseinander, laufweite, buchstabenabstand, zeichenabstand, abstand zwischen den buchstaben, espaciado, espacio entre letras, separar las letras, separa las letras, " +
    "字間, 文字間, トラッキング",
    "tracking",
    5,
  ],
];
