// Vague nouns for a whole family of effects ("the colour thing"): weak evidence for the family's usual members, enough to pick one only when the user's habit already favours it.
import type { ConceptRow } from "./resolution-concepts.js";

/** Concept rows whose weight is below the offline floor, so that a vague family word names an effect only through the user's habit. */
export const VAGUE_WORDS: ReadonlyArray<ConceptRow> = [
  [
    "colour thing, color thing, colour one, color one, colour stuff, color stuff, colour effect, color effect, colour look, color look, colour wash, color wash, colour tweak, color tweak, " +
    "farbding, farbdings, farbeffekt, farbeffekte, lo del color, el del color, efecto de color, effet de couleur, 色のやつ, 色のエフェクト, 色味のやつ",
    "tint colorama balance photo filter hue change vibrance selective",
    1,
  ],
];
