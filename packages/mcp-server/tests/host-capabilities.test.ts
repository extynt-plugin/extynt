// Proves that the host profile tools search, page, filter and describe the installed effects, fonts and controls without a project snapshot and with stable cursors.
import test from "node:test";
import assert from "node:assert/strict";
import { type HostCapabilityProfile, makeInventory, makeHostProfile, BASE_CATALOGUE, makeFontInventory, makePresetInventory } from "@extynt/capability-catalogue";
import { representativeSnapshot } from "@extynt/project-graph";
import { callTool } from "../src/index.js";
import type { ToolContext } from "../src/index.js";
import { arrayAt, booleanAt, numberAt, objectAt, objectsIn, stringAt, stringsIn } from "../src/json.js";
import type { JsonObject, JsonValue } from "@extynt/decode";
import { refusalOf } from "./support/json-results.js";
import { successArray, successObject } from "./support/proposal-views.js";

const HOST = { application: "After Effects" as const, version: "26.2.1", buildNumber: "2", platform: "macOS", architecture: "arm64" };

function profileWithEntries(count = 137): HostCapabilityProfile {
  const host = { application: "After Effects" as const, version: "25.0", buildNumber: "1", platform: "test", architecture: "x64" };
  const inventory = makeInventory(host, Array.from({ length: count }, (_, index) => ({ matchName: `Vendor Effect ${String(index).padStart(3, "0")}`, displayName: `Vendor Effect ${index}`, category: index % 2 ? "color" : "blur", version: "1.0", available: index % 3 !== 0, evidence: [] })));
  const profile = makeHostProfile(inventory);
  return { ...profile, entries: inventory.items.map((item, index) => ({ id: `host:${item.matchName}`, kind: "effect" as const, matchName: item.matchName, displayName: item.displayName, description: `Test entry ${index}`, ...(item.version === undefined ? {} : { version: item.version }), ...(item.category === undefined ? {} : { category: item.category }), provider: "Test", availability: item.available ? "available" as const : "unavailable" as const, ...(index === 0 ? { controls: Array.from({ length: 60 }, (_, control) => ({ path: `P/${control}`, matchName: `P${control}`, displayName: `Control ${control}`, valueType: "number" })) } : {}), operationStatus: item.available ? "probeNeeded" as const : "unknown" as const, evidence: index % 2 ? ["installed" as const] : ["curated" as const, "installed" as const], provenance: "test", probeState: item.available ? "probeNeeded" as const : "manual-unavailable" as const })) };
}

function withoutControls(entry: HostCapabilityProfile["entries"][number]): HostCapabilityProfile["entries"][number] {
  const { controls: _dropped, ...rest } = entry;
  return rest;
}

const emptyProfile = (): HostCapabilityProfile => makeHostProfile(makeInventory(HOST, []));
const searchHost = (args: JsonObject, context: ToolContext): JsonObject => successObject(callTool("ae_search_host_capabilities", args, context));
const searchOperations = (query: string): JsonObject => successObject(callTool("ae_search_native_operations", { query }, {}));
const entriesOf = (data: JsonObject): ReadonlyArray<JsonObject> => objectsIn(arrayAt(data, "entries"));
const idsOf = (data: JsonObject): ReadonlyArray<string> => entriesOf(data).map((entry) => stringAt(entry, "id") ?? "");

function pagedIds(profile: HostCapabilityProfile): ReadonlyArray<string> {
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const page = searchHost({ query: "Vendor Effect", limit: 17, ...(cursor ? { cursor } : {}) }, { hostProfile: profile });
    ids.push(...idsOf(page));
    cursor = stringAt(page, "nextCursor");
  } while (cursor);
  return ids;
}

test("host profile search rows explain why an effect cannot be applied unattended", () => {
  const context = { hostProfile: emptyProfile() };
  const bare = searchHost({ query: "Gaussian Blur", limit: 1 }, context);
  assert.deepEqual(stringsIn(arrayAt(entriesOf(bare)[0], "requirements")), []);
  const row = entriesOf(searchHost({ query: "Dropdown", limit: 5 }, context)).find((entry) => stringAt(entry, "id") === "adobe.dropdown-menu-control");
  assert.ok(row, "the curated caveat entry should be searchable");
  assert.equal(stringAt(row, "operationStatus"), "unsupported");
  assert.match(stringsIn(arrayAt(row, "requirements")).join(" "), /Pseudo\/@@/, "the row must carry the reason it is unsupported");
});

