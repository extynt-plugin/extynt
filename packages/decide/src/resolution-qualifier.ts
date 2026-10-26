// The qualifier rule of the offline scorer: a name that adds a word to another candidate's name ("Fast" in "Radial Fast Blur") loses to the plain name unless the request says the word.
import type { Scored } from "./resolution-score.js";

const QUALIFIER_PENALTY = 0.4;

function without(tokens: ReadonlyArray<string>, index: number): string {
  return tokens.filter((_, position) => position !== index).join(" ");
}

function plainScores(scored: ReadonlyArray<Scored>): ReadonlyMap<string, number> {
  return new Map(scored.filter((row) => row.profile.display.length > 0).map((row) => [row.profile.display.join(" "), row.score]));
}

function unsaidQualifiers(row: Scored, plain: ReadonlyMap<string, number>, said: (token: string) => boolean): number {
  const tokens = row.profile.display;
  const found = tokens.filter((token, index) => (plain.get(without(tokens, index)) ?? 0) > 0 && !said(token));
  return found.length > 0 ? 1 : 0;
}

/** The rows with a penalty on every candidate that carries a word the request did not say and whose plain name, without it, also fits the request. */
export function penaliseQualifiers(scored: ReadonlyArray<Scored>, said: (token: string) => boolean): ReadonlyArray<Scored> {
  const plain = plainScores(scored);
  return scored.map((row) => (row.score > 0 ? { ...row, score: row.score - unsaidQualifiers(row, plain, said) * QUALIFIER_PENALTY } : row));
}
