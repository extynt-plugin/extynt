// The words that name the features motion designers describe in prose rather than by their After Effects name: gradients, line drawing, per-character text, orbits and camera moves, in English, Spanish, German, French and Japanese.
import { unionRegex } from "./request-text.js";

const CLAUSE = "[^.;!?。！？]";
const SOME_WORDS = (count: number): string => `(?: [a-z']+){0,${count}}`;

export function near(first: string, second: string, gap: number): RegExp {
  const between = `${CLAUSE}{0,${gap}}`;
  return new RegExp(`(?:${first})${between}(?:${second})|(?:${second})${between}(?:${first})`, "giu");
}

export function anyOf(...sources: ReadonlyArray<string>): RegExp {
  return new RegExp(sources.join("|"), "giu");
}

const STROKE_NOUN = "(?<![\\p{L}\\p{N}])(?:strokes?|outlines?|contours?|paths?|lines?|trails?|traces?|squiggles?|signatures?|underlines?|borders?|silhouettes?)(?![\\p{L}])";
const STROKE_NOUN_ES = "(?<![\\p{L}\\p{N}])(?:trazos?|contornos?|lineas?|trazados?|siluetas?|bordes?|rastros?)(?![\\p{L}])";
const STROKE_NOUN_DE = "(?<![\\p{L}\\p{N}])(?:linien?|kontur(?:en)?|konturlinien?|strich\\p{L}*|pfad\\p{L}*|umriss\\p{L}*|schriftzug\\p{L}*|spur\\p{L}*)";
const STROKE_NOUN_FR = "(?<![\\p{L}\\p{N}])(?:traits?|traces?|tracés?|trace|contours?|lignes?|silhouettes?)(?![\\p{L}])";
const STROKE_NOUN_JA = "線|輪郭|ストローク|パス|軌跡|ライン|アウトライン|縁";

const DRAW_ON_EN = [
  "\\b(?:stroke|outline|line|path|trace|contour|border)s? (?:animat\\p{L}*|writ\\p{L}*|draw\\p{L}*|grow\\p{L}*|reveal\\p{L}*) (?:on|off)\\b",
  "\\b(?:draw|write|trace|sketch|scribble|paint)s?(?: (?:itself|themselves|it|them|out))? on\\b",
  "\\b(?:draw|write|trace)s? (?:itself|themselves)\\b",
  "\\b(?:draw|writ|trac|stroke)(?:e|ing)?[- ]?on\\b",
  "\\b(?:stroke|draw|write|trace)s? (?:in |on |out )?(?:the |a |an |its |this |that )?(?:stroke|outline|line|path|trace|contour|border) on\\b",
  "\\b(?:self|hand)[- ]?(?:draw|writ)\\p{L}*",
  "\\bhandwrit\\p{L}*",
  "\\b(?:is|are|being|gets?|get) (?:drawn|traced|written)(?: (?:on|in|out|along))?\\b",
  "\\b(?:trace|draw|write)s? (?:itself )?(?:out|along)\\b",
].join("|");
const REVEAL_VERB_EN = "(?:reveal|uncover|unfold|unroll|unspool|wipe|grow|snake|sweep)\\p{L}*";
const DRAW_PACE_EN = "(?:draw|trace)\\p{L}*[^.;!?]{0,30}(?:left to right|right to left|progressively|gradually|stroke by stroke|bit by bit|over time|point by point)";
const DRAW_VERB_ES = "(?:se (?:va |van )?(?:dibuj|traz|escrib|revel)\\p{L}*|(?:dibuj|traz|escrib|revel)(?:ando|andose|ar se)\\b|dibujad\\p{L}*|trazad\\p{L}*)";
const DRAW_VERB_DE = "(?:zeichn\\p{L}* sich|sich (?:selbst )?(?:auf)?zeichn\\p{L}*|selbst zeichn\\p{L}*|nachzeichn\\p{L}*|nachgezogen|aufdeck\\p{L}*|aufgedeckt|enthull\\p{L}*|aufgezeichnet|schreibt sich|schreiben sich)";
const DRAW_VERB_FR = "(?:se (?:dessin|trac|revel|devoil)\\p{L}*|dessin\\p{L}* progressi\\p{L}*|trait par trait)";
const DRAW_VERB_JA = "描かれ|書かれ|現れ|伸びて|なぞ|引かれ|描き込|描き出|書き込";