test("the host capability searcher matches words, not the whole sentence, and pages by cursor", () => {
  const context = { hostProfile: emptyProfile() };
  assert.deepEqual(idsOf(searchHost({ query: "ramp gradient" }, context)), ["adobe.gradient-ramp"]);
  for (const query of ["ramp quasar", "quasar nebula"]) assert.deepEqual(entriesOf(searchHost({ query }, context)), [], `${query} matches nothing`);
  const single = searchHost({ query: "ramp", limit: 1 }, context);
  assert.deepEqual(idsOf(single), ["adobe.gradient-ramp"]);
  assert.ok(stringAt(single, "nextCursor"), "the other word-match is still reachable by cursor");
});

test("the native operation searcher ranks by words and one unmatched word does not remove a row", () => {
  const entries = entriesOf(searchOperations("animate property keyframes"));
  assert.equal(stringAt(entries[0], "planType"), "animate_property", "the plan type the words name is ranked first");
  assert.ok(entries.every((entry) => (stringAt(entry, "summary") ?? "").length <= 100 && Object.keys(entry).every((key) => ["planType", "id", "summary"].includes(key))));
  assert.equal(stringAt(entriesOf(searchOperations("animate_property quasar"))[0], "planType"), "animate_property", "one unmatched word no longer removes the row");
  assert.deepEqual(entriesOf(searchOperations("quasar nebula")), [], "words that match nothing return nothing");
});

test("the curated catalogue search matches words too, and keeps its single-word answers", () => {
  const context = { snapshot: representativeSnapshot, catalogue: BASE_CATALOGUE };
  const ramp = successArray(callTool("ae_search_capabilities", { query: "ramp gradient" }, context));
  assert.deepEqual(ramp.map((capability) => stringAt(capability, "id")), ["adobe.gradient-ramp"]);
  assert.deepEqual(successArray(callTool("ae_search_capabilities", { query: "ramp quasar" }, context)), [], "every token must match, never one of them");
  const blur = successArray(callTool("ae_search_capabilities", { query: "blur", limit: 1 }, context));
  assert.equal(stringAt(blur[0], "matchName"), "ADBE Gaussian Blur 2", "a single word keeps the ranking it had");
});

const substituteFamilies = (answer: JsonObject): string[] => objectsIn(arrayAt(answer, "substitutes")).map((offer) => stringAt(offer, "family") ?? "");

test("the font search matches words, names the nearest families, and adds nothing to a search that found something", () => {
  const fonts = makeFontInventory([{ family: "Helvetica", style: "Bold", postScriptName: "Helvetica-Bold" }, { family: "Inter", style: "Bold", postScriptName: "Inter-Bold" }]);
  const context = { hostProfile: makeHostProfile(makeInventory(HOST, []), undefined, makePresetInventory([]), fonts) };
  const searchFonts = (query: string): JsonObject => successObject(callTool("ae_search_fonts", { query }, context));
  const searched = searchFonts("Helvetica Bold");
  assert.deepEqual(entriesOf(searched).map((entry) => stringAt(entry, "postScriptName")), ["Helvetica-Bold"]);
  assert.equal(numberAt(searched, "total"), 1);
  assert.equal("nearestFamilies" in searched, false, "a search that found something adds nothing");
  const missing = searchFonts("Helvetica Papyrus");
  assert.deepEqual(entriesOf(missing), []);
  assert.deepEqual(stringsIn(arrayAt(missing, "nearestFamilies")), ["Helvetica"]);
  assert.match(stringAt(missing, "next") ?? "", /Only these installed families may be offered to the user as the substitute, best first: Helvetica/);
  assert.match(stringAt(missing, "next") ?? "", /empty query lists every installed style/);
  assert.deepEqual(substituteFamilies(missing), ["Helvetica", "Inter"], "the near name first, then the installed sans that fits the look");
  const nothingClose = searchFonts("Papyrus");
  assert.deepEqual(stringsIn(arrayAt(nothingClose, "nearestFamilies")), []);
  assert.deepEqual(substituteFamilies(nothingClose), ["Inter", "Helvetica"], "a miss offers only installed families, never one outside the list");
  assert.match(stringAt(nothingClose, "next") ?? "", /Only these installed families may be offered/);
});

test("host profile tools work without a project snapshot and expose compact summary facts", () => {
  const profile = profileWithEntries();
  const result = callTool("ae_get_host_profile_summary", {}, { hostProfile: profile });
  const data = successObject(result);
  assert.ok(result.ok && result.snapshotFingerprint === null);
  const availability = objectAt(objectAt(data, "counts"), "availability");
  assert.equal(stringAt(data, "profileId"), profile.profileId);
  assert.equal(stringAt(objectAt(data, "effects"), "fingerprint"), profile.shallowFingerprint);
  assert.equal(numberAt(objectAt(data, "presets"), "total"), 0);
  assert.equal((numberAt(availability, "available") ?? 0) + (numberAt(availability, "unavailable") ?? 0), 137);
});

