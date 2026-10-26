// Request words for the transform properties of a layer in everyday language and in other languages: how someone asks for opacity, scale, position, rotation or the anchor point without saying the property's name.
import type { ConceptRow } from "./resolution-concepts.js";

/** Rows for the five transform properties, beyond the base attribute table. */
export const TRANSFORM_WORDS: ReadonlyArray<ConceptRow> = [
  ["solid, opaque, 不透明度, 透明度, more opaque, fully visible, full strength, undurchsichtig, durchsichtig, opaco, más opaco, transparencia, transparente, semitransparente, 半透明, 透け, 透かし, transparence", "opacity", 3],
  ["double the size, twice the size, twice as big, half the size, half as big, blow it up, magnify, scale up, scale down, scaling, más grande, más pequeño, agrandir, agrandis, rétrécir, réduis, skalierung, escala, スケール, 拡大率, 倍", "scale", 3],
  ["in the corner, into the corner, to the corner, centre it, center it, centred, centered, on screen, onscreen, where it sits, location, placement, whereabouts, to the left, to the right, a la izquierda, a la derecha, izquierda, derecha, arriba, abajo, vers le haut, vers le bas, gauche, droite, links, rechts, oben, unten, posición, posicion, positionner, platzier, 位置, 左へ, 右へ, 上へ, 下へ, 右に, 左に", "position", 3],
  ["nudge, shove, pixels to the, px to the", "position", 3],
  ["tilt, tilted, upside down, crooked, slanted, straighten, level it, twist it, rotate by, drehung, rotación, rotacion, pivoter, fais-le pivoter, gíralo, giralo, dreh, grad, 傾け, 傾き, 回して, 逆さ", "rotation", 3],
  ["from the bottom left, from the top left, from the bottom, from the top", "anchor", 3],
  ["around its corner, from its corner, from the corner, around its centre, around its center, pivot around, centre point of rotation, center point of rotation, origin of the rotation, origin of the scale, punto de anclaje, punto de pivote, point d'ancrage, ankerpunkt, アンカーポイント, 基準点", "anchor", 5],
];
