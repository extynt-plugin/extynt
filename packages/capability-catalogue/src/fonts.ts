// Installed fonts: the inventory built from the host's font census, its search, and the nearest families to a query that matched nothing.
import { array, boolean, literal, map, number, object, optional, string } from "@extynt/decode";
import type { Decoder } from "@extynt/decode";

import { compareText, sha256Hex, stableJson } from "./canonical.js";
import { isKept, list, skippable, softly } from "./decoder-kit.js";
import { queryTokens, rankTokenMatches } from "./token-search.js";

/** Every name that reaches a prompt is bounded; the text-document field allows 256, so this is safely inside it. */
export const MAX_FONT_NAME_CHARS = 96;

/** Styles are sorted and then cut, so the cap must sit above every real host's count; absence from `items` is never proof of absence. */
export const MAX_FONT_RECORDS = 8192;

/** Search results per page, matching the other bounded searches. */
export const MAX_FONT_RESULTS = 50;

/** Search results per page when the caller names no limit. */
export const DEFAULT_FONT_RESULTS = 25;

/** How many installed families an empty search offers instead. */
export const NEAREST_FONT_FAMILIES = 12;

const MAX_HOST_KEY_CHARS = 128;

/** One installed font style; a record without a PostScript name cannot be addressed and is never kept. `technology` is the font format when the host reports one. */
export interface FontRecord {
  family: string;
  style: string;
  postScriptName: string;
  technology?: string;
}

/**
 * The installed fonts. `truncated` says the host offered more styles than were kept, so absence from `items` is not
 * proof a font is not installed. `totalReported` and `familiesReported` are the host's counts before any cap.
 * `hostFingerprint` is the host's own cheap key for this list, sent back with the next census so an unchanged list is
 * not read again. `loading` is true while a census is outstanding (`items` is then whatever was held) and is never stored.
 */
export interface FontInventory {
  items: FontRecord[];
  truncated: boolean;
  completeness: "complete" | "partial" | "failed";
  totalReported: number;
  familiesReported: number;
  fingerprint: string;
  hostFingerprint?: string | undefined;
  loading?: boolean | undefined;
}

/** One page of a font search; `total` counts every match, not only the page returned. */
export interface FontSearch {
  items: FontRecord[];
  total: number;
  returned: number;
  truncated: boolean;
}

/** The font fields of a census result, each absent when the host did not report it. */
export interface FontCensusFields {
  readonly installedFonts?: readonly FontEntryFields[] | undefined;
  readonly fontTotalReported?: number | undefined;
  readonly fontFamiliesReported?: number | undefined;
  readonly fontCompleteness?: FontInventory["completeness"] | undefined;
  readonly fontFingerprint?: string | undefined;
}

/** A font as a host reports it: any field may be missing or unreadable. */
export interface FontEntryFields {
  readonly family?: string | undefined;
  readonly style?: string | undefined;
  readonly postScriptName?: string | undefined;
  readonly technology?: string | undefined;
}

interface FontReadFacts {
  readonly truncated?: boolean | undefined;
  readonly completeness?: FontInventory["completeness"] | undefined;
  readonly totalReported?: number | undefined;
  readonly familiesReported?: number | undefined;
}

const fontEntry: Decoder<FontEntryFields> = object({
  family: softly(string()),
  style: softly(string()),
  postScriptName: softly(string()),
  technology: softly(string()),
});

/** Decodes the font fields of a census result; a field that is not what the host sends reads as absent. */
export const fontCensus: Decoder<FontCensusFields> = object({
  installedFonts: softly(map(array(skippable(fontEntry)), (rows) => rows.filter(isKept))),
  fontTotalReported: softly(number()),
  fontFamiliesReported: softly(number()),
  fontCompleteness: softly(literal("complete", "partial", "failed")),
  fontFingerprint: softly(string({ nonEmpty: true, maxLength: MAX_HOST_KEY_CHARS })),
});

/** Decodes a stored font inventory: every field must be what `makeFontInventory` wrote. */
export const storedFontInventory: Decoder<FontInventory> = object({
  items: list(object({ family: string(), style: string(), postScriptName: string(), technology: optional(string()) })),
  truncated: boolean(),
  completeness: literal("complete", "partial", "failed"),
  totalReported: number(),
  familiesReported: number(),
  fingerprint: string(),
  hostFingerprint: optional(string()),
});