test("host profile search pages each matching entry exactly once with stable opaque cursors", () => {
  const ids = pagedIds(profileWithEntries());
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.length, 137);
});

test("host profile search applies combined filters and clamps its payload page", () => {
  const page = searchHost({ kinds: ["effect"], availability: ["available"], operationStatus: ["probeNeeded"], evidence: ["installed"], limit: 500 }, { hostProfile: profileWithEntries() });
  const entries = entriesOf(page);
  assert.ok(entries.length <= 50);
  assert.ok(entries.every((entry) => stringAt(entry, "availability") === "available" && stringAt(entry, "operationStatus") === "probeNeeded" && stringsIn(arrayAt(entry, "evidence")).includes("installed")));
});

test("host profile rejects stale profile cursors and paginates describe controls", () => {
  const profile = profileWithEntries();
  const firstId = profile.entries[0]?.id ?? "";
  const cursor = stringAt(searchHost({ limit: 1 }, { hostProfile: profile }), "nextCursor");
  assert.ok(cursor);
  assert.equal(refusalOf(callTool("ae_search_host_capabilities", { cursor }, { hostProfile: { ...profile, profileId: "changed" } })).code, "PROFILE_CHANGED");
  const described = successObject(callTool("ae_describe_host_capability", { id: firstId, detail: "controls", limit: 500, profileId: profile.profileId }, { hostProfile: profile }));
  assert.equal(arrayAt(described, "items")?.length, 50);
  assert.ok(stringAt(described, "nextCursor"));
  assert.equal(refusalOf(callTool("ae_describe_host_capability", { id: firstId, profileId: "old" }, { hostProfile: profile })).code, "PROFILE_CHANGED");
});

test("bootstrap and known profile reads stay compact and avoid unchanged payloads", () => {
  const profile = profileWithEntries();
  const data = successObject(callTool("ae_get_bootstrap_context", {}, { hostProfile: profile }));
  assert.equal(stringAt(data, "profileId"), profile.profileId);
  assert.equal(numberAt(objectAt(data, "counts"), "profileEntries"), 137);
  assert.ok((numberAt(data, "responseBudgetBytes") ?? Infinity) <= 2048);
  assert.equal(stringAt(data, "nextRecommendedRead"), "ae_refresh_snapshot");
  const withSnapshot = successObject(callTool("ae_get_bootstrap_context", {}, { hostProfile: profile, snapshot: representativeSnapshot }));
  assert.equal(stringAt(withSnapshot, "nextRecommendedRead"), "ae_get_current_context");
  const unchanged = successObject(callTool("ae_get_host_profile_summary", { knownProfileId: profile.profileId }, { hostProfile: profile }));
  assert.deepEqual(unchanged, { status: "NOT_MODIFIED", profileId: profile.profileId, responseBudgetBytes: 512 });
  const row = entriesOf(searchHost({ limit: 1 }, { hostProfile: profile }))[0];
  assert.ok(row);
  assert.equal("description" in row, false);
  assert.equal("controls" in row, false);
});

test("ae_get_bootstrap_context rejects a non-string knownRevision or knownProfileId instead of answering NOT_MODIFIED", () => {
  const snapshot = representativeSnapshot;
  const wrongTypes: ReadonlyArray<JsonValue> = [true, {}, 1, ["x"]];
  for (const value of wrongTypes) {
    const result = callTool("ae_get_bootstrap_context", { knownRevision: value }, { snapshot });
    assert.equal(refusalOf(result).code, "INVALID_ARGUMENT", `knownRevision ${JSON.stringify(value)} must not be compared as if it were a string`);
  }
  assert.equal(refusalOf(callTool("ae_get_bootstrap_context", { knownProfileId: 1 }, { snapshot })).code, "INVALID_ARGUMENT");
  const unchanged = successObject(callTool("ae_get_bootstrap_context", { knownRevision: `${snapshot.revision}:${snapshot.fingerprint}` }, { snapshot }));
  assert.equal(stringAt(unchanged, "status"), "NOT_MODIFIED");
  const stale = successObject(callTool("ae_get_bootstrap_context", { knownRevision: "ae-revision-1:00000000" }, { snapshot }));
  assert.equal(stringAt(stale, "status"), undefined);
  assert.equal(booleanAt(objectAt(stale, "changedSince"), "project"), true);
});

