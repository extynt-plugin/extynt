// Concept tables for the offline resolvers: which request words stand for which name stems, and how a clause is matched against them.
import { CJK_NEGATION_BESIDES_REMOVAL, CJK_REMOVAL_VERB } from "./resolution-clause-words.js";
import { VENDOR_WORDS } from "./resolution-profile.js";
import { hasCjk, normaliseText, stemWord } from "./resolution-text.js";
import type { Clause } from "./resolution-text.js";
import { includesKana } from "./text-folding.js";

/** A row of a concept table: comma-separated request words (any language; a word written with a leading ~ also matches inside a longer compound word), the name stems they point at, the weight, and an optional stem a bare mention of the kind prefers. */
export type ConceptRow = readonly [words: string, targets: string, weight: number, prefer?: string];

/** A concept ready for matching: normalised triggers, the fragments that match inside a compound word, target stems, weight and preferred stem. */
export interface Concept {
  readonly triggers: ReadonlyArray<string>;
  readonly compounds: ReadonlyArray<string>;
  readonly targets: ReadonlyArray<string>;
  readonly weight: number;
  readonly prefer: string;
  readonly removal: boolean;
}

/** A concept a request mentions, whether the mention is denied and the longest of its words the request used. */
export interface ConceptHit {
  readonly concept: Concept;
  readonly negated: boolean;
  readonly phrase: string;
}

const EXACT_MARK = "=";

const COMPOUND_MARK = "~";

const GAP_MARK = "*";

const ALTERNATIVE = "|";

const WORD_END = "(?![a-z0-9])";
const WORD_REST = "[a-z0-9]*";

const WORD_GAP = "(?: [a-z][a-z0-9]*){0,3}";

const CJK_GAP = ".{0,8}";

const GAPS = new Map<string, RegExp>();

/** Joins the stems of a target that a candidate holds only when it holds every one of them ("fill&color" is a colour inside a fill). */
export const BOTH_MARK = "&";

export const VENDOR_MARK = "@";

function stemTarget(target: string): string {
  if (!target.startsWith(EXACT_MARK)) return target.split(BOTH_MARK).map(stemWord).join(BOTH_MARK);
  const words = target.slice(1).toLowerCase().split("_");
  const stems = words.filter((word) => !VENDOR_WORDS.has(word)).map(stemWord).filter((stem) => stem !== "").join("_");
  const vendors = words.filter((word) => VENDOR_WORDS.has(word));
  return `${EXACT_MARK}${stems}${vendors.length > 0 ? `${VENDOR_MARK}${vendors.join("_")}` : ""}`;
}

/** Whether a target names one effect or property exactly, by its whole display name with words joined by underscores ("=find_edges"), instead of any name that holds the stem. */
export function isExactTarget(target: string): boolean {
  return target.startsWith(EXACT_MARK);
}

/** The concepts of rows, normalised once. A target written "=gaussian_blur" holds only for a candidate whose display name is exactly those words. */
export function compileConcepts(rows: ReadonlyArray<ConceptRow>): ReadonlyArray<Concept> {
  return rows.map(([words, targets, weight, prefer]) => {
    const written = words.split(",").map((word) => normaliseText(word.trim())).filter((word) => word !== "");
    return {
      triggers: written.filter((word) => !word.startsWith(COMPOUND_MARK)),
      compounds: written.filter((word) => word.startsWith(COMPOUND_MARK)).map((word) => word.slice(1)).filter((word) => word !== ""),
      targets: targets.split(" ").filter((target) => target !== "").map(stemTarget),
      weight,
      prefer: prefer ?? "",
      removal: written.some((word) => CJK_REMOVAL_VERB.test(word)),
    };
  });
}

function wordIndexAt(joined: string, position: number): number {
  return joined.slice(0, position).split(" ").length - 2;
}

const WHOLE_WORDS: ReadonlySet<string> = new Set(["grad", "lang", "formal"]);

const FILLER = "(?: (?:the|a|an|my|this|that|your|its|el|la|los|las|un|una|mi|tu|su|este|esta|der|die|das|dem|den|ein|eine|einen|einem|einer|dein|diese|dieser|dieses|le|les|l|une|du|des|au|aux|ce|cette|mon|ma|mes|ton|ta|tes))?";

const LOOSE = new Map<string, RegExp>();

function looseMatch(trigger: string): RegExp {
  const known = LOOSE.get(trigger);
  if (known !== undefined) return known;
  const pattern = new RegExp(` ${trigger.split(" ").map((word) => word.replace(/[^\p{L}\p{N}]/gu, "")).join(`${FILLER} `)}`, "u");
  LOOSE.set(trigger, pattern);
  return pattern;
}

