// Request words too loose to name an effect alone: each is weak evidence for a few effects, enough to pick one only when the user's habit already favours it.
import type { ConceptRow } from "./resolution-concepts.js";

/** Concept rows whose weight is below the offline floor, so that a figurative or short word counts only when a habit lifts the effect it points at. */
export const HABIT_WORDS: ReadonlyArray<ConceptRow> = [
  ["zoom, zoom in, zoom in look, zooming, zoomed, zoomy, closer, enlarge, magnified, ampliar, acercar, acercamiento, vergrossern, heranzoomen, agrandir, rapprocher, ズーム, ズームイン, 拡大, 寄り, 寄る", "magnify bulge", 1],
  ["bulge out, puffy, puff up, swell, swollen, inflated, hinchar, hinchado, aufblahen, gonfler, gonfle, 膨らみ, 膨らむ, 膨らませる, ふくらみ, ふくらむ, 出っ張り", "bulge spherize magnify", 1],
  ["sparkle, sparkles, sparkling, sparkly, glitter, glittery, twinkle, twinkling, gleam, glisten, shiny, brillo, brillar, centelleo, centellear, funkeln, glitzern, glanz, scintiller, scintillement, etincelle, キラキラ, きらきら, きらめき, 輝き, 煌めき", "glow flare star strobe", 1],
  ["destello, destellos, resplandor, fulgor, reflejo de lente, blendenfleck, eclat de lumiere, 光の筋, 閃光", "flare glow", 1],
  ["twist, twists, twisting, twisted, twisty, wring, verdrehen, verdreht, verdrehung, drehung, retorcer, retorcido, torcer, torsion, tordre, tordu, ねじれ, ねじる, ひねり, 捻る", "twirl twister", 1],
];
