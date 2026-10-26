// Word-by-word search over the host profile and the curated catalogue.
import { compareText } from "./canonical.js";
import type { Capability, CatalogueGraph, HostCapabilityProfile, HostProfileEntry } from "./catalogue-model.js";
import { matchesAllTokens, queryTokens, rankTokenMatches } from "./token-search.js";

const MAX_PROFILE_RESULTS = 100;
const MAX_CAPABILITY_RESULTS = 100;
const DEFAULT_RESULTS = 25;
const DEMOTED_CATEGORIES: ReadonlySet<string | undefined> = new Set(["obsolete", "preset-controls"]);

function entryMatchesWord(entry: HostProfileEntry, word: string): boolean {
  return !word || [entry.id, entry.matchName, entry.displayName, entry.description].some((value) => value?.toLowerCase().includes(word));
}

/** Host-profile search matches every query word one by one over id, matchName, displayName and description; `limit` is clamped to 1..100 and `truncated` reports matches beyond the page. */
export function searchHostProfile(profile: HostCapabilityProfile, query: string, limit = DEFAULT_RESULTS): { entries: HostProfileEntry[]; truncated: boolean } {
  const tokens = queryTokens(query);
  const matching = tokens.length <= 1
    ? profile.entries.filter((entry) => entryMatchesWord(entry, tokens[0] ?? ""))
    : rankTokenMatches(profile.entries.map((entry) => ({ item: entry, identity: [entry.id, entry.matchName, entry.displayName], fields: [entry.id, entry.matchName, entry.displayName, entry.description] })), tokens);
  const bounded = Math.max(1, Math.min(MAX_PROFILE_RESULTS, limit));
  return { entries: matching.slice(0, bounded), truncated: matching.length > bounded };
}

function baseRank(capability: Capability): number {
  return (capability.semanticRoles?.length ? 0 : 4) + (DEMOTED_CATEGORIES.has(capability.category) ? 2 : 0);
}

function nameCarries(capability: Capability, words: readonly string[]): number {
  const name = capability.displayName.toLowerCase();
  return words.every((word) => name.includes(word)) ? 0 : 1;
}

function searchByOneWord(graph: CatalogueGraph, query: string): Capability[] {
  const word = query.trim().toLowerCase();
  const rank = (capability: Capability): number => baseRank(capability) + (!word ? 0 : nameCarries(capability, [word]));
  return graph.capabilities
    .filter((capability) => !word || [capability.displayName, capability.matchName, capability.description, capability.category].some((value) => value?.toLowerCase().includes(word)))
    .sort((a, b) => rank(a) - rank(b) || compareText(a.displayName, b.displayName));
}

function searchByWords(graph: CatalogueGraph, tokens: readonly string[]): Capability[] {
  const phrase = tokens.join(" ");
  const rank = (capability: Capability): number => baseRank(capability) + nameCarries(capability, tokens);
  const phraseInName = (capability: Capability): number => ([capability.displayName, capability.matchName, capability.id].some((value) => value?.toLowerCase().includes(phrase)) ? 0 : 1);
  return graph.capabilities
    .filter((capability) => matchesAllTokens([capability.displayName, capability.matchName, capability.description, capability.category], tokens))
    .sort((a, b) => rank(a) - rank(b) || phraseInName(a) - phraseInName(b) || compareText(a.displayName, b.displayName));
}

/** Catalogue search matches every query word one by one over display name, match name, description and category, ranking role-bearing entries first and breaking ties on a contiguous name phrase. */
export function searchCapabilities(graph: CatalogueGraph, query: string, limit = DEFAULT_RESULTS): Capability[] {
  const bounded = Math.max(0, Math.min(MAX_CAPABILITY_RESULTS, limit));
  const tokens = queryTokens(query);
  const found = tokens.length <= 1 ? searchByOneWord(graph, query) : searchByWords(graph, tokens);
  return found.slice(0, bounded);
}
