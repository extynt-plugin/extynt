// Staged productions: a whole piece that is made or names several parts, five or more deliverables that are built and animated (or eight or more), or several aspect ratios or versions. Such a request needs planning and specialists, not one agent. An edit to a whole piece that already exists is not a production.
import { featuresAsked } from "./request-parts.js";
import { TIMED_SPAN } from "./request-timed-span.js";
import { containsWord, foldRequest, refusedAt } from "./request-text.js";
import { REQUEST_LEXICON, ENUMERATION_PATTERN } from "./request-vocabulary.js";
import {
  BUILD_PATTERN, CJK_DEFINITE_PATTERN, COMPLETENESS_PATTERN, DEFINITE_WORDS, DELIVERABLE_PATTERN,
  NUMBER_WORDS, NUMBER_WORD_PATTERN, PRODUCTION_PATTERN, QUALIFIER_PATTERN, REPEAT_PATTERN, VERSION_PATTERN,
} from "./request-production-words.js";

type Span = { readonly start: number; readonly end: number };
type NumberSpan = { readonly value: number; readonly start: number; readonly end: number };

const MANY_DELIVERABLES = 5;
const EIGHT_DELIVERABLES = 8;
const SEVERAL_VERSIONS = 2;
const NAMED_PARTS = 2;
const REACH_WORDS = 3;
const REACH_CJK_CHARS = 20;
const DETERMINER_WORDS = 2;
const DETERMINER_CJK_CHARS = 4;
const NEAR_SPACES = 2;
const NUMBER = /(?<![A-Za-z\p{N}.])\d+(?![\p{N}]|[A-Za-z])/gu;
const SENTENCE_END = /[.;!?。；！？]/u;
const CLAUSE_BREAK = /[.,;:!?。，；：！？、]/u;
const WHITESPACE = /\s+/gu;
const CJK_CLAUSE_CUT = /[在给把于上里中和与的をにではが]/u;

function spansOf(text: string, pattern: RegExp): ReadonlyArray<Span> {
  const refused = refusedAt(text, REQUEST_LEXICON);
  return [...text.matchAll(pattern)]
    .map((match) => ({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length }))
    .filter((span) => !refused(span.start));
}

function gapOf(text: string, first: Span, second: Span): string {
  return first.end <= second.start ? text.slice(first.end, second.start) : text.slice(second.end, first.start);
}

function closeTogether(text: string, first: Span, second: Span): boolean {
  const gap = gapOf(text, first, second);
  return !CLAUSE_BREAK.test(gap) && gap.split(" ").length - 1 <= NEAR_SPACES;
}

function markedBefore(text: string, at: number, words: ReadonlySet<string>, cjk: RegExp): boolean {
  const before = text.slice(0, at).trim();
  const lastWords = before.split(" ").slice(-DETERMINER_WORDS).map((word) => word.toLowerCase());
  return lastWords.some((word) => words.has(word)) || containsWord(before.slice(-DETERMINER_CJK_CHARS), cjk);
}

function wholePieces(text: string): ReadonlyArray<Span> {
  const pieces = spansOf(text, PRODUCTION_PATTERN);
  return spansOf(text, COMPLETENESS_PATTERN).filter((whole) => pieces.some((piece) => closeTogether(text, whole, piece)));
}

function builtAround(text: string, whole: Span): boolean {
  return spansOf(text, BUILD_PATTERN).some((build) => !CLAUSE_BREAK.test(gapOf(text, build, whole)));
}

function completeProduction(request: string, text: string): boolean {
  const named = countOf(text, ENUMERATION_PATTERN) >= NAMED_PARTS || featuresAsked(request).length > NAMED_PARTS;
  return wholePieces(text).some((whole) => named || (builtAround(text, whole) && !markedBefore(text, whole.start, DEFINITE_WORDS, CJK_DEFINITE_PATTERN)));
}

function countOf(text: string, pattern: RegExp): number {
  return [...text.matchAll(pattern)].length;
}

function numberAt(match: RegExpMatchArray, value: number): NumberSpan {
  const start = match.index ?? 0;
  return { value, start, end: start + match[0].length };
}

function numberSpans(text: string): ReadonlyArray<NumberSpan> {
  const digits = [...text.matchAll(NUMBER)].map((match) => numberAt(match, Number(match[0])));
  const words = [...text.matchAll(NUMBER_WORD_PATTERN)].map((match) => numberAt(match, NUMBER_WORDS.get(match[0].toLowerCase()) ?? 0));
  return [...digits, ...words];
}

function reachAfter(text: string, end: number): string {
  const segment = (text.slice(end).split(SENTENCE_END)[0] ?? "").trim();
  const words = segment.split(" ");
  return words.length > 1 ? words.slice(0, REACH_WORDS).join(" ") : (segment.split(CJK_CLAUSE_CUT)[0] ?? "").slice(0, REACH_CJK_CHARS);
}

function countsNear(text: string, minimum: number, pattern: RegExp, qualifies: (value: number, reach: string, span: Span) => boolean = () => true): boolean {
  return numberSpans(text).some((span) => {
    if (span.value < minimum) return false;
    const reach = reachAfter(text, span.end);
    return containsWord(reach, pattern) && !containsWord(reach, REPEAT_PATTERN) && qualifies(span.value, reach, span);
  });
}

function manyBuiltDeliverables(text: string): boolean {
  const builds = spansOf(text, BUILD_PATTERN);
  return countsNear(text, MANY_DELIVERABLES, DELIVERABLE_PATTERN, (value, reach, span) =>
    (value >= EIGHT_DELIVERABLES || containsWord(reach, QUALIFIER_PATTERN)) && builds.some((build) => !CLAUSE_BREAK.test(gapOf(text, build, span))));
}

/** Whether a request is a staged production: a whole piece that is made or names several parts, a built run of deliverables, or several aspect ratios or versions; any language. */
export function isStagedProduction(request: string): boolean {
  const text = foldRequest(request);
  const spoken = text.replace(TIMED_SPAN, " ").replace(WHITESPACE, " ");
  return completeProduction(request, spoken) || manyBuiltDeliverables(spoken) || countsNear(spoken, SEVERAL_VERSIONS, VERSION_PATTERN);
}
