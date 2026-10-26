// How the request-parts decision reads a long brief: which mentions a refusal reaches across a list, a trailing refusal or an already-existing feature rules out.
import { phraseRegex, refusedAt, unionRegex } from "./request-text.js";
import type { Lexicon } from "./request-text.js";
import { REQUEST_LEXICON } from "./request-vocabulary.js";

const EXISTING_CUES = [
  "already", "currently", "=leave", "untouched", "unchanged", "ya tiene", "ya hay", "ya existe", "ya lleva", "bereits", "schon vorhanden", "deja", "existe deja", "a deja", "unverandert", "すでに", "既に", "既存", "そのまま", "已经", "已有", "现有", "本来就有", "原本就", "保持不变", "不变",
];
const SUBSTITUTE_CUES = [
  "instead of", "rather than", "in place of", "in lieu of", "forget", "nothing", "anstatt", "statt", "en lugar de", "en vez de", "au lieu de", "plutot que", "ではなく", "の代わりに", "じゃなくて", "ではなくて", "而不是", "代替", "取代", "换成",
];
const LIST_JOINERS = /^\s*(?:(?:or|nor|and|oder|und|ni|noch|ou|o|y|e|と|や|も)(?![\p{L}])|或者|或|和|与|及|以及|还是|または|あるいは|それとも)/iu;
const NEW_CLAUSE_ITEM = /^\s*(?:and|und|y|et)\s+(?:a|an|the|another|ein|eine|einen|el|la|un|une|le|les)(?![\p{L}])/iu;
const BREAKING_PUNCTUATION = /[.;!?:、。；！？]/u;
const SHORT_LIST_ITEM_WORDS = 3;
const JOINER_WORD = /^(?:or|nor|and|oder|und|ni|noch|ou|o|y|et)$/iu;
const TRAILING_REFUSAL_REACH = 60;
const NEAR_CUE_REACH = 30;

const FEATURE_VERB_WITH_OBJECT = new RegExp(
  "\\s(?:blur|soften|defocus|wiggle|orbit|parent|stabili[sz]e|duplicate|track|trim|loop|draw|type|repeat|glow|ramp)(?= (?:the|a|an|its|it|them|this|that|my|your|these|those|all|every|each)(?![\\p{L}]))",
  "giu",
);

const PIVOT_WORDS = "just|only|simply|nur|solo|nada mas|juste|seulement";

const PIVOT = new RegExp(`(?<![\\p{L}\\p{N}])(?:${PIVOT_WORDS})(?![\\p{L}\\p{N}])(?!\\s+(?:on|in|for|at|when|if|where|auf|bei|en|para|si))`, "giu");

const PIVOT_CJK = /只要|只需|仅需|仅仅|只加|只用|只做/gu;

const PIVOT_AT_START = new RegExp(`^\\s*(?:${PIVOT.source}|${PIVOT_CJK.source})`, "iu");

const PARTS_LEXICON: Lexicon = {
  cue: unionRegex([REQUEST_LEXICON.cue, phraseRegex([...EXISTING_CUES, ...SUBSTITUTE_CUES])]),
  act: unionRegex([REQUEST_LEXICON.act, FEATURE_VERB_WITH_OBJECT]),
  brk: unionRegex([REQUEST_LEXICON.brk, PIVOT, PIVOT_CJK]),
  conj: unionRegex([REQUEST_LEXICON.conj, phraseRegex(["=or", "=oder", "=ou", "=ni", "=noch"])]),
};

