// Font matching: which installed family a request phrase means, as a closed choice built at run time from the word-search hits and the nearest family names.
import { array, object, optional, string } from "@extynt/decode";
import type { Infer } from "@extynt/decode";
import { NO_MATCH, rankedCandidates, runtimeChoice } from "./candidate-search.js";
import type { Candidate, Habits } from "./candidate-search.js";
import type { DecideOptions } from "./decide.js";
import type { Bands, ChoiceSpec } from "./spec.js";
import { pickFont } from "./resolution-fonts.js";
import { tournamentChoice } from "./tournament.js";
import type { TournamentResult } from "./tournament.js";

/** An installed font style as the host lists it. */
export const fontRecord = object({ family: string(), style: string(), postScriptName: string(), technology: optional(string()) });

/** The decoder for the installed font list. */
export const fontRecords = array(fontRecord);

/** An installed font style: its family, its style and its PostScript name. */
export type FontRecord = Infer<typeof fontRecord>;

/** What the font choice reads: the words the user used for the font. */
export type FontRequest = { readonly phrase: string };

/** How many families make a shortlist. */
export const FONT_SHORTLIST_LIMIT = 40;

const NEAREST_LIMIT = 12;

const STYLES_SHOWN = 6;

const INSTRUCTIONS = [
  "A motion designer's request names a typeface for a text layer. Pick the one candidate installed font family they mean.",
  "Go by meaning as well as spelling: a request may name a family loosely, by a nickname, or in another language; a described look (bold geometric sans) means the family that best fits it.",
  "Answer none when the request names no typeface, or when no candidate is what it means.",
].join(" ");

const NONE_MEANING = "no candidate family is the typeface the request means, or the request names none";

function familyWords(text: string): ReadonlyArray<string> {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function wordsRelated(word: string, other: string): boolean {
  return word === other || (Math.min(word.length, other.length) >= 3 && (word.includes(other) || other.includes(word)));
}

function familyScore(family: string, wanted: string, words: ReadonlyArray<string>): number {
  const name = family.toLowerCase();
  const have = familyWords(family);
  const shared = words.filter((word) => have.some((other) => wordsRelated(word, other))).length;
  return (name.includes(wanted) || wanted.includes(name) ? words.length + 1 : 0) + shared;
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** The installed families closest to a phrase whose words match no font: whole-name containment either way, then shared words of three letters or more; best first, then alphabetical. */
export function nearestFamilies(installed: ReadonlyArray<FontRecord>, phrase: string, limit: number = NEAREST_LIMIT): ReadonlyArray<string> {
  const wanted = phrase.trim().toLowerCase();
  if (wanted === "") return [];
  const words = familyWords(phrase);
  const families = [...new Set(installed.map((record) => record.family).filter(Boolean))];
  const scored = families.map((family) => ({ family, score: familyScore(family, wanted, words) })).filter((row) => row.score > 0);
  scored.sort((left, right) => right.score - left.score || compareText(left.family, right.family));
  return scored.slice(0, limit).map((row) => row.family);
}

function fontCandidates(installed: ReadonlyArray<FontRecord>): ReadonlyArray<Candidate> {
  const styles = new Map<string, string[]>();
  for (const record of installed) {
    if (record.family !== "") styles.set(record.family, [...(styles.get(record.family) ?? []), record.style]);
  }
  return [...styles].map(([family, own]) => ({
    key: family,
    names: [family, ...own],
    group: `font family; styles ${[...new Set(own)].slice(0, STYLES_SHOWN).join(", ")}`,
    title: family,
  }));
}

function familyRows(installed: ReadonlyArray<FontRecord>): ReadonlyArray<Candidate> {
  return installed.map((record): Candidate => ({ key: record.postScriptName, names: [record.family, record.style, record.postScriptName], group: record.family, title: record.family }));
}

function pickedFamily(phrase: string, installed: ReadonlyArray<FontRecord>): ReadonlyArray<string> {
  const families = fontCandidates(installed);
  const key = pickFont(phrase, families, {});
  return key === NO_MATCH ? [] : [key];
}

/** The family the offline picker names, then the families whose family, style or PostScript name hold every word of the phrase (best first), then the nearest family names, each family once and at most `limit`. */
export function shortlistFamilies(phrase: string, installed: ReadonlyArray<FontRecord>, limit: number = FONT_SHORTLIST_LIMIT): ReadonlyArray<string> {
  const hits = rankedCandidates(phrase, familyRows(installed)).map((row) => row.title);
  return [...new Set([...pickedFamily(phrase, installed), ...hits, ...nearestFamilies(installed, phrase)])].slice(0, limit);
}

/**
 * The closed question "which installed family does the phrase mean?" over the shortlist: one label per family plus "none". The offline answer is
 * the family of the best word-search hit (the nearest names are suggestions, never a pick), or "none" when no font holds every word.
 */
export function fontChoice(phrase: string, installed: ReadonlyArray<FontRecord>, habits?: Habits): ChoiceSpec<FontRequest, string> {
  const shortlisted = new Set(shortlistFamilies(phrase, installed));
  const candidates = fontCandidates(installed).filter((candidate) => shortlisted.has(candidate.key));
  const base = runtimeChoice<FontRequest>({ name: "font", instructions: INSTRUCTIONS, noneMeaning: NONE_MEANING, candidates, ...(habits === undefined ? {} : { habits }) });
  const deterministic = (state: FontRequest): string => pickFont(state.phrase, candidates, habits?.score ?? {});
  return { ...base, deterministic };
}

function hitCandidates(phrase: string, installed: ReadonlyArray<FontRecord>, candidates: ReadonlyArray<Candidate>): ReadonlyArray<Candidate> {
  const shortlisted = new Set(shortlistFamilies(phrase, installed));
  return candidates.filter((candidate) => shortlisted.has(candidate.key));
}

/** What a font resolution may be tuned with: the user's habits and the bands that route the final answer. */
export interface FontTuning {
  readonly habits?: Habits;
  readonly bands?: Bands;
}

/**
 * Resolves a phrase to an installed font family whatever the number installed: families in balanced alphabetical groups of at most 40 are each asked in one batch,
 * and the winners join the word-search hits and nearest names in a final question. The offline answer is the family of the best word-search hit, else "none".
 */
export function resolveFont(phrase: string, installed: ReadonlyArray<FontRecord>, options: DecideOptions, tuning: FontTuning = {}): Promise<TournamentResult> {
  const candidates = fontCandidates(installed);
  return tournamentChoice(phrase, candidates, {
    name: "font", instructions: INSTRUCTIONS, noneMeaning: NONE_MEANING, groupOf: () => "fonts", hits: (words) => hitCandidates(words, installed, candidates),
    ...(tuning.habits === undefined ? {} : { habits: tuning.habits }), ...(tuning.bands === undefined ? {} : { bands: tuning.bands }),
  }, options);
}
