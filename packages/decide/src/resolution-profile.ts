// The searchable shape of a candidate for the offline resolvers: its name stems, its match-name stems, its group stems and the raw words of its name.
import { normaliseText, stemWord } from "./resolution-text.js";
import type { Candidate } from "./candidate-search.js";

/** A candidate broken into the stems the scorer compares a request against. */
export interface Profile {
  readonly key: string;
  readonly nameKey: string;
  readonly matchKey: string;
  readonly fullNameKey: string;
  readonly fullMatchKey: string;
  readonly twin: boolean;
  readonly display: ReadonlyArray<string>;
  readonly extra: ReadonlyArray<string>;
  readonly group: ReadonlyArray<string>;
  readonly raw: ReadonlyArray<string>;
  readonly native: boolean;
  readonly vendors: ReadonlyArray<string>;
}

/** The vendor prefixes a display name is stripped of before it is compared. */
export const VENDOR_WORDS = new Set(["adbe", "cc", "apc", "pseudo", "ae"]);

const FUNCTION_WORDS = new Set(["the", "of", "and", "with", "to", "on", "in", "for"]);

const FILLER_WORDS = new Set([...VENDOR_WORDS, ...FUNCTION_WORDS]);

function splitName(name: string): ReadonlyArray<string> {
  return normaliseText(name.replace(/([a-z])([A-Z])/gu, "$1 $2")).match(/[a-z0-9]+/gu) ?? [];
}

function stemsOf(words: ReadonlyArray<string>, dropped: ReadonlySet<string> = FILLER_WORDS): ReadonlyArray<string> {
  return words.filter((word) => !dropped.has(word)).map(stemWord).filter((stem) => stem !== "");
}

/** An underscore-joined name key without its function words. */
export function plainKey(key: string): string {
  return key.split("_").filter((word) => !FUNCTION_WORDS.has(word)).join("_");
}

function distinct(words: ReadonlyArray<string>): ReadonlyArray<string> {
  return [...new Set(words)];
}

/** The profile of a candidate: `names[0]` is its display name, the others contribute match-name stems, `group` its menu group or value type. */
export function profileOf(candidate: Candidate): Profile {
  const display = distinct(stemsOf(splitName(candidate.title)));
  const extra = distinct(stemsOf(candidate.names.slice(1).flatMap(splitName))).filter((stem) => !display.includes(stem));
  const matchName = candidate.names.find((name) => name !== candidate.title) ?? candidate.key;
  return {
    key: candidate.key,
    nameKey: display.join("_"),
    matchKey: distinct(stemsOf(splitName(matchName))).join("_"),
    fullNameKey: distinct(stemsOf(splitName(candidate.title), VENDOR_WORDS)).join("_"),
    fullMatchKey: distinct(stemsOf(splitName(matchName), VENDOR_WORDS)).join("_"),
    twin: false,
    display,
    extra,
    group: distinct(stemsOf(splitName(candidate.group))),
    raw: distinct(splitName(candidate.title).filter((word) => !FILLER_WORDS.has(word))),
    native: /^(ADBE|Pseudo\/ADBE)\b/u.test(matchName),
    vendors: distinct(splitName(matchName).filter((word) => VENDOR_WORDS.has(word))),
  };
}

function variantsBy(profiles: ReadonlyArray<Profile>, keyOf: (profile: Profile) => string): ReadonlyMap<string, ReadonlySet<string>> {
  const groups = new Map<string, Set<string>>();
  for (const profile of profiles) groups.set(keyOf(profile), (groups.get(keyOf(profile)) ?? new Set<string>()).add(profile.fullNameKey));
  return groups;
}

/** The profiles with those marked as twins whose names differ only by a function word ("Change Color" and "Change to Color"). */
export function markTwins(profiles: ReadonlyArray<Profile>): ReadonlyArray<Profile> {
  const byName = variantsBy(profiles, (profile) => profile.nameKey);
  const byMatch = variantsBy(profiles, (profile) => profile.matchKey);
  return profiles.map((profile) => ((byName.get(profile.nameKey)?.size ?? 0) > 1 || (byMatch.get(profile.matchKey)?.size ?? 0) > 1 ? { ...profile, twin: true } : profile));
}
