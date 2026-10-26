// Request shape: how many separate parts a request names, and whether it asks a question rather than an edit, read from the folded request for the scale, route and specialist decisions.
import { featuresAsked } from "./request-parts.js";
import { isStagedProduction } from "./request-production.js";
import { namedObjectsAsked } from "./request-names.js";
import { asksFor, containsWord, foldRequest } from "./request-text.js";
import { countedPartCount, listMarkerCount, paragraphCount, timingCount } from "./request-structure.js";
import { ANSWER_PATTERN, EDIT_MODAL_PATTERN, EDIT_VERB_PATTERN, ENUMERATION_PATTERN, PRAISE_PATTERN, REQUEST_LEXICON, SECTION_PATTERN, EACH_PATTERN } from "./request-vocabulary.js";

/** A request longer than this, that also names two or more separate parts, is long; length alone never makes a request long. */
export const SMALL_REQUEST_MAX_CHARS = 400;

/** The most features and named objects a small request names. */
export const SMALL_REQUEST_MAX_THINGS = 3;

const LONG_PARAGRAPHS = 3;
const LONG_LISTED_MARKERS = 3;
const LONG_COUNTED_PARTS = 4;
const LONG_TIMINGS = 3;
const LONG_ENUMERATIONS = 3;
const PLANNED_ENUMERATIONS = 2;
const LONG_SECTIONS = 2;
const TWO_PARTS = 2;
const PLANNED_COUNTED_PARTS = 3;

function countOf(text: string, pattern: RegExp): number {
  return [...text.matchAll(pattern)].length;
}

function thingCount(request: string): number {
  return featuresAsked(request).length + namedObjectsAsked(request).length;
}

function isStructured(request: string): boolean {
  return paragraphCount(request) >= LONG_PARAGRAPHS || listMarkerCount(request) >= LONG_LISTED_MARKERS
    || countedPartCount(request) >= LONG_COUNTED_PARTS || timingCount(request) >= LONG_TIMINGS;
}

function isLongRun(text: string, enumerations: number, counted: number): boolean {
  return text.length > SMALL_REQUEST_MAX_CHARS && (enumerations >= PLANNED_ENUMERATIONS || counted >= TWO_PARTS);
}

/** Whether a request is one small item or a long one: several paragraphs, list markers, counted parts or timings, a list of three or more parts, two or more sections, or more things than a small request names. */
export function isLongRequest(request: string): boolean {
  const text = foldRequest(request);
  const enumerations = countOf(text, ENUMERATION_PATTERN);
  return isStructured(request) || enumerations >= LONG_ENUMERATIONS || countOf(text, SECTION_PATTERN) >= LONG_SECTIONS
    || thingCount(request) > SMALL_REQUEST_MAX_THINGS || isLongRun(text, enumerations, countedPartCount(request)) || isStagedProduction(request);
}

/** Whether a request is planned as several parts: a long request, or a list of two parts that is a section list or gives each part its own build. */
export function isPlannedRequest(request: string): boolean {
  const text = foldRequest(request);
  const listed = countOf(text, ENUMERATION_PATTERN) >= PLANNED_ENUMERATIONS;
  const counted = countedPartCount(request) >= PLANNED_COUNTED_PARTS;
  return isLongRequest(request) || counted || (listed && (containsWord(text, SECTION_PATTERN) || containsWord(text, EACH_PATTERN)));
}

/** Whether a message asks a question or wants an explanation, and needs no edit: a question word, a question mark or a thanks with nothing to change. */
export function isAnswerOnly(request: string): boolean {
  const text = foldRequest(request);
  if (containsWord(text, EDIT_MODAL_PATTERN)) return false;
  if (asksFor(text, ANSWER_PATTERN, REQUEST_LEXICON) || text.includes("?")) return true;
  return asksFor(text, PRAISE_PATTERN, REQUEST_LEXICON) && !asksFor(text, EDIT_VERB_PATTERN, REQUEST_LEXICON);
}

interface Signal {
  readonly count: number;
  readonly limit: number;
}

function signalsOf(request: string): ReadonlyArray<Signal> {
  const text = foldRequest(request);
  const enumerations = countOf(text, ENUMERATION_PATTERN);
  const counted = countedPartCount(request);
  return [
    { count: paragraphCount(request), limit: LONG_PARAGRAPHS }, { count: listMarkerCount(request), limit: LONG_LISTED_MARKERS },
    { count: counted, limit: LONG_COUNTED_PARTS }, { count: timingCount(request), limit: LONG_TIMINGS }, { count: enumerations, limit: LONG_ENUMERATIONS },
    { count: countOf(text, SECTION_PATTERN), limit: LONG_SECTIONS }, { count: thingCount(request), limit: SMALL_REQUEST_MAX_THINGS + 1 },
    { count: text.length > SMALL_REQUEST_MAX_CHARS ? Math.max(enumerations, counted) : 0, limit: TWO_PARTS },
  ];
}

const SURE = 0.95;

const CLEAR_LONG = 0.85;

const BARELY_LONG = 0.7;

const NEAR_LONG = 0.55;

/** How sure the small or long reading is: several structural signals agreeing, or one well past its limit, make a long request sure; a small request is sure when no signal is one short of its limit. */
export function scaleConfidence(request: string, long: boolean): number {
  const signals = signalsOf(request);
  const fired = signals.filter((signal) => signal.count >= signal.limit);
  if (!long) return signals.some((signal) => signal.count > 0 && signal.count === signal.limit - 1) ? NEAR_LONG : SURE;
  if (fired.length >= TWO_PARTS) return SURE;
  return fired.some((signal) => signal.count > signal.limit) ? CLEAR_LONG : BARELY_LONG;
}