function looseStart(joined: string, trigger: string): number {
  const loose = trigger.includes(" ") && !hasCjk(trigger) ? joined.search(looseMatch(trigger)) : -1;
  return loose >= 0 ? loose : joined.indexOf(` ${trigger}`);
}

function gapPattern(trigger: string): RegExp {
  const known = GAPS.get(trigger);
  if (known !== undefined) return known;
  const latin = !hasCjk(trigger);
  const word = (text: string): string => (latin ? `${looseMatch(text).source}${text.length >= 4 ? WORD_REST : WORD_END}` : text);
  const part = (text: string): string => `(?:${text.split(ALTERNATIVE).map((alternative) => word(alternative.trim())).join("|")})`;
  const pattern = new RegExp(trigger.split(GAP_MARK).map(part).join(latin ? WORD_GAP : CJK_GAP), "u");
  GAPS.set(trigger, pattern);
  return pattern;
}

function triggerPosition(joined: string, trigger: string): number {
  if (WHOLE_WORDS.has(trigger)) return joined.indexOf(` ${trigger} `);
  const start = looseStart(joined, trigger);
  if (start >= 0 && (trigger.length >= 4 || joined.startsWith(" ", start + trigger.length + 1))) return start;
  return trigger.length >= 6 ? joined.indexOf(trigger) : -1;
}

interface Mention {
  readonly negated: boolean;
  readonly trigger: string;
}

function fragmentPosition(joined: string, fragment: string): number {
  return joined.indexOf(fragment);
}

function deniedCjk(clause: Clause, removal: boolean): boolean {
  if (removal && clause.denied) return CJK_NEGATION_BESIDES_REMOVAL.test(clause.text);
  return clause.denied || clause.negated.some(Boolean);
}

function gapMention(clause: Clause, trigger: string, removal: boolean): Mention | undefined {
  const cjk = hasCjk(trigger);
  const joined = ` ${clause.words.join(" ")} `;
  const found = gapPattern(trigger).exec(cjk ? clause.text : joined);
  if (found === null) return undefined;
  const negated = cjk ? deniedCjk(clause, removal) : clause.negated[Math.max(0, wordIndexAt(joined, found.index + 1))] === true;
  return { negated, trigger: found[0].trim() };
}

function triggerIn(clause: Clause, trigger: string, removal: boolean, locate: (joined: string, trigger: string) => number = triggerPosition): Mention | undefined {
  if (trigger.includes(GAP_MARK)) return gapMention(clause, trigger, removal);
  if (hasCjk(trigger)) return includesKana(clause.text, trigger) ? { negated: deniedCjk(clause, removal), trigger } : undefined;
  const joined = ` ${clause.words.join(" ")} `;
  const position = locate(joined, trigger);
  if (position < 0) return undefined;
  return { negated: clause.negated[Math.max(0, wordIndexAt(joined, position + 1))] === true, trigger };
}

function hitOf(concept: Concept, clauses: ReadonlyArray<Clause>): ConceptHit | undefined {
  const whole = clauses.flatMap((clause) => concept.triggers.map((trigger) => triggerIn(clause, trigger, concept.removal)));
  const inside = clauses.flatMap((clause) => concept.compounds.map((fragment) => triggerIn(clause, fragment, concept.removal, fragmentPosition)));
  const found = [...whole, ...inside].filter((mention) => mention !== undefined);
  const longest = found.reduce((best, mention) => (mention.trigger.length > best.length ? mention.trigger : best), "");
  if (found.length === 0) return undefined;
  return { concept, negated: found.every((mention) => mention.negated), phrase: longest };
}

function sharesTarget(left: ConceptHit, right: ConceptHit): boolean {
  return left.concept.targets.some((target) => right.concept.targets.includes(target));
}

function isShadowed(hit: ConceptHit, hits: ReadonlyArray<ConceptHit>): boolean {
  const inside = (other: ConceptHit): boolean => (hasCjk(hit.phrase) ? other.phrase.includes(hit.phrase) : ` ${other.phrase} `.includes(` ${hit.phrase} `));
  return hits.some((other) => !other.negated && other.phrase.length > hit.phrase.length && !sharesTarget(hit, other) && inside(other));
}

/** The concepts the clauses mention, each once; a concept is denied only when every mention of it is, and a concept whose longest mention sits inside the longer mention of another ("ondas" in "ondas de agua") is left out. */
export function conceptHits(clauses: ReadonlyArray<Clause>, concepts: ReadonlyArray<Concept>): ReadonlyArray<ConceptHit> {
  const hits = concepts.flatMap((concept) => hitOf(concept, clauses) ?? []);
  return hits.filter((hit) => !isShadowed(hit, hits));
}
