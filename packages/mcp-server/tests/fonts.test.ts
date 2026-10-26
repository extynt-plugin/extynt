// Tests that ae_search_fonts answers from the host font census, paged and bounded, and says so when the census is missing, partial or still loading.
import test from "node:test";
import assert from "node:assert/strict";
import { array, boolean, decodeOrThrow, nullable, number, object, optional, string } from "@extynt/decode";
import type { Infer, JsonObject } from "@extynt/decode";
import { callTool, listTools } from "../src/index.js";
import { payloadOf, refusalOf } from "./support/json-results.js";
import { MAX_FONT_RESULTS, emptyFontInventory, makeFontInventory, makeHostProfile, makeInventory, makePresetInventory, withFontsLoading } from "@extynt/capability-catalogue";

const host = { application: "After Effects" as const, version: "26.2.1", buildNumber: "2", platform: "macOS", architecture: "arm64" };
const fontEntry = object({ family: string(), style: string(), postScriptName: string() });
const fontCounts = object({ families: number(), styles: number(), returned: number(), completeness: string(), truncated: boolean(), authoritative: boolean(), loading: boolean(), searchTool: string() });
const searchView = object({
  profileId: optional(string()), entries: array(fontEntry), total: number(), returned: optional(number()), nextCursor: optional(nullable(string())), note: optional(string()), fontsLoading: optional(boolean()),
  fonts: object({ authoritative: boolean(), loading: optional(boolean()), completeness: optional(string()), truncated: optional(boolean()), styles: optional(number()), families: optional(number()) }),
});
type SearchView = Infer<typeof searchView>;
const summaryView = object({ fonts: fontCounts });

function searched(query: JsonObject, profile: ReturnType<typeof profileWith>): SearchView {
  return decodeOrThrow(searchView, payloadOf(callTool("ae_search_fonts", query, { hostProfile: profile })));
}

const record = (family: string, style: string, postScriptName = `${family}-${style}`.replace(/\s+/g, "")) => ({ family, style, postScriptName });
const profileWith = (fonts: ReturnType<typeof makeFontInventory>) => makeHostProfile(makeInventory(host, []), undefined, makePresetInventory([]), fonts);
const fontsOf = (...records: Array<{ family: string; style: string; postScriptName: string }>) => makeFontInventory(records, { familiesReported: new Set(records.map((entry) => entry.family)).size });

function assertFontSearchDefinitionIsBounded(): void {
  const definition = listTools("agent").find((tool) => tool.name === "ae_search_fonts");
  assert.ok(definition, "the font search must be advertised to the agent");
  assert.equal(definition?.annotations.readOnlyHint, true);
  assert.equal(definition?.inputSchema.additionalProperties, false);
  assert.deepEqual(definition?.inputSchema.properties?.limit, { type: "number", minimum: 1, maximum: MAX_FONT_RESULTS });
}

function assertFontSearchNarrows(): void {
  const profile = profileWith(fontsOf(record("Helvetica", "Bold"), record("Helvetica Neue", "Light"), record("Inter", "Black", "Inter-Black")));
  const result = callTool("ae_search_fonts", { query: "helv" }, { hostProfile: profile });
  assert.equal(result.ok && result.snapshotFingerprint, null, "fonts are host facts, not project facts");
  const data = decodeOrThrow(searchView, payloadOf(result));
  assert.equal(data.profileId, profile.profileId);
  assert.deepEqual(data.entries.map((entry) => entry.postScriptName), ["Helvetica-Bold", "HelveticaNeue-Light"]);
  assert.equal(data.total, 2);
  assert.equal(data.returned, 2);
  assert.equal(data.nextCursor, null);
}

function manyFontProfile(): ReturnType<typeof profileWith> {
  return profileWith(makeFontInventory(Array.from({ length: 120 }, (_, index) => record(`Fam ${String(index).padStart(3, "0")}`, "Regular")), { familiesReported: 120 }));
}

function assertFontPageIsClamped(many: ReturnType<typeof profileWith>): void {
  assert.equal(searched({ limit: 500 }, many).entries.length, MAX_FONT_RESULTS);
}

