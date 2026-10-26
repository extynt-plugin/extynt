// The word "ramp", read by its context: a colour or gradient ramp, a timing or easing ramp, or unclear and so left to the model.
import { foldRequest, unionRegex } from "./request-text.js";

type RampReading = "gradient" | "timing" | "ambiguous" | "none";

const WORD_START = "(?<![\\p{L}\\p{N}])";
const WORD_END = "(?![\\p{L}\\p{N}])";
const word = (pattern: string): string => `${WORD_START}(?:${pattern})${WORD_END}`;

/** The word itself, in English and Spanish, as a whole word. */
export const RAMP_WORD: RegExp = new RegExp(word("ramps?|rampas?"), "giu");

const SPEED_BEFORE = "(?<!(?:speed|velocity|velocidad|geschwindigkeit|speed-|velocity-)\\s*)";

const GRADIENT_CUE: RegExp = new RegExp(unionRegex([
  new RegExp(word("gradient\\p{L}*|degrad\\p{L}*|farbverlauf\\p{L}*|verlauf\\p{L}*"), "giu"),
  /グラデ\p{L}*|ランプ/gu,
]).source, "giu");

const COLOUR_CUE: RegExp = new RegExp(word([
  "colou?rs?|colou?red|farbe\\p{L}*|farben|fondo\\p{L}*|hintergrund\\p{L}*|background\\p{L}*|backdrop\\p{L}*|fills?|relleno|blend\\p{L}*|mezcla\\p{L}*|hues?|tints?",
  "black|white|red|blue|green|yellow|orange|purple|pink|gold|silver|grey|gray|navy|cyan|teal|magenta|violet|schwarz|weiss|rot|blau|grun|gelb|lila|rosa|azul\\p{L}*|negro|blanco|rojo|verde|amarillo|naranja|morado",
].join("|")), "giu");

const LIGHT_DARK_CUE: RegExp = new RegExp(word("(?:dark|light|hell|dunkel|oscur[oa]|clar[oa])\\s+(?:to|zu|a|hacia|nach)\\s+(?:dark|light|hell|dunkel|oscur[oa]|clar[oa])"), "giu");

const RAMP_DIRECTION: RegExp = new RegExp(word("ramp(?:s|ed|ing)?\\s+(?:it\\s+|them\\s+)?(?:up|down)"), "giu");

const TIMING_CUE: RegExp = new RegExp(unionRegex([
  new RegExp(word("anim\\p{L}*|eas(?:e|es|ed|ing|ings)|curves?|kurven?|courbes?|curvas?|speed\\p{L}*|geschwindigkeit\\p{L}*|velocit\\p{L}*|velocid\\p{L}*|vitesse|timing|tempo|rhythm\\p{L}*|ritmo|rythme|accelerat\\p{L}*|decelerat\\p{L}*|beschleunig\\p{L}*|acelera\\p{L}*|decelera\\p{L}*"), "giu"),
  new RegExp(word("keyframes?|keys|fotogramas?|motion|bewegung\\p{L}*|movimiento|mouvement|pop|pops|poppy|poppier\\p{L}*|pop-in|bounc\\p{L}*|rebot\\p{L}*|overshoot\\p{L}*|settle\\p{L}*|anticipat\\p{L}*|entrance|exit|intro|outro|einblend\\p{L}*|ausblend\\p{L}*|entrada|salida"), "giu"),
  new RegExp(word("seconds?|secs?|frames?|stagger\\p{L}*|slow\\p{L}*|fast|faster|smooth\\p{L}*|weich\\p{L}*|suave\\p{L}*|lent\\p{L}*|schnell\\p{L}*|rapid\\p{L}*|langsam\\p{L}*|lento|despacio"), "giu"),
  /イージング|アニメ\p{L}*|カーブ|速度|タイミング|緩急/gu,
]).source, "giu");

const WINDOW = 40;

function aroundEach(text: string, pattern: RegExp): boolean {
  return [...text.matchAll(RAMP_WORD)].some((match) => {
    const at = match.index ?? 0;
    const near = text.slice(Math.max(0, at - WINDOW), at + match[0].length + WINDOW);
    return near.search(pattern) >= 0;
  });
}

/** Reads the ramp words of a request: gradient when a gradient or colour word is in the request or beside a ramp, timing when a motion word is in it, ambiguous otherwise. */
export function rampReading(request: string): RampReading {
  const text = foldRequest(request);
  if (text.search(RAMP_WORD) < 0) return "none";
  if (text.search(GRADIENT_CUE) >= 0 || aroundEach(text, COLOUR_CUE) || text.search(LIGHT_DARK_CUE) >= 0) return "gradient";
  if (text.search(RAMP_DIRECTION) >= 0 || text.search(TIMING_CUE) >= 0) return "timing";
  return "ambiguous";
}

/** The request with its bare ramp words taken out, unless it is a gradient: the effect words of a name such as "gradient ramp" keep theirs, a "more ramp" or "ramp it up" does not name the gradient effect. */
export function withoutBareRamp(phrase: string): string {
  if (rampReading(phrase) === "gradient") return phrase;
  return phrase.replace(new RegExp(`${SPEED_BEFORE}${RAMP_WORD.source}`, "giu"), " ");
}