function normalizeFontName(value: string | undefined): string {
  const flattened = (value ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return flattened.length > MAX_FONT_NAME_CHARS ? flattened.slice(0, MAX_FONT_NAME_CHARS) : flattened;
}

function foldedOrder(left: string, right: string): number {
  return compareText(left.toLowerCase(), right.toLowerCase()) || compareText(left, right);
}

/** Orders by family, style, then PostScript name, case-insensitively with the raw strings as tie-break: not localeCompare, because the probe's ExtendScript sorts with <. */
export function compareFontRecords(a: FontRecord, b: FontRecord): number {
  return foldedOrder(a.family, b.family) || foldedOrder(a.style, b.style) || foldedOrder(a.postScriptName, b.postScriptName);
}

function normalizeFontRecords(records: readonly FontEntryFields[]): FontRecord[] {
  return records.flatMap((record) => {
    const postScriptName = normalizeFontName(record.postScriptName);
    const technology = normalizeFontName(record.technology);
    return postScriptName ? [{ family: normalizeFontName(record.family), style: normalizeFontName(record.style), postScriptName, ...(technology ? { technology } : {}) }] : [];
  });
}

function dedupeByPostScriptName(records: readonly FontRecord[]): FontRecord[] {
  const seen = new Set<string>();
  return records.filter((record) => {
    if (seen.has(record.postScriptName)) return false;
    seen.add(record.postScriptName);
    return true;
  });
}

function fingerprintOf(inventory: Omit<FontInventory, "fingerprint">): string {
  const { items, truncated, completeness, totalReported, familiesReported } = inventory;
  return sha256Hex(stableJson([items.map((record) => [record.family, record.style, record.postScriptName]), truncated, completeness, totalReported, familiesReported]));
}

/** The census: names normalised, unaddressable records dropped, de-duplicated by PostScript name (the first after sorting wins), sorted, then capped. */
export function makeFontInventory(records: readonly FontEntryFields[], facts: FontReadFacts = {}): FontInventory {
  const unique = dedupeByPostScriptName(normalizeFontRecords(records).sort(compareFontRecords));
  const items = unique.slice(0, MAX_FONT_RECORDS);
  const totalReported = Math.max(0, Math.trunc(facts.totalReported ?? unique.length));
  const truncated = facts.truncated === true || unique.length > items.length || totalReported > items.length;
  const familiesReported = Math.max(0, Math.trunc(facts.familiesReported ?? new Set(items.map((record) => record.family).filter(Boolean)).size));
  const completeness = facts.completeness ?? (truncated ? "partial" : "complete");
  const counted = { items, truncated, completeness, totalReported, familiesReported };
  return { ...counted, fingerprint: fingerprintOf(counted) };
}

/** A profile with no font census at all: empty on purpose, and never a made-up default. */
export function emptyFontInventory(): FontInventory {
  return makeFontInventory([], { completeness: "failed" });
}

/** Whether this census may be read as "the host does not have that font". A list that a census is about to replace is not. */
export function fontsAreAuthoritative(inventory: Pick<FontInventory, "completeness" | "truncated" | "loading">): boolean {
  return inventory.completeness === "complete" && !inventory.truncated && inventory.loading !== true;
}

/** The same list marked as awaiting a census (or, with `loading` false, no longer awaiting one). */
export function withFontsLoading(inventory: FontInventory, loading: boolean): FontInventory {
  const { items, truncated, completeness, totalReported, familiesReported, fingerprint, hostFingerprint } = inventory;
  const held: FontInventory = { items, truncated, completeness, totalReported, familiesReported, fingerprint, ...(hostFingerprint ? { hostFingerprint } : {}) };
  return loading ? { ...held, loading: true } : held;
}

function nameValues(record: FontRecord): string[] {
  return [record.family, record.style, record.postScriptName];
}

function fontsMatching(items: FontRecord[], tokens: readonly string[]): FontRecord[] {
  const [single] = tokens;
  if (tokens.length === 0) return items;
  if (tokens.length === 1 && single !== undefined) return items.filter((record) => nameValues(record).some((value) => value.toLowerCase().includes(single)));
  return rankTokenMatches(items.map((record) => ({ item: record, identity: nameValues(record), fields: nameValues(record) })), tokens);
}

/** Bounded, deterministic search over the inventory's order: a typeface is named by a family and a style, so both are matched per token. */
export function searchFonts(inventory: Pick<FontInventory, "items">, query: string, limit = DEFAULT_FONT_RESULTS, offset = 0): FontSearch {
  const matching = fontsMatching(inventory.items, queryTokens(query));
  const size = Math.max(0, Math.min(MAX_FONT_RESULTS, Math.trunc(limit) || 0));
  const start = Math.max(0, Math.trunc(offset) || 0);
  const items = matching.slice(start, start + size);
  return { items, total: matching.length, returned: items.length, truncated: start + items.length < matching.length };
}

function familyWords(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function wordsRelated(word: string, other: string): boolean {
  return word === other || (Math.min(word.length, other.length) >= 3 && (word.includes(other) || other.includes(word)));
}

function familyScore(family: string, wanted: string, words: readonly string[]): number {
  const name = family.toLowerCase();
  const have = familyWords(family);
  const shared = words.filter((word) => have.some((other) => wordsRelated(word, other))).length;
  return (name.includes(wanted) || wanted.includes(name) ? words.length + 1 : 0) + shared;
}

/** Installed families closest to a query that matched nothing: whole-name containment either way, then shared words (a word counts when one contains the other, three letters or more). Best first, then alphabetical. */
export function nearestFontFamilies(inventory: Pick<FontInventory, "items">, query: string, limit = NEAREST_FONT_FAMILIES): string[] {
  const wanted = query.trim().toLowerCase();
  if (!wanted) return [];
  const words = familyWords(query);
  const families = [...new Set(inventory.items.map((record) => record.family).filter(Boolean))];
  const scored = families.map((family) => ({ family, score: familyScore(family, wanted, words) })).filter((row) => row.score > 0);
  scored.sort((a, b) => b.score - a.score || compareText(a.family, b.family));
  return scored.slice(0, Math.max(0, limit)).map((row) => row.family);
}

/** The font inventory a census result carries: an absent or unreadable list is `failed` with zero records, never a host whose fonts are only the ones we know. */
export function fontInventoryFromCensus(census: FontCensusFields | undefined): FontInventory {
  const records = census?.installedFonts;
  if (!records) return emptyFontInventory();
  const inventory = makeFontInventory(records, {
    completeness: census.fontCompleteness ?? "failed",
    totalReported: census.fontTotalReported ?? records.length,
    ...(census.fontFamiliesReported === undefined ? {} : { familiesReported: census.fontFamiliesReported }),
  });
  return census.fontFingerprint ? { ...inventory, hostFingerprint: census.fontFingerprint } : inventory;
}