function assertFontPagingIsStable(many: ReturnType<typeof profileWith>): void {
  const seen = new Set<string>();
  let cursor: string | null | undefined = null;
  do {
    const page: SearchView = searched({ limit: 7, ...(cursor ? { cursor } : {}) }, many);
    for (const entry of page.entries) {
      assert.equal(seen.has(entry.postScriptName), false, `${entry.postScriptName} was returned twice`);
      seen.add(entry.postScriptName);
    }
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(seen.size, 120);
}

function assertForeignCursorIsRefused(many: ReturnType<typeof profileWith>): void {
  const foreign = callTool("ae_search_fonts", { cursor: Buffer.from(JSON.stringify({ profileId: "another", offset: 0 })).toString("base64url") }, { hostProfile: many });
  assert.equal(refusalOf(foreign).code, "PROFILE_CHANGED");
}

test("ae_search_fonts answers with the host's installed fonts, bounded and paged", () => {
  assertFontSearchDefinitionIsBounded();
  assertFontSearchNarrows();
  const many = manyFontProfile();
  assertFontPageIsClamped(many);
  assertFontPagingIsStable(many);
  assertForeignCursorIsRefused(many);
});

function assertMissingCensusAnswersHonestly(): void {
  const data = searched({ query: "Helvetica" }, profileWith(emptyFontInventory()));
  assert.deepEqual(data.entries, []);
  assert.equal(data.total, 0);
  assert.equal(data.fonts.authoritative, false);
  assert.equal(data.fonts.completeness, "failed");
  assert.match(String(data.note), /no installed-font census|nothing was enumerated/i, "an empty answer must say why it is empty");
  assert.equal(JSON.stringify(data).includes("Helvetica-Bold"), false, "an unenumerated host must never be answered with a font");
  assert.equal(JSON.stringify(data).includes("Arial"), false);
}

function assertTruncatedCensusIsPartial(): void {
  const partial = makeFontInventory(Array.from({ length: 40 }, (_, index) => record(`Fam ${String(index).padStart(3, "0")}`, "Regular")), { truncated: true, totalReported: 3000, familiesReported: 574 });
  const body = searched({ query: "Zapfino" }, profileWith(partial));
  assert.deepEqual(body.entries, []);
  assert.equal(body.fonts.truncated, true);
  assert.equal(body.fonts.styles, 3000);
  assert.equal(body.fonts.families, 574);
  assert.equal(body.fonts.authoritative, false);
  assert.match(String(body.note), /partial/i);
}

test("a host with no font census answers honestly instead of offering a default", () => {
  assertMissingCensusAnswersHonestly();
  assertTruncatedCensusIsPartial();
});

test("the profile summary reports font counts and never the list itself", () => {
  const profile = profileWith(fontsOf(record("Helvetica", "Bold"), record("Inter", "Black", "Inter-Black")));
  for (const tool of ["ae_get_host_profile_summary", "ae_get_host_profile_status"]) {
    const data = decodeOrThrow(summaryView, payloadOf(callTool(tool, {}, { hostProfile: profile })));
    assert.deepEqual(data.fonts, { families: 2, styles: 2, returned: 2, completeness: "complete", truncated: false, authoritative: true, loading: false, searchTool: "ae_search_fonts" });
    assert.equal(JSON.stringify(data.fonts).includes("Helvetica"), false, "the summary carries counts; the names come from ae_search_fonts");
  }
});

test("while the fonts are still being read, a search says they are loading instead of answering with nothing", () => {
  const loading = profileWith(withFontsLoading(emptyFontInventory(), true));
  const data = searched({ query: "Helvetica" }, loading);
  assert.equal(data.fontsLoading, true);
  assert.deepEqual(data.entries, []);
  assert.match(String(data.note), /still loading/i);
  assert.equal(data.fonts.loading, true);
  assert.equal(data.fonts.authoritative, false, "an unread list never says a font is absent");
  for (const tool of ["ae_get_host_profile_summary", "ae_get_host_profile_status"]) {
    assert.equal(decodeOrThrow(summaryView, payloadOf(callTool(tool, {}, { hostProfile: loading }))).fonts.loading, true);
  }
});

test("a list held from the last run is searched while it is read again, and says so", () => {
  const held = withFontsLoading(fontsOf(record("Helvetica", "Bold"), record("Inter", "Black", "Inter-Black")), true);
  const data = searched({ query: "inter" }, profileWith(held));
  assert.deepEqual(data.entries.map((entry) => entry.postScriptName), ["Inter-Black"]);
  assert.equal(data.fontsLoading, undefined);
  assert.match(String(data.note), /read again/i);
  assert.equal(data.fonts.authoritative, false, "a font missing from a list being refreshed is not proof it is absent");
});

test("search limits that are not whole numbers are refused,", () => {
  const profile = profileWith(makeFontInventory([record("Fam", "Regular")], { familiesReported: 1 }));
  for (const name of ["ae_search_fonts", "ae_search_host_capabilities"]) {
    const refusal = refusalOf(callTool(name, { limit: 2.5 }, { hostProfile: profile }));
    assert.equal(refusal.code, "INVALID_ARGUMENT");
    assert.equal(refusal.message, "limit must be an integer from 1 through 50.");
  }
});

test("a partial or loading font census never says a font is missing", () => {
  const partial = makeFontInventory([record("Arial", "Regular")], { completeness: "partial", truncated: true, familiesReported: 1 });
  const missing = searched({ query: "visby" }, profileWith(partial));
  assert.equal(missing.total, 0);
  assert.equal(missing.note === undefined, false, "the partial census is said to be partial");
  const text = payloadOf(callTool("ae_search_fonts", { query: "visby" }, { hostProfile: profileWith(partial) }));
  assert.doesNotMatch(JSON.stringify(text), /No installed font matches|none is close|Only these installed families/);
  assert.match(JSON.stringify(text), /not proof the font is not installed/);
  const loading = profileWith(withFontsLoading(fontsOf(record("Arial", "Regular")), true));
  assert.doesNotMatch(JSON.stringify(payloadOf(callTool("ae_search_fonts", { query: "visby" }, { hostProfile: loading }))), /No installed font matches/);
});

const substitutesView = object({ substitutes: optional(array(object({ family: string() }))) });

test("a missing serif is answered with the installed serifs before any sans", () => {
  const profile = profileWith(fontsOf(record("Arial", "Regular"), record("Calibri", "Regular"), record("Georgia", "Regular"), record("Times New Roman", "Regular"), record("Bodoni 72", "Regular")));
  const answer = decodeOrThrow(substitutesView, payloadOf(callTool("ae_search_fonts", { query: "Didot" }, { hostProfile: profile })));
  assert.deepEqual(answer.substitutes?.map((offer) => offer.family), ["Bodoni 72", "Times New Roman", "Georgia"], "the didone and the serifs are offered, and the sans are not");
});
