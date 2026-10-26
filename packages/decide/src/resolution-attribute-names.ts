// The match names of the controls of one effect share their effect's words; those shared words say nothing about which control a request means.
import type { Candidate } from "./candidate-search.js";

const KEPT = new Set(["ADBE", "Pseudo"]);

function wordsOfName(name: string): ReadonlyArray<string> {
  return name.split(/[^A-Za-z0-9]+/u).filter((word) => word.length > 0);
}

function matchNameOf(candidate: Candidate): string {
  return candidate.names.find((name) => name !== candidate.title) ?? candidate.key;
}

function sharedWords(candidates: ReadonlyArray<Candidate>): ReadonlySet<string> {
  const lists = candidates.map((candidate) => new Set(wordsOfName(matchNameOf(candidate))));
  const first = lists[0] ?? new Set<string>();
  return new Set([...first].filter((word) => !KEPT.has(word) && lists.every((list) => list.has(word))));
}

/** The candidates with the words every match name holds taken out of the match names, so the title alone tells them apart. */
export function withoutSharedMatchWords(candidates: ReadonlyArray<Candidate>): ReadonlyArray<Candidate> {
  if (candidates.length < 2) return candidates;
  const shared = sharedWords(candidates);
  if (shared.size === 0) return candidates;
  return candidates.map((candidate) => {
    const kept = wordsOfName(matchNameOf(candidate)).filter((word) => !shared.has(word));
    return { ...candidate, names: [candidate.title, kept.join(" ")] };
  });
}