const TRAILING_REFUSAL = unionRegex([
  /^[^,.;!?]{0,25}\b(?:is|are|isn't|aren't|not|won't|wouldn't)\s+(?:not\s+)?(?:needed|wanted|necessary|required|desired|welcome|wished)\b/iu,
  /^[^,.;!?]{0,25}\b(?:no need|unnecessary|can go|should go|has to go|can stay out|stays out|not needed|excluded|omitted|banned|forbidden|ruled out|off the table)\b/iu,
  /^-(?:free|less)\b/iu,
  /^(?:\s+(?:from|of|on)\s+[^,.;!?]{0,25})?\s+(?:off|away)\b/iu,
  /^[,\s]*(?:which|that|das|die|que|qui)\s+(?:i|we|you|ich|wir|yo|je|nosotros)?\s*(?:do not|don't|dont|donot|no|nicht|ne)\s+(?:want|need|like|quiero|necesito|brauche|veux)/iu,
  /^[^,.;!?]{0,25}\b(?:no hace falta|no es necesario|sobra|nicht notig|nicht gewunscht|entfallt|nicht erwunscht|pas necessaire|inutile|pas besoin)/iu,
  /^[^、。！？;]{0,14}(?:入れ|付け|つけ|使わ|使用し|加え|追加し|足さ|いれ|出さ|し|いら|必要)(?:ない|なくて|ず)/u,
  /^[^,、。！？;]{0,10}(?:不需要|不要|不用|不必|去掉|不加|可以去掉|都不要|就不要|算了|不需)/u,
  /^[^、。！？;]{0,14}(?:不要|いらない|要らない|なしで|なし(?![\p{L}])|無し|避けて|やめて|外して|消して)/u,
]);

function isShortPlainItem(rest: string): boolean {
  const item = rest.split(BREAKING_PUNCTUATION)[0]?.split(",")[0] ?? "";
  const words = item.trim().split(/\s+/u).filter((word) => word.length > 0);
  const joiner = words.findIndex((word) => word.search(JOINER_WORD) >= 0);
  const listLength = joiner >= 0 ? joiner : words.length;
  return words.length > 0 && listLength <= SHORT_LIST_ITEM_WORDS && item.search(PARTS_LEXICON.act) < 0 && item.search(PARTS_LEXICON.cue) < 0;
}

function continuesRefusal(text: string, comma: number): boolean {
  const rest = text.slice(comma + 1);
  if (PIVOT_AT_START.test(rest)) return false;
  return rest.search(LIST_JOINERS) >= 0 ? !NEW_CLAUSE_ITEM.test(rest) : isShortPlainItem(rest);
}

function joinLists(text: string): string {
  const chars = [...text];
  const refused = refusedAt(text, PARTS_LEXICON);
  [...text.matchAll(/,/gu)].forEach((match) => {
    const at = match.index ?? 0;
    if (refused(at) && continuesRefusal(text, at)) chars[at] = " ";
  });
  return chars.join("");
}

function refusedAfter(text: string, end: number): boolean {
  return text.slice(end, end + TRAILING_REFUSAL_REACH).search(TRAILING_REFUSAL) >= 0;
}

function cueBeside(text: string, at: number): boolean {
  const before = text.slice(Math.max(0, at - NEAR_CUE_REACH), at);
  const sentence = before.split(/[,.;!?:、。；！？]/u).pop() ?? "";
  return sentence.search(REQUEST_LEXICON.cue) >= 0;
}

type PartReading = "asked" | "refused" | "doubtful" | "absent";

function readMention(read: string, refused: (at: number) => boolean, match: RegExpMatchArray): PartReading {
  const at = match.index ?? 0;
  const trailing = refusedAfter(read, at + match[0].length);
  if (!trailing && !refused(at)) return "asked";
  return trailing || cueBeside(read, at) ? "refused" : "doubtful";
}

const READING_ORDER: ReadonlyArray<PartReading> = ["asked", "doubtful", "refused"];

/** How a folded request treats the feature the pattern finds: asked if any mention is asked, else doubtful if a refusal reaching a mention is far from it or comes from a list or context, else refused when a cue sits beside it, else absent. */
export function readPart(text: string, mention: RegExp, ignore?: RegExp): PartReading {
  const read = joinLists(ignore === undefined ? text : text.replace(ignore, (span) => " ".repeat(span.length)));
  const refused = refusedAt(read, PARTS_LEXICON);
  const readings = [...read.matchAll(mention)].map((match) => readMention(read, refused, match));
  return READING_ORDER.find((reading) => readings.includes(reading)) ?? "absent";
}