const SELF_DRAW = [
  "\\b(?:draw|write|trace)s? itself\\b", "(?:zeichnet|zeichnen|schreibt|schreiben) sich selbst", "sich selbst (?:zeichn|schreib)\\p{L}*", "trait par trait",
  "se (?:dibuja|traza|escribe)n? (?:solo|a si mismo|sola)", "ドローオン|書き込みアニメ|ライティング|トリムパス|トリミング?パス",
].join("|");

/** The words for a stroke that draws or writes itself on: an on-verb next to a line noun, a reveal of an outline, or a self-drawing mark. */
export const TRIM_PATH_CONCEPT: RegExp = unionRegex([
  anyOf(DRAW_ON_EN, SELF_DRAW),
  near(REVEAL_VERB_EN, STROKE_NOUN, 40),
  anyOf(DRAW_PACE_EN),
  near(DRAW_VERB_ES, STROKE_NOUN_ES, 60),
  near(DRAW_VERB_DE, STROKE_NOUN_DE, 60),
  near(DRAW_VERB_FR, STROKE_NOUN_FR, 60),
  near(`(?:${STROKE_NOUN_JA})`, `(?:${DRAW_VERB_JA})`, 14),
]);

const LETTER = "(?<![\\p{L}\\p{N}])(?:letters?|chars?|glyphs?)(?![\\p{L}])";
const SEQUENCE_EN = "one by one|one at a time|one after another|one after the other|individually|in sequence|in turn|stagger\\p{L}*|cascad\\p{L}*|offset\\p{L}*|pop(?:s|ping)? in";
const LETTER_ES = "(?<![\\p{L}\\p{N}])letras?(?![\\p{L}])";
const SEQUENCE_ES = "una a una|una por una|de una en una|por separado|escalonad\\p{L}*|desfas\\p{L}*|uno a uno|uno por uno";
const LETTER_DE = "(?<![\\p{L}\\p{N}])buchstab\\p{L}*(?![\\p{L}])";
const SEQUENCE_DE = "einzeln\\p{L}*|nacheinander|versetzt|zeitversetzt|versatz\\p{L}*";
const LETTER_FR = "(?<![\\p{L}\\p{N}])lettres?(?![\\p{L}])";
const SEQUENCE_FR = "une a une|un par un|une par une|decal\\p{L}*|echelonn\\p{L}*";
const LETTER_JA = "文字";
const SEQUENCE_JA = "ずつ|順番に|順に|一つずつ|ひとつずつ|少しずつ|ごとに|時間差";

const TYPING = [
  "\\btype[- ]?writer\\p{L}*", "\\btyp(?:e|es|ed|ing)[- ](?:on|out|itself)\\b", "\\btyping (?:effect|animation|on)\\b", "\\bword by word\\b",
  "(?:letter|character|char|glyph)(?: |-)by(?: |-)(?:letter|character|char|glyph)", "\\b(?:per|by|each|every|individual|single)[- ](?:letter|character|char|glyph)\\b",
  "\\b(?:text|character|letter|type) animators?\\b", "\\b(?:range|text) selectors?\\b", "\\bper[- ]word\\b",
  "(?:letra|caracter) por (?:letra|caracter)", "maquina de escribir", "efecto de (?:escritura|maquina)", "animador de (?:texto|caracteres?|letras)", "por (?:letra|caracter)",
  "buchstabe(?:n)? (?:fur|um) buchstabe(?:n)?", "buchstabenweise", "zeichenweise", "zeichen fur zeichen", "pro (?:buchstabe|zeichen)", "schreibmaschine\\p{L}*", "textanimator\\p{L}*", "bereichsauswahl",
  "lettre par lettre", "caractere par caractere", "par (?:caractere|lettre)", "machine a ecrire", "animateur de texte",
  "[1１一]文字ずつ|文字ごと|文字単位|タイプライター|テキストアニメーター|範囲セレクター|レンジセレクター",
].join("|");

