// Word-by-word search over a runtime list of candidates, and the closed choice spec built from the shortlist it returns.
import type { JsonValue } from "./json.js";
import { fontConfidence, standingConfidence } from "./resolution-confidence.js";
import { pickEffect, standEffects } from "./resolution-effects.js";
import { pickFont, standFont } from "./resolution-fonts.js";
import { choice } from "./spec.js";
import type { ChoiceSpec, Labelled } from "./spec.js";

/** The label every runtime choice carries for "none of the candidates is what the request means". */
export const NO_MATCH = "none";

/** A thing the request might mean: the label key it answers to, the names it is known by, a short description of what it is, and what the user's history says about it. */
export interface Candidate {
  readonly key: string;
  readonly names: ReadonlyArray<string>;
  readonly group: string;
  readonly title: string;
  readonly note?: string;
}

/** What a runtime choice reads at least: the words the user used for the thing. */
export type PhraseState = { readonly phrase: string };

function queryTokens(phrase: string): ReadonlyArray<string> {
  const normalised = phrase.trim().toLowerCase();
  return normalised === "" ? [] : normalised.split(/\s+/);
}

function matchesAllTokens(candidate: Candidate, tokens: ReadonlyArray<string>): boolean {
  const fields = [...candidate.names, candidate.group].map((field) => field.toLowerCase());
  return tokens.every((token) => fields.some((field) => field.includes(token)));
}

function rankOf(candidate: Candidate, tokens: ReadonlyArray<string>): readonly [number, number] {
  const names = candidate.names.map((name) => name.toLowerCase());
  const phrase = tokens.join(" ");
  const contiguous = names.some((name) => name.includes(phrase)) ? 0 : 1;
  return [contiguous, -tokens.filter((token) => names.some((name) => name.includes(token))).length];
}

/** The candidates containing every word of the phrase, best first: a name holding the whole phrase, then most words in a name; a tie goes to the higher `habit` and then keeps the caller's order. */
export function rankedCandidates<C extends Candidate>(phrase: string, candidates: ReadonlyArray<C>, habit: Readonly<Record<string, number>> = {}): ReadonlyArray<C> {
  const tokens = queryTokens(phrase);
  const matched = candidates.filter((candidate) => matchesAllTokens(candidate, tokens)).map((candidate) => ({ candidate, rank: rankOf(candidate, tokens) }));
  matched.sort((left, right) => left.rank[0] - right.rank[0] || left.rank[1] - right.rank[1] || (habit[right.candidate.key] ?? 0) - (habit[left.candidate.key] ?? 0));
  return matched.map((entry) => entry.candidate);
}

/** The first candidate of each key, in order, so a repeated key cannot make two labels. */
export function uniqueCandidates<C extends Candidate>(candidates: ReadonlyArray<C>): ReadonlyArray<C> {
  const firstOfKey = new Map<string, C>();
  for (const candidate of candidates) if (candidate.key !== NO_MATCH && !firstOfKey.has(candidate.key)) firstOfKey.set(candidate.key, candidate);
  return [...firstOfKey.values()];
}

function describe(candidate: Candidate): string {
  return `${candidate.title} (${candidate.group})${candidate.note === undefined ? "" : `; ${candidate.note}`}`;
}

function alphabetical(left: Candidate, right: Candidate): number {
  return left.title.localeCompare(right.title) || left.key.localeCompare(right.key);
}

function labelsOf(candidates: ReadonlyArray<Candidate>, noneMeaning: string): Labelled<string> {
  const entries = [...candidates].sort(alphabetical).map((candidate): readonly [string, string] => [candidate.key, describe(candidate)]);
  return Object.fromEntries([...entries, [NO_MATCH, noneMeaning]]);
}

/** What the user's history says about candidates, by candidate key: a score to break ties with and a sentence a decision model can read. */
export interface Habits {
  readonly score: Readonly<Record<string, number>>;
  readonly note: Readonly<Record<string, string>>;
}

type Picker = (phrase: string, candidates: ReadonlyArray<Candidate>, habit: Readonly<Record<string, number>>) => string;

const PICKERS: ReadonlyMap<string, Picker> = new Map([["effect", pickEffect], ["font", pickFont]]);

type Confider = (phrase: string, candidates: ReadonlyArray<Candidate>, habit: Readonly<Record<string, number>>) => number;

const CONFIDERS: ReadonlyMap<string, Confider> = new Map<string, Confider>([
  ["effect", (phrase, candidates, habit) => standingConfidence(standEffects(phrase, candidates, habit))],
  ["font", (phrase, candidates, habit) => fontConfidence(standFont(phrase, candidates, habit))],
]);

const DEFAULT_ABSTAIN_BELOW = 0.6;

function firstWordHit(phrase: string, candidates: ReadonlyArray<Candidate>, habit: Readonly<Record<string, number>>): string {
  return rankedCandidates(phrase, candidates, habit)[0]?.key ?? NO_MATCH;
}

/** What a runtime choice is built from: its name, instructions, the meaning of "none", the candidates and, optionally, the user's habits. */
export interface RuntimeChoiceSpec {
  readonly pick?: Picker;
  readonly confide?: Confider;
  readonly abstainBelow?: number;
  readonly name: string;
  readonly instructions: string;
  readonly noneMeaning: string;
  readonly candidates: ReadonlyArray<Candidate>;
  readonly habits?: Habits;
}

const HABIT_INSTRUCTION = [
  "A candidate marked as the user's usual choice wins among candidates that fit the request equally, even over a more common one.",
  "It never overrides a request that names or describes a different candidate.",
].join(" ");

function hasHabit(habits: Habits | undefined): habits is Habits {
  return habits !== undefined && Object.values(habits.score).some((score) => score > 0);
}

function withNote(candidate: Candidate, habits: Habits | undefined): Candidate {
  const note = habits?.note[candidate.key];
  return note === undefined ? candidate : { ...candidate, note };
}

function preferenceOf(habits: Habits | undefined): { readonly preference?: Habits["score"] } {
  return hasHabit(habits) ? { preference: habits.score } : {};
}

function confidenceOf(
  confide: Confider | undefined,
  candidates: ReadonlyArray<Candidate>,
  habit: Habits["score"],
): { readonly deterministicConfidence?: (state: PhraseState) => number } {
  return confide === undefined ? {} : { deterministicConfidence: (state) => confide(state.phrase, candidates, habit) };
}

/**
 * Declares the closed choice over a runtime shortlist: one label per candidate plus "none", shown in alphabetical order with "none" last so that
 * position carries no signal. The offline answer is the best-ranked candidate whose names hold every word, a tie going to the user's habit.
 */
export function runtimeChoice<S extends PhraseState & JsonValue>(spec: RuntimeChoiceSpec): ChoiceSpec<S, string> {
  const candidates = uniqueCandidates(spec.candidates).map((candidate) => withNote(candidate, spec.habits));
  const habit = spec.habits?.score ?? {};
  const pick = spec.pick ?? PICKERS.get(spec.name) ?? firstWordHit;
  const confide = spec.confide ?? CONFIDERS.get(spec.name);
  return choice<S, string>({
    name: spec.name,
    instructions: hasHabit(spec.habits) ? `${spec.instructions} ${HABIT_INSTRUCTION}` : spec.instructions,
    labels: labelsOf(candidates, spec.noneMeaning),
    ...preferenceOf(spec.habits),
    abstainBelow: spec.abstainBelow ?? DEFAULT_ABSTAIN_BELOW,
    deterministic: (state) => pick(state.phrase, candidates, habit),
    ...confidenceOf(confide, candidates, habit),
  });
}
