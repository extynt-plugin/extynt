// Matching a described look ("slab serif", "handwritten") against the style tags of families, from the family table and the words in a family name.
import type { Candidate } from "./candidate-search.js";
import { FAMILY_TAGS } from "./resolution-font-tags.js";
import { ALL_LOOK_WORDS } from "./resolution-font-all-words.js";
import { compileConcepts, conceptHits } from "./resolution-concepts.js";
import type { ConceptHit } from "./resolution-concepts.js";
import { hasCjk, normaliseText, stemWord, wordsOf } from "./resolution-text.js";
import type { Clause } from "./resolution-text.js";

const CONCEPTS = compileConcepts(ALL_LOOK_WORDS);

const WEIGHT_TAG = stemWord("heavy");

const ROUNDED_TAG = stemWord("rounded");

const SERIF_TAG = stemWord("serif");

const ROUNDED_SERIF_CLASH = 0.3;

const CLASS_WEIGHT = 2;

const CLASS_BONUS = 0.3;

/** The fit a pick needs: a family below it is not offered as the look. */
export const TAG_FIT = 0.5;

const CLASS_GROUPS: ReadonlyArray<ReadonlyArray<string>> = [["mono"], ["serif"], ["sans"], ["script", "hand"], ["jp"]].map((group) => group.map(stemWord));

const STYLE_CLASS_GROUPS = CLASS_GROUPS.slice(0, 4);

const REQUIRED_TAGS: ReadonlySet<string> = new Set(["slab", "rounded"].map(stemWord));

const JAPANESE_GROUPS: ReadonlyArray<ReadonlyArray<string>> = [["jp"], ["mincho"], ["gothicjp"]].map((group) => group.map(stemWord));

const JAPANESE_TAGS: ReadonlySet<string> = new Set(JAPANESE_GROUPS.flat());

const SHAPE_TAGS: ReadonlySet<string> = new Set(["condensed", "wide"].map(stemWord));

const KANA = /[\u3040-\u30ff]/u;

const FOREIGN_SCRIPT_COST = 0.5;

const PLAIN_EXTRA = 0.04;

const POSTER_TAG = stemWord("poster");

const SHAPE_EXTRA = 0.1;

/** The style tag a word of a family name states ("Mono" in Roboto Mono). */
export const NAME_TAGS: Readonly<Record<string, string>> = {
  mono: "mono", monospace: "mono", monospaced: "mono", code: "code", serif: "serif", sans: "sans", slab: "slab", script: "script", brush: "script", hand: "hand", handwriting: "hand",
  marker: "hand", narrow: "condensed", condensed: "condensed", compressed: "condensed", rounded: "rounded", round: "rounded", black: "heavy", heavy: "heavy", display: "display",
  mincho: "mincho", typewriter: "typewriter", comic: "comic", chalk: "chalk", chalkboard: "chalk", stencil: "stencil", blackletter: "blackletter", fraktur: "blackletter",
  wide: "wide", ui: "ui", grotesk: "sans", grotesque: "sans", gothic: "gothic", deco: "artdeco", western: "western", poster: "poster", news: "news", book: "book", text: "body",
};

/** What a request asks of a look: the style tags it demands with their weights, the tags it rules out, and the words those demands already explain. */
export interface LookDemand {
  readonly wanted: ReadonlyArray<ConceptHit>;
  readonly denied: ReadonlySet<string>;
  readonly consumed: ReadonlySet<string>;
  readonly total: number;
  readonly classes: ReadonlyArray<ClassAsk>;
  readonly kana: boolean;
}

interface ClassAsk {
  readonly group: ReadonlyArray<string>;
  readonly asked: ReadonlyArray<string>;
}

function consumedWords(clauses: ReadonlyArray<Clause>, hits: ReadonlyArray<ConceptHit>): ReadonlySet<string> {
  const joined = clauses.map((clause) => ` ${clause.words.join(" ")} `);
  const found = hits.flatMap((hit) => hit.concept.triggers).filter((trigger) => (hasCjk(trigger) ? clauses.some((clause) => clause.text.includes(trigger)) : joined.some((text) => text.includes(` ${trigger}`))));
  return new Set(found.flatMap((trigger) => (hasCjk(trigger) ? [trigger] : wordsOf(trigger))));
}

function askedClasses(wanted: ReadonlyArray<ConceptHit>): ReadonlyArray<ClassAsk> {
  const firm = wanted.filter((hit) => hit.concept.weight >= CLASS_WEIGHT).flatMap((hit) => hit.concept.targets);
  const groups = firm.some((tag) => JAPANESE_TAGS.has(tag)) ? JAPANESE_GROUPS : CLASS_GROUPS;
  return groups.map((group) => ({ group, asked: [...new Set(firm.filter((tag) => group.includes(tag)))] })).filter((ask) => ask.asked.length > 0);
}

function asksJapanese(demand: LookDemand): boolean {
  return demand.classes.some((ask) => ask.group.some((tag) => JAPANESE_TAGS.has(tag)));
}

function inAskedClass(ask: ClassAsk, tags: ReadonlyArray<string>): boolean {
  const met = ask.asked.filter((tag) => tags.includes(tag)).length;
  return ask.group.some((tag) => tags.includes(tag)) && (met === 0 || met === ask.asked.length);
}

