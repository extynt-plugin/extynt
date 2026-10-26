// Size-independent choice over a runtime list: groups of at most K are asked in one batch, then the winners and the word-search hits are asked once more.
import { decide, decideAll } from "./decide.js";
import type { DecideOptions } from "./decide.js";
import { rankedCandidates, runtimeChoice, uniqueCandidates } from "./candidate-search.js";
import type { Candidate, Habits } from "./candidate-search.js";
import type { ChoiceResult } from "./result.js";
import type { Bands, ChoiceSpec } from "./spec.js";

/** The most candidates one question holds in the tournament; small enough for a model to keep accuracy, far below the 255-label limit. */
export const TOURNAMENT_GROUP_LIMIT = 40;

/** How many word-search hits join the winners in the final question. */
export const TOURNAMENT_HIT_LIMIT = 8;

/** The most group questions sent in one request, so that a long catalogue's first round stays inside a decision model's context; the requests of a round run in parallel. */
export const TOURNAMENT_QUESTIONS_PER_REQUEST = 24;

/** What the tournament asks about: the words the user used. */
export type TournamentState = { readonly phrase: string };

/** How a tournament is run: the questions' wording, how candidates group, and what the user's history says. */
export interface TournamentOptions {
  readonly name: string;
  readonly instructions: string;
  readonly noneMeaning: string;
  readonly groupOf?: (candidate: Candidate) => string;
  readonly subgroupOf?: (candidate: Candidate) => string;
  readonly hits?: (phrase: string) => ReadonlyArray<Candidate>;
  readonly limit?: number;
  readonly bands?: Bands;
  readonly habits?: Habits;
}

/** The outcome: the key picked (or "none"), the final question's result, the candidates the final question held, what it cost, and how many questions fell back to the word search. */
export interface TournamentResult {
  readonly key: string;
  readonly final: ChoiceResult<string>;
  readonly shortlist: ReadonlyArray<Candidate>;
  readonly rounds: number;
  readonly questions: number;
  readonly requests: number;
  readonly fallbacks: number;
}

interface Setting {
  readonly state: TournamentState;
  readonly options: TournamentOptions;
  readonly decideOptions: DecideOptions;
  readonly spent: Spent;
}

interface Spent {
  rounds: number;
  questions: number;
  requests: number;
  fallbacks: number;
}

function balancedChunks<T>(items: ReadonlyArray<T>, limit: number): ReadonlyArray<ReadonlyArray<T>> {
  const count = Math.ceil(items.length / limit);
  const size = Math.ceil(items.length / count);
  return Array.from({ length: count }, (_, index) => items.slice(index * size, (index + 1) * size));
}

function byTitle(left: Candidate, right: Candidate): number {
  return left.title.localeCompare(right.title) || left.key.localeCompare(right.key);
}

function firstWord(candidate: Candidate): string {
  return candidate.key.split(/[\s_\-.]+/)[0] ?? candidate.key;
}

function packSmall(buckets: ReadonlyArray<ReadonlyArray<Candidate>>, limit: number): ReadonlyArray<ReadonlyArray<Candidate>> {
  const bins: Candidate[][] = [];
  for (const bucket of [...buckets].sort((left, right) => right.length - left.length)) {
    const bin = bins.find((open) => open.length + bucket.length <= limit);
    if (bin === undefined) bins.push([...bucket]);
    else bin.push(...bucket);
  }
  return bins;
}

/** Splits candidates into groups of at most `limit`: by `groupOf`, a group above the limit cut into balanced chunks ordered by `subgroupOf`, small groups packed together. */
export function partitionCandidates(
  candidates: ReadonlyArray<Candidate>, limit: number, groupOf: (candidate: Candidate) => string, subgroupOf: (candidate: Candidate) => string,
): ReadonlyArray<ReadonlyArray<Candidate>> {
  const buckets = new Map<string, Candidate[]>();
  for (const candidate of candidates) buckets.set(groupOf(candidate), [...(buckets.get(groupOf(candidate)) ?? []), candidate]);
  const small: ReadonlyArray<Candidate>[] = [];
  const split: ReadonlyArray<Candidate>[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.length <= limit) small.push(bucket);
    else split.push(...balancedChunks([...bucket].sort((left, right) => subgroupOf(left).localeCompare(subgroupOf(right)) || byTitle(left, right)), limit));
  }
  return [...split, ...packSmall(small, limit)];
}

