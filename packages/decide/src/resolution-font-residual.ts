// Which words left over from a described look could still name a family: a word of a known family name, a word typed with a capital (unless the request is German, where every noun has one), or a katakana spelling; any other plain word describes and does not veto the look.
import type { Candidate } from "./candidate-search.js";
import { FAMILY_TAGS } from "./resolution-font-tags.js";
import { ALL_LOOK_WORDS } from "./resolution-font-all-words.js";
import { readsGerman } from "./resolution-font-fillers.js";
import { normaliseText, wordsOf } from "./resolution-text.js";
import type { Clause } from "./resolution-text.js";

const LOOK_WORDS: ReadonlySet<string> = new Set(ALL_LOOK_WORDS.flatMap(([words]) => wordsOf(normaliseText(words))));

const KNOWN_WORDS: ReadonlySet<string> = new Set([...FAMILY_TAGS.keys()].flatMap((family) => wordsOf(normaliseText(family))).filter((word) => !LOOK_WORDS.has(word)));

function capitalised(phrase: string): ReadonlySet<string> {
  const words = phrase.split(/[^\p{L}\p{N}']+/u).filter((word) => word !== "");
  const upper = words.map((word) => /^\p{Lu}/u.test(word));
  const from = upper.slice(1).some(Boolean) ? 0 : 1;
  return new Set(words.slice(from).filter((_, index) => upper[from + index] === true).map((word) => normaliseText(word)));
}

/** A test for whether a word left over from the look could name a family: it is plain Latin text from the request that no installed or known family name holds and the request does not capitalise. */
export function nameLikeWord(phrase: string, clauses: ReadonlyArray<Clause>, candidates: ReadonlyArray<Candidate>): (token: string) => boolean {
  const plain = new Set(clauses.flatMap((clause) => clause.words));
  const installed = new Set(candidates.flatMap((candidate) => wordsOf(normaliseText(candidate.title))));
  const capitals = readsGerman([...plain]) ? new Set<string>() : capitalised(phrase);
  return (token) => !plain.has(token) || KNOWN_WORDS.has(token) || installed.has(token) || capitals.has(token);
}

const FAMILY_PREFIXES: ReadonlySet<string> = new Set([...FAMILY_TAGS.keys()].flatMap((family) => {
  const words = wordsOf(normaliseText(family));
  return words.slice(1).map((_, index) => words.slice(0, index + 2).join(" "));
}));

/** Whether the words of a request (style words aside) spell the start of a known two-word or longer family name ("brush script" for Brush Script MT), which names a family and not a look. */
export function spellsFamilyStart(words: ReadonlyArray<string>): boolean {
  return words.length >= 2 && FAMILY_PREFIXES.has(words.join(" "));
}