test("ae_search_host_capabilities rejects filter values outside the profile vocabulary and a wrong-typed limit", () => {
  const profile = profileWithEntries();
  const rejected: ReadonlyArray<readonly [string, JsonObject]> = [
    ["availability", { availability: ["installed"] }],
    ["kinds", { kinds: [7] }],
    ["evidence", { evidence: ["magic"] }],
    ["operationStatus", { operationStatus: ["available"] }],
    ["limit", { limit: ["2"] }],
  ];
  for (const [argument, args] of rejected) {
    const { code, message } = refusalOf(callTool("ae_search_host_capabilities", args, { hostProfile: profile }));
    assert.equal(code, "INVALID_ARGUMENT", `${argument} must be validated: ${JSON.stringify(args)}`);
    assert.match(message, new RegExp(argument));
  }
  const valid = searchHost({ kinds: ["effect"], availability: ["available"], operationStatus: ["probeNeeded"], evidence: ["installed"] }, { hostProfile: profile });
  assert.ok(entriesOf(valid).length > 0);
});

function usageProfile(): HostCapabilityProfile {
  const base = profileWithEntries(12);
  const first = base.entries[0];
  assert.ok(first);
  const reversed = { ...first, id: "host:Zed Reverse", matchName: "Zed Reverse", displayName: "Effect Vendor Zed", description: "reversed words" };
  return { ...base, entries: [...base.entries, reversed] };
}

const USAGE = new Map([["Vendor Effect 007", 5], ["Vendor Effect 003", 2], ["Zed Reverse", 100], ["Not In Profile", 9]]);
const MOST_USED = ["host:Vendor Effect 007", "host:Vendor Effect 003"];

function rankedIds(query: string, profile: HostCapabilityProfile, withUsage: boolean): ReadonlyArray<string> {
  return idsOf(searchHost({ query, limit: 50 }, withUsage ? { hostProfile: profile, effectUsage: () => USAGE } : { hostProfile: profile }));
}

test("the user's own usage orders equally relevant effects and never changes what matches", () => {
  const profile = usageProfile();
  const plain = rankedIds("vendor effect", profile, false);
  const ranked = rankedIds("vendor effect", profile, true);
  assert.deepEqual([...ranked].sort(), [...plain].sort(), "usage never changes which effects match");
  assert.deepEqual(ranked.slice(0, 2), MOST_USED, "the most-used of the equally relevant come first");
  assert.deepEqual(ranked.slice(2, 4), plain.filter((id) => ![...MOST_USED, "host:Zed Reverse"].includes(id)).slice(0, 2), "the rest keep their order");
  assert.equal(ranked.at(-1), "host:Zed Reverse", "a far less relevant row stays behind however often it is used");
  const single = rankedIds("vendor", profile, true);
  assert.deepEqual(single.slice(0, 3), ["host:Zed Reverse", ...MOST_USED], "one word: every match ties, so usage orders them");
  assert.equal(single.length, rankedIds("vendor", profile, false).length);
});

test("a row carries a compact count of the user's own use only when there is one", () => {
  const profile = usageProfile();
  const firstRow = (query: string, withUsage: boolean): JsonObject => {
    const row = entriesOf(searchHost({ query }, withUsage ? { hostProfile: profile, effectUsage: () => USAGE } : { hostProfile: profile }))[0];
    assert.ok(row, `${query} matches`);
    return row;
  };
  assert.equal(numberAt(firstRow("Vendor Effect 007", true), "used"), 5, "a row carries a compact count of the user's own use");
  assert.equal("used" in firstRow("Vendor Effect 001", true), false, "an effect the user never used carries no count");
  assert.equal("used" in firstRow("Vendor Effect 007", false), false, "without usage the rows are exactly what they were");
});

test("describe lists controls observed in the snapshot for an effect the profile has no schema for", () => {
  const base = makeHostProfile(makeInventory(HOST, [{ matchName: "ADBE Gaussian Blur 2", displayName: "Gaussian Blur", available: true, evidence: [] }]));
  const hostProfile: HostCapabilityProfile = { ...base, entries: base.entries.map((entry) => entry.matchName === "ADBE Gaussian Blur 2" ? withoutControls(entry) : entry) };
  const entry = hostProfile.entries.find((candidate) => candidate.matchName === "ADBE Gaussian Blur 2");
  assert.ok(entry);
  const bare = successObject(callTool("ae_describe_host_capability", { id: entry.id, detail: "controls" }, { hostProfile }));
  assert.deepEqual(arrayAt(bare, "items"), [], "no snapshot, nothing observed");
  const seen = successObject(callTool("ae_describe_host_capability", { id: entry.id, detail: "controls" }, { hostProfile, snapshot: representativeSnapshot }));
  const items = objectsIn(arrayAt(seen, "items"));
  assert.ok(items.length > 0, "the blur on the representative layer is observed");
  assert.ok(items.every((item) => stringAt(item, "source") === "observed" && (stringAt(item, "path") ?? "").startsWith("ADBE Effect Parade/ADBE Gaussian Blur 2/")));
  assert.match(stringAt(seen, "controlSource") ?? "", /observed/);
});