const GROUP_BANDS: Bands = { verify: 0, act: 0 };

function choiceOver(options: TournamentOptions, candidates: ReadonlyArray<Candidate>, bands: Bands | undefined): ChoiceSpec<TournamentState, string> {
  const base = runtimeChoice<TournamentState>({
    name: options.name, instructions: options.instructions, noneMeaning: options.noneMeaning, candidates, ...(options.habits === undefined ? {} : { habits: options.habits }),
  });
  return bands === undefined ? base : { ...base, bands };
}

function waves<T>(items: ReadonlyArray<T>, size: number): ReadonlyArray<ReadonlyArray<T>> {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
}

async function winnersOf(setting: Setting, groups: ReadonlyArray<ReadonlyArray<Candidate>>): Promise<ReadonlyArray<Candidate>> {
  const { state, options, decideOptions, spent } = setting;
  const entries = groups.map((group, index): readonly [string, ChoiceSpec<TournamentState, string>] => [`group${index}`, choiceOver(options, group, GROUP_BANDS)]);
  const batches = waves(entries, TOURNAMENT_QUESTIONS_PER_REQUEST);
  const settled = await Promise.all(batches.map((batch) => decideAll(state, Object.fromEntries(batch), decideOptions)));
  const results = settled.flatMap((batch) => Object.values(batch));
  spent.requests += batches.length;
  spent.fallbacks += results.filter((result) => result.fallback !== null).length;
  const picked = new Set(results.map((result) => result.label));
  return groups.flat().filter((candidate) => picked.has(candidate.key));
}

function hitsOf(phrase: string, candidates: ReadonlyArray<Candidate>, options: TournamentOptions): ReadonlyArray<Candidate> {
  return options.hits?.(phrase) ?? rankedCandidates(phrase, candidates, options.habits?.score).slice(0, TOURNAMENT_HIT_LIMIT);
}

async function run(setting: Setting, candidates: ReadonlyArray<Candidate>): Promise<TournamentResult> {
  const { state, options, decideOptions, spent } = setting;
  const limit = options.limit ?? TOURNAMENT_GROUP_LIMIT;
  let shortlist = uniqueCandidates(candidates);
  if (shortlist.length > limit) {
    const groups = partitionCandidates(shortlist, limit, options.groupOf ?? ((candidate) => candidate.group), options.subgroupOf ?? firstWord);
    const winners = await winnersOf(setting, groups);
    spent.rounds += 1;
    spent.questions += groups.length;
    const merged = uniqueCandidates([...hitsOf(state.phrase, shortlist, options), ...winners]);
    if (merged.length > limit && merged.length < shortlist.length) return run(setting, merged);
    shortlist = merged.slice(0, limit);
  }
  const final = await decide(state, choiceOver(options, shortlist, options.bands), decideOptions);
  return { key: final.label, final, shortlist, rounds: spent.rounds + 1, questions: spent.questions + 1, requests: spent.requests + 1, fallbacks: spent.fallbacks + (final.fallback === null ? 0 : 1) };
}

/**
 * Picks the candidate the phrase means, or "none", whatever the list's size: groups of at most `limit` are each asked in one batched request, then one
 * final question holds the group winners and the word-search hits (recursing while that is still too long). With no decision model the answer is the word search's.
 */
export function tournamentChoice(phrase: string, candidates: ReadonlyArray<Candidate>, options: TournamentOptions, decideOptions: DecideOptions): Promise<TournamentResult> {
  return run({ state: { phrase }, options, decideOptions, spent: { rounds: 0, questions: 0, requests: 0, fallbacks: 0 } }, candidates);
}
