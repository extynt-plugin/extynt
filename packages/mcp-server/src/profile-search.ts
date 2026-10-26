// The searches over the host capability profile: capabilities by name and filter, and installed fonts.
import { DEFAULT_FONT_RESULTS, MAX_FONT_RESULTS, emptyFontInventory, fontsAreAuthoritative, nearestFontFamilies, queryTokens, rankTokenMatches, searchFonts } from "@extynt/capability-catalogue";
import { faceFor, styleAskedIn, substituteFamilies } from "@extynt/decide";
import type { FontInventory, HostCapabilityProfile, HostProfileEntry } from "@extynt/capability-catalogue";
import type { Infer } from "@extynt/decode";
import type { ToolContext } from "./contracts.js";
import { pageByBudget } from "./inspection.js";
import { boundedAt, jsonOf } from "./json.js";
import { encodeCursor, fontSummary, projectHostRow } from "./profile-view.js";
import { hostSuccess, toolError } from "./tool-result.js";
import type { ToolResult } from "./tool-result.js";
import { AE_SEARCH_FONTS, AE_SEARCH_HOST_CAPABILITIES } from "./tool-specs-host.js";

/** What a profile tool answer is given: the tool, its arguments, the profile, and where the page starts. */
export interface PagedCall<A> {
  readonly name: string;
  readonly args: A;
  readonly profile: HostCapabilityProfile;
  readonly context: ToolContext;
  readonly offset: number;
}

const SEARCH_BUDGET_BYTES = 12_000;
const SEARCH_ANSWER_MARGIN_BYTES = 512;
const SEARCH_LIMITS = { fallback: 25, min: 1, max: 50 };
const FONT_LIMITS = { fallback: DEFAULT_FONT_RESULTS, min: 1, max: MAX_FONT_RESULTS };

type SearchArgs = Infer<typeof AE_SEARCH_HOST_CAPABILITIES.input.decoder>;

type FontArgs = Infer<typeof AE_SEARCH_FONTS.input.decoder>;

type Filters = Readonly<Record<"kinds" | "availability" | "operationStatus" | "evidence", ReadonlySet<string> | null>>;

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function filtersOf(args: SearchArgs): Filters {
  const setOf = (values: ReadonlyArray<string> | undefined): ReadonlySet<string> | null => (values ? new Set(values) : null);
  return { kinds: setOf(args.kinds), availability: setOf(args.availability), operationStatus: setOf(args.operationStatus), evidence: setOf(args.evidence) };
}

const allows = (accepted: ReadonlySet<string> | null, value: string): boolean => accepted === null || accepted.has(value);

function passes(entry: HostProfileEntry, filters: Filters): boolean {
  const { evidence } = filters;
  return allows(filters.kinds, entry.kind) && allows(filters.availability, entry.availability) && allows(filters.operationStatus, entry.operationStatus) && (evidence === null || entry.evidence.some((value) => evidence.has(value)));
}

function containsNeedle(entry: HostProfileEntry, needle: string): boolean {
  return !needle || [entry.id, entry.matchName, entry.displayName, entry.description].some((value) => value?.toLowerCase().includes(needle));
}

function matchedEntries(profile: HostCapabilityProfile, query: string, usage: ReadonlyMap<string, number>): HostProfileEntry[] {
  const tokens = queryTokens(query);
  const used = (entry: HostProfileEntry): number => (entry.kind === "effect" && entry.matchName ? usage.get(entry.matchName) ?? 0 : 0);
  const compareRows = (left: HostProfileEntry, right: HostProfileEntry): number =>
    used(right) - used(left) || compareText(left.matchName ?? "", right.matchName ?? "") || compareText(left.id, right.id);
  if (tokens.length > 1) {
    const rows = profile.entries.map((entry) => ({ item: entry, identity: [entry.id, entry.matchName, entry.displayName], fields: [entry.id, entry.matchName, entry.displayName, entry.description] }));
    return rankTokenMatches(rows, tokens, compareRows);
  }
  return profile.entries.filter((entry) => containsNeedle(entry, tokens[0] ?? "")).sort(compareRows);
}

function limitRefusal(limit: number | undefined): ToolResult | null {
  return limit === undefined || Number.isInteger(limit) ? null : toolError("INVALID_ARGUMENT", "limit must be an integer from 1 through 50.");
}