/** The words for animation that runs on individual characters: a typewriter, letter-by-letter reveal, a per-character offset or a text animator, in any of the five languages. */
export const TEXT_ANIMATOR_CONCEPT: RegExp = unionRegex([
  anyOf(TYPING),
  near(LETTER, SEQUENCE_EN, 40),
  near("(?<![\\p{L}\\p{N}])words?(?![\\p{L}])", "one by one|one at a time|one after another|in sequence", 30),
  near(LETTER_ES, SEQUENCE_ES, 40),
  near(LETTER_DE, SEQUENCE_DE, 40),
  near(LETTER_FR, SEQUENCE_FR, 40),
  near(LETTER_JA, SEQUENCE_JA, 12),
]);

const GRADIENT_WORDS = [
  "gradient\\p{L}*", "degradad\\p{L}*", "\\bdegrade\\p{L}*", "farbverlauf\\p{L}*", "\\bverlauf (?:von|zu|aus|in)\\b",
  "\\b(?:radial|linear)\\p{L}* verlauf", "グラデ\\p{L}*", "ランプ",
].join("|");

/** The words that name a gradient fill, in the five languages. The bare word ramp is read by its context in ramp-context.ts, never here. */
export const RAMP_CONCEPT: RegExp = anyOf(GRADIENT_WORDS);

const ORBIT_MOTION_EN = "(?:circl|revolv|rotat|spin|swirl|swing|loop|spiral|whirl|swoop)\\p{L}*";
const ORBIT_WEAK_MOTION_EN = "(?:fly|flies|flying|travel|go|goes|going|move|moves|moving|glid|drift|float|swim)\\p{L}*";
const ORBIT_CENTRE_NOUN = "(?:the |a |an |its |that |this )?(?:planet|sun|moon|star|earth|centre|center|point|core|orb|globe|ball|logo|circle|dot|it|them|him|her)\\b";
const ORBIT_CENTRE_EN = "(?:around|round)(?! (?:its|their|his|her|the (?:anchor|center|centre|axis|y|x|z)|an? (?:axis|anchor)|itself|themselves|once|twice|and|in place|on|before|as|while|at|for|fast|slowly|quickly|the (?:screen|frame|comp|composition|canvas|scene|stage|room|world|page|layout|timeline|clock))\\b)";
const ORBIT_WORDS = [
  "\\borbit\\p{L}*", `\\b${ORBIT_MOTION_EN}${SOME_WORDS(2)} ${ORBIT_CENTRE_EN}`, `\\b${ORBIT_WEAK_MOTION_EN}${SOME_WORDS(2)} (?:around|round) ${ORBIT_CENTRE_NOUN}`, "\\b(?:in|along|on) an? (?:circular|elliptical|oval|circle|ellipse)\\b",
  "\\bcircular (?:path|motion|move|movement|trajectory|route)\\b", "\\borbita\\p{L}*", "\\b(?:gira|giran|girando|circula|circulan|dan? vueltas?|dando vueltas) alrededor\\b",
  "\\b(?:trayectoria|movimiento|camino) circular\\b", "\\ben (?:circulo|elipse)\\b", "\\bumlaufbahn\\p{L}*", "\\bkreisbahn\\p{L}*", "\\bkreist\\p{L}*", "\\bum\\b[^.;]{0,30}\\bkreisen\\b", "\\bkreisen\\b[^.;]{0,20}\\bum\\b",
  "\\bumkreis\\p{L}*", "\\bkreisformig\\p{L}*", "\\bumlauf\\p{L}*", "\\borbite\\p{L}*", "\\b(?:tourne|tournent|tournant|gravite|gravitent) autour\\b",
  "\\b(?:trajectoire|mouvement) circulaire\\b", "\\ben cercle\\b", "周り[をに]回", "周りを巡", "周囲を回", "公転", "周回", "軌道", "円運動", "円を描いて",
].join("|");