/** The look a request describes, read from its clauses. */
export function readLooks(clauses: ReadonlyArray<Clause>): LookDemand {
  const hits = conceptHits(clauses, CONCEPTS);
  const wanted = hits.filter((hit) => !hit.negated);
  return {
    wanted,
    denied: new Set(hits.filter((hit) => hit.negated).flatMap((hit) => hit.concept.targets)),
    consumed: consumedWords(clauses, hits),
    total: wanted.reduce((sum, hit) => sum + hit.concept.weight, 0),
    classes: askedClasses(wanted),
    kana: clauses.some((clause) => KANA.test(clause.text)),
  };
}

/** Whether a request asks only for a weight or emphasis (every tag it demands is "heavy"), which names no look to match a family to. */
export function weightOnly(demand: LookDemand): boolean {
  return demand.wanted.length > 0 && demand.wanted.every((hit) => hit.concept.targets.every((target) => target === WEIGHT_TAG));
}

function classOf(tag: string): number {
  return STYLE_CLASS_GROUPS.findIndex((group) => group.includes(tag));
}

function keepsName(row: ReadonlyArray<string>, tag: string): boolean {
  const own = classOf(tag);
  return own < 0 || !row.some((rowTag) => classOf(rowTag) >= 0 && classOf(rowTag) !== own);
}

/** The style tags of a family: its table row, plus one for each style word in its name, except that a class its name suggests ("Sans" in Comic Sans MS) gives way to a different class its table row states. */
export function tagsOf(candidate: Candidate): ReadonlyArray<string> {
  const row = (FAMILY_TAGS.get(candidate.title.toLowerCase()) ?? []).map(stemWord);
  const named = wordsOf(normaliseText(candidate.title)).flatMap((word) => NAME_TAGS[word] ?? []).map(stemWord).filter((tag) => keepsName(row, tag));
  return [...new Set([...row, ...named])];
}

function holdsShape(tags: ReadonlyArray<string>, tag: string): boolean {
  return !REQUIRED_TAGS.has(tag) || tags.includes(tag);
}

function unspoken(hit: ConceptHit, spoken: ReadonlySet<string>): boolean {
  return hit.concept.weight >= CLASS_WEIGHT && !wordsOf(hit.phrase).every((word) => spoken.has(word));
}

/** Whether a family belongs to every class the request names outright (sans, serif, mono, script or handwriting) and holds every shape it names outright (slab, rounded), leaving out what the words in `spoken` (the part of its name the request typed) already say. */
export function meetsClasses(demand: LookDemand, tags: ReadonlyArray<string>, spoken: ReadonlySet<string> = new Set()): boolean {
  if (asksJapanese(demand)) return true;
  const asked = demand.wanted.filter((hit) => unspoken(hit, spoken));
  return askedClasses(asked).every((ask) => inAskedClass(ask, tags)) && asked.every((hit) => hit.concept.targets.every((tag) => holdsShape(tags, tag)));
}

function extraCost(tags: ReadonlyArray<string>, asked: ReadonlySet<string>): number {
  const shape = asked.has(POSTER_TAG) ? PLAIN_EXTRA : SHAPE_EXTRA;
  return tags.filter((tag) => !asked.has(tag)).reduce((sum, tag) => sum + (SHAPE_TAGS.has(tag) ? shape : PLAIN_EXTRA), 0);
}

function metWeight(demand: LookDemand, tags: ReadonlyArray<string>): number {
  return demand.wanted.reduce((sum, hit) => sum + hit.concept.weight * (hit.concept.targets.filter((target) => tags.includes(target)).length / Math.max(1, hit.concept.targets.length)), 0);
}

function shapeBonus(tags: ReadonlyArray<string>, asked: ReadonlySet<string>): number {
  const primary = tags[0] !== undefined && asked.has(tags[0]) ? 0.1 : 0;
  const clash = asked.has(ROUNDED_TAG) && tags.includes(SERIF_TAG) ? ROUNDED_SERIF_CLASH : 0;
  return primary - clash;
}

function foreignCost(demand: LookDemand, tags: ReadonlyArray<string>): number {
  const foreign = !demand.kana && !asksJapanese(demand) && tags.includes(JAPANESE_GROUPS[0]?.[0] ?? "");
  return foreign ? FOREIGN_SCRIPT_COST : 0;
}

/** How a family fits a look: the share of the demanded weight its tags meet, less a little for each tag nobody asked for, less more for a Japanese face when the request is not Japanese (more for a width nobody asked for), a bonus when its main tag is asked for, and a bonus when it belongs to a style class (mono, serif, sans, script or handwriting, Japanese) the request names outright. */
export function lookFit(demand: LookDemand, tags: ReadonlyArray<string>): number {
  if (demand.total === 0) return 0;
  const met = metWeight(demand, tags);
  const asked = new Set(demand.wanted.flatMap((hit) => hit.concept.targets));
  const inClass = demand.classes.some((ask) => inAskedClass(ask, tags));
  if (!inClass && asksJapanese(demand)) return 0;
  const denied = tags.filter((tag) => demand.denied.has(tag)).length;
  const fit = met / demand.total - extraCost(tags, asked) - 2 * denied + shapeBonus(tags, asked) - foreignCost(demand, tags);
  return inClass ? Math.max(fit + CLASS_BONUS, TAG_FIT) : fit;
}
