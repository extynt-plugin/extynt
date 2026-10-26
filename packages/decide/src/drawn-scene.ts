// The drawn-scene decision: whether a request asks for a picture to be drawn, or for text, shapes and footage to be arranged and animated.
import { choice } from "./spec.js";
import type { ChoiceSpec } from "./spec.js";
import type { RequestText } from "./request-parts.js";
import { withKana } from "./request-kana.js";
import { containsWord, foldRequest } from "./request-text.js";
import { ARRANGED_PATTERN, DRAWABLE_PATTERN, DRAW_IDIOM_PATTERN, DRAW_VERB_PATTERN, SHAPE_PATTERN } from "./request-vocabulary.js";

const MANNER = /^\s*(?:as|with|using|als|mit|como|con|comme|avec|en tant que)\b/iu;
const ARRANGED_FOLLOW = withKana(/^\s*(?:\p{L}+\s+)?(?:layers?|footage|clips?|video|comps?|solids?|precomps?|capas?|calques?|ebenen?|metraje|metrage)\b|^\s*(?:图层|レイヤー|素材|视频|映像|ビデオ)/iu);
const HEAD_WORDS = 3;
const LOOK_AHEAD_CHARS = 40;
const LOOK_BEHIND_CHARS = 4;

const WAVY = "wavy|wavey|squiggl\\p{L}*|scribbl\\p{L}*|wobbl\\p{L}*|wiggly|zigzag|curvy|ondulad\\p{L}*|garabatead\\p{L}*|wellig\\p{L}*|wellen\\p{L}*|ondul\\p{L}*|tremblant\\p{L}*|zigzagu\\p{L}*|sinueu\\p{L}*|波線|波打つ|波状|ぎざぎざ|ジグザグ|くねくね|うねうね|波浪|弯曲|曲折|歪歪扭扭|蜿蜒";

const HAND_MADE = "hand[- ]?drawn|freehand|free[- ]hand|sketchy|doodl\\p{L}*|scribbl\\p{L}*|dibujad\\p{L}* a mano|a mano alzada|a mano|handgezeichnet\\p{L}*|handgemalt\\p{L}*|von hand|aus freier hand|freihand|dessin\\p{L}* a la main|a main levee|croquis|gribouill\\p{L}*|手描き|手書き風|フリーハンド|手绘|手画|徒手|涂鸦|随手画";

const MARK = "lines?|strokes?|underlines?|paths?|curves?|circles?|rings?|boxe?s?|arrows?|marks?|outlines?|ovals?|squares?|linea\\p{L}*|circulo\\p{L}*|subrayado|strich\\p{L}*|linie\\p{L}*|kreis\\p{L}*|unterstreich\\p{L}*|traits?|cercles?|ligne\\p{L}*|souligne\\p{L}*|fleche\\p{L}*|線|円|下線|丸|矢印|アンダーライン|线|圈|圆|下划线|箭头|框|轮廓";

const REACH = "[^.;]{0,14}";

const WAVY_MARK = withKana(new RegExp(`(?<![a-z0-9])(?:${WAVY})(?![a-z0-9])${REACH}(?<![a-z0-9])(?:${MARK})|(?<![a-z0-9])(?:${MARK})(?![a-z0-9])${REACH}(?<![a-z0-9])(?:${WAVY})`, "iu"));

const HAND_MARK = withKana(new RegExp(`(?<![a-z0-9])(?:${HAND_MADE})(?![a-z0-9])${REACH}(?<![a-z0-9])(?:${MARK})|(?<![a-z0-9])(?:${MARK})(?![a-z0-9])${REACH}(?<![a-z0-9])(?:${HAND_MADE})`, "iu"));

const BARE_SCRIBBLE = /(?<![a-z0-9])(?:squiggle|scribble|doodle|garabato|kritzelei|gribouillis|griffonnage|落書き|らくがき|いたずら書き|涂鸦)s?(?![a-z0-9])/iu;

function marksByHand(text: string): boolean {
  return WAVY_MARK.test(text) || HAND_MARK.test(text) || BARE_SCRIBBLE.test(text);
}

function headOf(after: string): string {
  return after.split(/[^\p{L}\p{N}-]+/u).filter((word) => word.length > 0).slice(0, HEAD_WORDS).join(" ");
}

function isPictureDraw(text: string, at: number, verb: string): boolean {
  const after = text.slice(at + verb.length, at + verb.length + LOOK_AHEAD_CHARS);
  if (DRAW_IDIOM_PATTERN.test(after)) return false;
  if (MANNER.test(after)) return true;
  const before = text.slice(Math.max(0, at - LOOK_BEHIND_CHARS), at);
  const head = headOf(after);
  return !containsWord(head, SHAPE_PATTERN) && !containsWord(before, SHAPE_PATTERN) && !containsWord(head, ARRANGED_PATTERN);
}

function drawsPicture(text: string): boolean {
  return [...text.matchAll(DRAW_VERB_PATTERN)].some((match) => isPictureDraw(text, match.index ?? 0, match[0]));
}

function namesPicture(text: string): boolean {
  return [...text.matchAll(DRAWABLE_PATTERN)].some((match) => !ARRANGED_FOLLOW.test(text.slice((match.index ?? 0) + match[0].length)));
}

/** Whether the request asks for a picture to be drawn: a drawing verb whose object is a picture rather than a plain shape or a layer, or a picture noun that is not a layer or footage. */
export function isDrawnScene(request: string): boolean {
  const text = foldRequest(request);
  return drawsPicture(text) || namesPicture(text) || marksByHand(text);
}

/** Whether the request asks for a picture to be drawn (a scene, an illustration, a character, a logo mark) rather than text, shapes or footage to be arranged and animated; any language. */
export const DRAWN_SCENE_REQUEST: ChoiceSpec<RequestText, "drawn-scene" | "arranged-layers"> = choice<RequestText, "drawn-scene" | "arranged-layers">({
  name: "drawn-scene",
  useModel: true,
  instructions: "A motion designer's request asks for something to be made in After Effects. Decide whether the thing to make is a picture that must first be drawn, or layers that are arranged and animated.",
  labels: {
    "drawn-scene": "a picture to be drawn: a scene, landscape, illustration, character, mascot, logo mark or artwork made of several drawn parts",
    "arranged-layers": "text, simple shapes, solids, footage or existing layers to be placed, styled and animated, with nothing to draw",
  },
  deterministic: (state) => (isDrawnScene(state.request) ? "drawn-scene" : "arranged-layers"),
});