/** The words for a layer travelling around a centre: an orbit, a circle around something, a circular path, in the five languages; spinning around its own anchor is not an orbit. */
export const ORBIT_CONCEPT: RegExp = anyOf(ORBIT_WORDS);

const CAMERA = "(?<![\\p{L}\\p{N}])(?:camera|camara|kamera|カメラ)";
const CAMERA_MOVE_EN = "(?<![\\p{L}\\p{N}])(?:push|pull|move|moves|moving|movement|zoom|dolly|dollies|glid|crane|creep|drift|approach|retreat|fly|flies|flying|flew|pan|pans|panning|tilt|truck|pedestal|sweep|swoop|rise|descend)\\p{L}*";
const CAMERA_MOVE_OTHER = [
  "(?:acerc|aleja|avanz|retroced|empuj|desplaz|sigue)\\p{L}*", "(?:fahrt|fahren|heran|zoomt|schwenk|nahert|nahern|ruckt|gleitet)\\p{L}*",
  "(?:approche|avance|recule|eloigne|zoom|travelling)\\p{L}*", "寄っ|寄り|近づ|引い|引き|ズーム|プッシュ|プル|ドリー|パン|動",
].join("|");
const MOVE_VERBS = [
  "\\b(?:push|pull)(?:s|es|ed|ing)?[- ](?:in|out)\\b", "\\bdoll(?:y|ies|ying|ied)\\b", "\\btravell?ing\\b",
  "kamerafahrt\\p{L}*", "zufahr\\p{L}*", "heranfahr\\p{L}*", "herauszoom\\p{L}*", "hineinzoom\\p{L}*", "ドリー", "プッシュイン", "プルアウト",
].join("|");

/** The words for a camera move: a push-in, pull-out, dolly or zoom, or a camera that approaches, retreats or travels, in the five languages. */
export const CAMERA_MOVE_CONCEPT: RegExp = unionRegex([
  anyOf(MOVE_VERBS),
  near(CAMERA, `(?:${CAMERA_MOVE_EN}|${CAMERA_MOVE_OTHER})`, 30),
]);

const TEXT_TARGET = "(?:letters?|lettering|letterforms?|words?|titles?|text|type|typography|characters?|glyphs?|headlines?|wordmarks?|captions?|subtitles?|taglines?)";
const LETTERISH = "(?:letters?|lettering|letterforms?|glyphs?|characters?|type|typeface|text shapes?)";
const CLIP_VERB = "(?:clip|mask|crop|confine|restrict|constrain|stencil|knock out)(?:s|ped|ping|ed|ing)?";
const MEDIA_NOUN = "(?:video|footage|photos?|images?|pictures?|clips?|textures?|artwork|photograph|plate)";
const DETERMINER = "(?:the |its |these |those |each |every |a )?";
const TEXT_TARGET_SHORT = "(?:letters?|characters?|glyphs?|spacing|kerning|tracking)";

