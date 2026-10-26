// Request words for how wide a light's beam is and how far a shadow sits from its object, in every language: the beam, the spotlight or the cone made wider or tighter; the shadow moved off, apart or given more room.
import type { ConceptRow } from "./resolution-concepts.js";
import { across } from "./resolution-word-pairs.js";

const BEAMS =
  "beam, spotlight, spot, light cone, cone, cone of light, " +
  "haz, haz de luz, foco, cono, cono de luz, " +
  "strahl, lichtstrahl, scheinwerfer, kegel, lichtkegel, " +
  "faisceau, projecteur, cone, cone de lumiere, " +
  "ビーム, スポットライト, スポット, 光束, 円錐, " +
  "光束, 光线, 聚光灯, 光锥, 光柱";

const WIDTHS =
  "wide, wider, widen, narrow, narrower, tight, tighter, open, opener, broad, broader, spread, " +
  "ancho, ancha, mas ancho, ensancha, estrecha, estrecho, cerrado, abierto, mas abierto, " +
  "breit, breiter, verbreiter, schmal, schmaler, eng, enger, offen, offener, " +
  "large, plus large, elargis, serre, plus serre, ouvert, plus ouvert, etroit, resserre, " +
  "広, 狭, 絞, " +
  "窄, 宽, 开, 收, 聚";

export const SHADOWS = "shadow, shadows, sombra, sombras, schatten, ombre, ombres, 影, 阴影";

const SPACING =
  "further, farther, away, off, apart, gap, space, room, distance, closer, lift, detach, separate, pull away, far, " +
  "aleja, separa, despega, espacio, lejos, mas lejos, " +
  "weg, entfern, abstand, platz, abheben, abruecken, weiter, " +
  "ecarte, eloigne, decolle, espace, loin, davantage, " +
  "遠, 離, 浮, 空, 間隔, " +
  "间隙, 空隙, 远, 离, 抬, 距离";

/** How wide a light's beam is, and how far a shadow sits from the thing that casts it. */
export const SPREAD_WORDS: ReadonlyArray<ConceptRow> = [
  ["beam, spotlight, light cone, haz, faisceau, strahl, scheinwerfer, ビーム, 聚光灯", "beam", 1],
  [across(BEAMS, WIDTHS), "=cone_angle", 7],
  [across(SHADOWS, SPACING), "=distance", 6],
];
