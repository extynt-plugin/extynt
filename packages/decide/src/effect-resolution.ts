// Effect resolution at any catalogue size: a tournament over the installed effects, grouped by menu category and then by match-name prefix.
import type { DecideOptions } from "./decide.js";
import type { Habits } from "./candidate-search.js";
import { rankEffects } from "./resolution-effects.js";
import { asEffectCandidate, EFFECT_INSTRUCTIONS, EFFECT_NONE_MEANING } from "./effect-choice.js";
import type { EffectCandidate } from "./effect-choice.js";
import { TOURNAMENT_HIT_LIMIT, tournamentChoice } from "./tournament.js";
import type { TournamentResult } from "./tournament.js";

/**
 * Resolves a phrase to an installed effect whatever the number installed: the effects are grouped by category (then match-name prefix, in balanced chunks of at most 40),
 * each group is asked in one batch, and the winners join the word-search hits in a final question. With no decision model the answer is the word search's.
 */
export function resolveEffect(phrase: string, installed: ReadonlyArray<EffectCandidate>, options: DecideOptions, habits?: Habits): Promise<TournamentResult> {
  const candidates = installed.map(asEffectCandidate);
  const byKey = new Map(candidates.map((candidate) => [candidate.key, candidate]));
  const hits = (words: string) => rankEffects(words, candidates, habits?.score).slice(0, TOURNAMENT_HIT_LIMIT).flatMap((key) => byKey.get(key) ?? []);
  return tournamentChoice(phrase, candidates, {
    name: "effect", instructions: EFFECT_INSTRUCTIONS, noneMeaning: EFFECT_NONE_MEANING, hits, ...(habits === undefined ? {} : { habits }),
  }, options);
}