/** The words for a picture seen through text: the letters as a window or a matte, or a picture shown only through or inside the word. */
export const TEXT_MATTE_CONCEPT: RegExp = unionRegex([
  new RegExp(`\\b${TEXT_TARGET}\\b[^.;]{0,15}\\b(?:used )?as (?:a |the |its )?(?:matte|window|stencil|mask)\\b`, "giu"),
  new RegExp(`\\bonly (?:where|in|inside|within|through|on) (?:the |its |these |those )?${TEXT_TARGET}\\b`, "giu"),
  new RegExp(`\\b${CLIP_VERB}\\b[^.;]{0,40}\\b(?:to|into) ${DETERMINER}${LETTERISH}\\b`, "giu"),
  new RegExp(`\\b${CLIP_VERB}\\b[^.;]{0,40}\\b(?:with|using|by|via) ${DETERMINER}${TEXT_TARGET}\\b`, "giu"),
  new RegExp(`\\b${MEDIA_NOUN}\\b[^.;]{0,25}\\bfill\\p{L}* ${DETERMINER}${LETTERISH}\\b`, "giu"),
  new RegExp(`\\b(?:visible\\p{L}*|show\\p{L}*|shown|reveal\\p{L}*|clip\\p{L}*|window|seen|see|cut out|fill\\p{L}*|put|place|keep|play\\p{L}*|run\\p{L}*|appear\\p{L}*|display\\p{L}*)\\b[^.;]{0,40}\\b(?:through|inside|within) (?:the |its |these |those |a |each |every )?${TEXT_TARGET}\\b`, "giu"),
]);

const FOOTAGE_NOUN = "(?:shot|shots|footage|clip|clips|video|camera|plate)";

const SHAKE_WORDS = "(?:shak\\p{L}*|jitter\\p{L}*|wobbl\\p{L}*|jerk\\p{L}*|handheld|bumpy|unsteady)";

/** The words for steadying footage: smoothing out or fixing a shaky shot. */
export const STEADY_CONCEPT: RegExp = unionRegex([
  new RegExp(`\\b(?:smooth\\p{L}* out|steadi\\p{L}*|calm\\p{L}*|tam(?:e|ing)|fix\\p{L}*|remov\\p{L}*|reduc\\p{L}*|get rid of)\\b[^.;]{0,25}\\b${SHAKE_WORDS}\\b[^.;]{0,25}\\b${FOOTAGE_NOUN}\\b`, "giu"),
  new RegExp(`\\b${SHAKE_WORDS} ${FOOTAGE_NOUN}\\b`, "giu"),
  new RegExp(`\\bsteadi\\p{L}* (?:out )?(?:the |this |that |my )?${FOOTAGE_NOUN}\\b`, "giu"),
]);

/** The words for letter spacing, or typographic tracking: letter spacing, kerning, spreading or tightening the letters, in the five languages. */
export const LETTER_SPACING_CONCEPT: RegExp = unionRegex([
  /\bletter[- ]?spac\p{L}*|\bkern(?:ing|s|ed)?\b|\bdistance between (?:the )?letters\b/giu,
  new RegExp(`\\b(?:spread\\p{L}*|loosen\\p{L}*|tighten\\p{L}*|tighter|looser|widen\\p{L}*|narrow\\p{L}*)\\b[^.;]{0,20}\\b(?:the |its |these |those )?${TEXT_TARGET_SHORT}\\b`, "giu"),
  new RegExp(`\\b(?:spacing|tracking)\\b[^.;]{0,20}\\b(?:of|on|for|between) (?:the |its |these )?${TEXT_TARGET}\\b`, "giu"),
  /\b(?:more|less|increase\p{L}*|decrease\p{L}*|add\p{L}*|tighter|looser|wider|narrower)\s+tracking\b/giu,
  /Buchstabenabstand|Zeichenabstand|Laufweite|espaciado entre letras|espacio entre letras|interletra\p{L}*|interlettrage|espacement des lettres|文字間|字間|カーニング/giu,
]);

/** The words that link a layer to a null or controller, which parents it: link, attach or tie a layer to a null, in English and German. */
export const LINK_TO_NULL_CONCEPT: RegExp = unionRegex([
  /\b(?:link|attach|tie|connect|bind|hook|lock)(?:s|ed|ing)?\b[^.;]{0,40}\b(?:to|onto|with) (?:a |an |the |its |one |my |that |this )?(?:nulls?|controllers?)\b/giu,
  /\b(?:follow|follows|following|followed)\b[^.;]{0,30}\b(?:single |one |a |the )?(?:controller|null)\b/giu,
  /\b(?:child|children)\b[^.;]{0,15}\b(?:of|to|under) (?:a |an |the |one |my )?(?:null|controller)\b/giu,
  /\b(?:verbind|anbind|verknupf|anhang|hang)\p{L}*\b[^.;]{0,40}\b(?:an|mit|zu) (?:ein |einem |einen |das |dem |den )?(?:nullobjekt\p{L}*|null)\b/giu,
]);