/** Searches the profile's capabilities by name, filtered by kind, availability, operation status and evidence, one page at a time. */
export function hostCapabilitySearch({ name, args, profile, context, offset }: PagedCall<SearchArgs>): ToolResult {
  const refusal = limitRefusal(args.limit);
  if (refusal) return refusal;
  const limit = boundedAt(args, "limit", SEARCH_LIMITS);
  const query = args.query ?? "";
  const usage = context.effectUsage?.() ?? new Map<string, number>();
  const filters = filtersOf(args);
  const rows = matchedEntries(profile, query, usage).filter((entry) => passes(entry, filters));
  const window = rows.slice(offset, offset + limit).map((entry) => projectHostRow(entry, usage));
  const page = pageByBudget(window, limit, SEARCH_BUDGET_BYTES - SEARCH_ANSWER_MARGIN_BYTES).items;
  const nextCursor = offset + page.length < rows.length ? encodeCursor(profile.profileId, offset + page.length) : null;
  const clipped = page.length < window.length ? { truncated: true, next: `${window.length - page.length} more matched in this page window but did not fit the ${SEARCH_BUDGET_BYTES}-byte answer budget; the cursor resumes at the first of them.` } : {};
  return hostSuccess(name, jsonOf({ profileId: profile.profileId, entries: page, nextCursor, ...clipped, responseBudgetBytes: SEARCH_BUDGET_BYTES }), nextCursor !== null);
}

function fontCensusNote(inventory: FontInventory): { note?: string } {
  const listed = inventory.items.length > 0;
  if (inventory.loading) return { note: listed ? "The installed fonts are being read again; this list is from the last read and a font missing from it is not proof it is not installed." : "The installed fonts are still loading, so this list is empty because they have not been read yet, not because the host has none. Ask again in a few seconds." };
  if (fontsAreAuthoritative(inventory)) return {};
  return { note: listed ? "The font census for this host is partial, so a font missing from these results is not proof it is not installed." : "No installed-font census has been recorded for this host; this list is empty because nothing was enumerated, not because the host has no fonts." };
}

const SUBSTITUTE_OFFER_LIMIT = 4;

function substituteOffers(inventory: FontInventory, query: string, nearest: ReadonlyArray<string>): Array<Record<string, string>> {
  const ask = styleAskedIn(query);
  const families = [...new Set([...nearest, ...substituteFamilies(query, inventory.items)])].slice(0, SUBSTITUTE_OFFER_LIMIT);
  return families.flatMap((family) => {
    const face = faceFor(inventory.items, family, ask);
    return face ? [{ family, postScriptName: face.record.postScriptName, style: face.record.style, realStyle: face.exact ? "yes" : "no" }] : [];
  });
}

function noFontMatch(inventory: FontInventory, query: string, context: ToolContext): { nearestFamilies: string[]; substitutes?: Array<Record<string, string>>; next: string } {
  const nearestFamilies = nearestFontFamilies(inventory, query);
  const listing = "ae_search_fonts with an empty query lists every installed style (page with cursor).";
  if (!fontsAreAuthoritative(inventory)) {
    return { nearestFamilies, next: `Nothing in the font list read so far matches "${query}". The list is not complete, so this is not proof the font is not installed; do not tell the user it is missing. ${listing}` };
  }
  const substitutes = substituteOffers(inventory, query, nearestFamilies);
  if (substitutes.length === 0) return { nearestFamilies, substitutes, next: `No installed font matches "${query}" and none is close. ${listing}` };
  const names = substitutes.map((offer) => offer.family).join(", ");
  context.noteFontSubstitution?.({ requested: query.trim(), offered: substitutes.map((offer) => offer.family ?? "") });
  const next = `No installed font matches "${query}". Only these installed families may be offered to the user as the substitute, best first: ${names}. Use the best one for the look asked, keep bold and italic as the real style it has (postScriptName), and say which one you used. ${listing}`;
  return { nearestFamilies, substitutes, next };
}

/** Searches the installed fonts by name, one page at a time. */
export function hostFontSearch({ name, args, profile, context, offset }: PagedCall<FontArgs>): ToolResult {
  const refusal = limitRefusal(args.limit);
  if (refusal) return refusal;
  const limit = boundedAt(args, "limit", FONT_LIMITS);
  const query = args.query ?? "";
  const inventory = profile.fontInventory ?? emptyFontInventory();
  const common = { profileId: profile.profileId, query, fonts: fontSummary(inventory), ...fontCensusNote(inventory) };
  if (inventory.loading && inventory.items.length === 0) return hostSuccess(name, jsonOf({ ...common, entries: [], total: 0, returned: 0, nextCursor: null, fontsLoading: true, responseBudgetBytes: 1024 }), false);
  const found = searchFonts(inventory, query, limit, offset);
  const nextCursor = offset + found.returned < found.total ? encodeCursor(profile.profileId, offset + found.returned) : null;
  const unmatched = found.total === 0 ? noFontMatch(inventory, query, context) : {};
  return hostSuccess(name, jsonOf({ ...common, entries: found.items, total: found.total, returned: found.returned, nextCursor, ...unmatched, responseBudgetBytes: 8192 }), nextCursor !== null);
}