const NULL_NOUN = "\\bnulls?\\b";
const LINK_VERB = "(?:link|attach|tie|connect|bind|hook|glue|pin|stick|lock|parent)\\p{L}*";
const IT = "(?:it|that|this|that one|this one)";

/** The words that hook layers to a null just made, naming it only as a pronoun: a null, then link, attach or glue layers to it, make them its children, or have them follow it. */
export const NULL_PRONOUN_LINK_CONCEPT: RegExp = unionRegex([
  new RegExp(`${NULL_NOUN}[^.;]{0,60}\\b${LINK_VERB}\\b[^.;]{0,50}\\b(?:to|onto|on to|up to|under) ${IT}\\b`, "giu"),
  new RegExp(`${NULL_NOUN}[^.;]{0,60}\\b(?:child|children|kids)\\b[^.;]{0,15}\\b(?:of|to|under) ${IT}\\b`, "giu"),
  new RegExp(`${NULL_NOUN}[^.;]{0,60}\\b(?:follow|obey|inherit)\\p{L}*\\b[^.;]{0,15}\\b${IT}\\b`, "giu"),
]);

const ATTACH_VERB = "(?:pin|stick|attach|glue|lock|anchor|fix|fasten|stay|stuck|latch|affix|replace|swap|composite|overlay|put|place)\\p{L}*";
const SURFACE = "(?:signs?|billboards?|screens?|monitors?|displays?|posters?|panels?|boards?|plaques?|tvs?|televisions?|banners?|windshield|license plates?|number plates?|labels?)";
const MOVING_WORD = "(?:moving|moves|tracked|travell?ing|drifting|swaying|passing|rotating|turning|shaking)";
const SHOT_NOUN = "(?:footage|clip|shot|video|scene)";

/** The words for pinning a graphic to something that moves in the footage: a moving sign, billboard or screen, or a surface in a shot that something is stuck onto or swapped into. */
export const PIN_TO_MOVING_CONCEPT: RegExp = unionRegex([
  new RegExp(`\\b${ATTACH_VERB}\\b[^.;]{0,50}\\b${MOVING_WORD}\\b[^.;]{0,20}\\b${SURFACE}\\b`, "giu"),
  new RegExp(`\\b(?:pin|stick|attach|glue|lock|anchor|fasten|stay|stuck|latch|affix)\\p{L}*\\b[^.;]{0,50}\\b${MOVING_WORD}\\b`, "giu"),
  new RegExp(`\\b${ATTACH_VERB}\\b[^.;]{0,50}\\b${SURFACE}\\b[^.;]{0,50}\\b(?:${SHOT_NOUN}|${MOVING_WORD})\\b`, "giu"),
]);

const ASPECT = "(?:\\d{1,2} ?[:x/] ?\\d{1,2}|square|vertical|portrait|horizontal|landscape|widescreen|stories|story|reels?)";
const COMP = "comp(?:osition)?s?";

/** The words for a comp reformatted as another version: a square, 1:1 or vertical cut, version or variant of a composition. */
export const ASPECT_VARIANT_CONCEPT: RegExp = unionRegex([
  new RegExp(`\\b${ASPECT} (?:cuts?|versions?|variants?|formats?|edits?|copy|copies)\\b[^.;]{0,30}\\b${COMP}\\b`, "giu"),
  new RegExp(`\\b${COMP}\\b[^.;]{0,30}\\b(?:as|into|in) an? ${ASPECT} (?:cut|version|variant|format|edit|copy)\\b`, "giu"),
  new RegExp(`\\b(?:another|a second|a new|an alternate) (?:cut|version|variant|take)\\b[^.;]{0,30}\\b${COMP}\\b`, "giu"),
]);
