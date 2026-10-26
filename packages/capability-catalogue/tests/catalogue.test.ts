// Tests the curated catalogue, inventory, host profile, search and evidence merging.
import test from "node:test";
import assert from "node:assert/strict";
import { BASE_CATALOGUE, ledgerKeyApplies, planTypeVerification, applyEffectControlEvidence, controlsFromProbeRows, effectControlValueError, diffInventory, inventoryFingerprint, makeHostProfile, makeInventory, makePresetInventory, observeSnapshotEffects, resolveCapability, resolveControl, searchCapabilities, searchHostProfile, type HostVerificationLedger, type LedgerHostEntry, type LedgerPlanTypeResult } from "../src/index.js";
import { representativeSnapshot } from "@extynt/project-graph";
import { loadFixtureEffectEvidence } from "./effect-evidence-fixture.js";
import { present } from "./present.js";

const UNRECORDED_KIT = { extyntVersion: "unrecorded", packDigest: "" };
const host = { application: "After Effects" as const, version: "26.2.1x2", buildNumber: "2", platform: "macOS", architecture: "arm64" };
const item = (matchName: string, displayName = matchName) => ({ matchName, displayName, available: true, evidence: [{ kind: "observed" as const, source: "host" as const }] });
const ledgerEntry = (hostKey: string, planTypes: Readonly<Record<string, LedgerPlanTypeResult>>, extra: Partial<LedgerHostEntry> = {}): LedgerHostEntry => ({ hostKey, hostLabel: extra.hostLabel ?? hostKey, runAt: extra.runAt ?? "", reportDigest: extra.reportDigest ?? "", kit: extra.kit ?? UNRECORDED_KIT, planTypes });
const ledgerOf = (hosts: readonly LedgerHostEntry[]): HostVerificationLedger => ({ schemaVersion: "0.1", hosts });

test("curated catalogue covers native families and common effect families", () => {
  assert.ok(BASE_CATALOGUE.capabilities.length >= 40);
  assert.equal(BASE_CATALOGUE.enumeration.effect, "partially-observable");
  assert.deepEqual(
    ["transform", "text", "masks", "shape", "footage", "camera", "light", "audio"].map((family) => BASE_CATALOGUE.capabilities.find((capability) => capability.nativeFamily === family)?.matchName),
    ["ADBE Transform Group", "ADBE Text Properties", "ADBE Mask Parade", "ADBE Root Vectors Group", "ADBE AV Layer", "ADBE Camera Layer", "ADBE Light Layer", "ADBE Audio Levels"],
  );
  for (const category of ["blur", "glow", "color-correction", "sharpen", "noise", "distort", "stylize", "keying", "transitions"]) assert.ok(BASE_CATALOGUE.capabilities.some((capability) => capability.category === category), category);
  assert.ok(BASE_CATALOGUE.capabilities.some((capability) => capability.semanticRoles?.includes("text.source")));
  assert.ok(BASE_CATALOGUE.capabilities.some((capability) => capability.semanticRoles?.includes("transition.amount")));
  assert.ok(BASE_CATALOGUE.capabilities.every((capability) => capability.version && capability.evidence.length > 0));
});
test("native resolution retains exact observed paths and cardinality", () => {
  const text = resolveCapability(representativeSnapshot, { capabilityId: "adobe.text", layerId: "layer-title" });
  assert.equal(text.status, "exactly-one");
  assert.equal(text.instances[0]?.effectPath, "ADBE Text Properties");
  const source = resolveControl(representativeSnapshot, { capabilityId: "adobe.text", role: "text.source", layerId: "layer-title" });
  assert.equal(source.status, "exactly-one");
  assert.equal(source.controls[0]?.propertyPath, "ADBE Text Properties/ADBE Text Document");
  assert.equal(resolveCapability(representativeSnapshot, { capabilityId: "adobe.masks", layerId: "layer-title" }).status, "absent");
  assert.equal(resolveCapability(representativeSnapshot, { capabilityId: "adobe.footage", layerId: "layer-footage" }).status, "exactly-one");
});
test("inventory fingerprint ignores ordering but not stable identity", () => {
  const a = makeInventory(host, [item("b", "Localized"), item("a")]);
  const b = makeInventory(host, [item("a"), item("b", "Localized")]);
  assert.equal(a.fingerprint, b.fingerprint);
  assert.notEqual(a.fingerprint, inventoryFingerprint({ ...a, items: [item("c")] }));
});
test("inventory diff detects add/remove/change", () => {
  const before = makeInventory(host, [item("a", "A"), item("b", "B")]);
  const after = makeInventory(host, [item("a", "Renamed"), item("c", "C")]);
  const diff = diffInventory(before, after);
  assert.deepEqual(diff.added.map((x) => x.matchName), ["c"]);
  assert.deepEqual(diff.removed.map((x) => x.matchName), ["b"]);
  assert.equal(diff.changed.length, 0, "localized display names are not identity changes");
});
test("search is bounded and stable", () => { assert.equal(searchCapabilities(BASE_CATALOGUE, "blur", 1)[0]?.matchName, "ADBE Gaussian Blur 2"); assert.ok(searchCapabilities(BASE_CATALOGUE, "", 1000).length <= 100); });
test("capability search matches a query word by word while keeping its ranking", () => {
  assert.deepEqual(searchCapabilities(BASE_CATALOGUE, "ramp gradient").map((capability) => capability.id), ["adobe.gradient-ramp"]);
  assert.deepEqual(searchCapabilities(BASE_CATALOGUE, "four color gradient").map((capability) => capability.id), ["adobe.four-color-gradient"], "the words need not be adjacent or in one field");
  assert.deepEqual(searchCapabilities(BASE_CATALOGUE, "ramp quasar"), []);
  assert.deepEqual(searchCapabilities(BASE_CATALOGUE, "quasar nebula"), []);
  assert.deepEqual(searchCapabilities(BASE_CATALOGUE, "gaussian blur").map((capability) => capability.id), ["adobe.gaussian-blur", "adobe.gaussian-blur-legacy", "adobe.fast-blur-legacy"]);
  assert.deepEqual(searchCapabilities(BASE_CATALOGUE, "gradient", 3).map((capability) => capability.id), ["adobe.gradient-ramp", "adobe.gradient-wipe", "adobe.four-color-gradient"]);
  assert.ok(searchCapabilities(BASE_CATALOGUE, "").length > 0);
});
test("host profile fingerprint is order-independent and huge installed inventories stay compact", () => {
  const items = Array.from({ length: 700 }, (_, index) => item(`Third Party ${index}`));
  const first = makeInventory(host, items);
  const second = makeInventory(host, [...items].reverse());
  assert.equal(first.fingerprint, second.fingerprint);
  const profile = makeHostProfile(first);
  assert.equal(makeHostProfile(second, profile).cacheStatus, "unchanged");
  const result = searchHostProfile(profile, "third party", 25);
  assert.equal(result.entries.length, 25);
  assert.equal(result.truncated, true);
  assert.match(present(result.entries[0], "an entry").description, /controls have not been deeply probed/);
});
test("host profile search matches a query word by word, never the whole sentence and never OR", () => {
  const profile = makeHostProfile(makeInventory(host, []));
  assert.deepEqual(searchHostProfile(profile, "ramp gradient").entries.map((entry) => entry.id), ["adobe.gradient-ramp"]);
  assert.deepEqual(searchHostProfile(profile, "gaussian blur").entries.map((entry) => entry.id), ["adobe.gaussian-blur", "adobe.gaussian-blur-legacy", "adobe.fast-blur-legacy"]);
  assert.deepEqual(searchHostProfile(profile, "ramp quasar").entries, []);
  assert.deepEqual(searchHostProfile(profile, "quasar nebula").entries, []);
  const one = searchHostProfile(profile, "ramp", 1);
  assert.deepEqual(one.entries.map((entry) => entry.id), ["adobe.gradient-ramp"]);
  assert.equal(one.truncated, true, "the second word-match is beyond the page, as before");
  assert.deepEqual(searchHostProfile(profile, "ramp", 100).entries.map((entry) => entry.id), ["adobe.gradient-ramp", "adobe.timewarp"]);
  const all = searchHostProfile(profile, "", 1000);
  assert.equal(all.entries.length, 100, "an empty query still returns everything, clamped to 100");
  assert.equal(all.truncated, true);
});
test("host profiles materialize installed presets as compact searchable entries", () => {
  const presets = makePresetInventory([{ id: "preset-typewriter", root: "ae-presets", name: "Typewriter", category: "Text", statFingerprint: "stable" }]);
  const profile = makeHostProfile(makeInventory(host, []), undefined, presets);
  const entry = searchHostProfile(profile, "typewriter").entries[0];
  assert.equal(entry?.kind, "preset");
  assert.equal(entry?.displayName, "Typewriter");
  assert.ok(!entry?.description.includes("/"));
  assert.equal(makeHostProfile(makeInventory(host, []), profile, presets).cacheStatus, "unchanged");
  const legacyCache = { ...profile, entries: profile.entries.filter((candidate) => candidate.kind !== "preset") };
  const migrated = makeHostProfile(makeInventory(host, []), legacyCache, presets);
  assert.equal(searchHostProfile(migrated, "typewriter").entries[0]?.kind, "preset");
  assert.equal(migrated.cacheStatus, "fresh");
});
test("profile joins curated live availability and queues only added or version-changed installed effects", () => {
  const first = makeInventory(host, [item("ADBE Gaussian Blur 2", "Localized blur"), { ...item("Vendor Effect"), version: "1" }]);
  const profile = makeHostProfile(first);
  const blur = present(profile.entries.find((entry) => entry.matchName === "ADBE Gaussian Blur 2"), "ADBE Gaussian Blur 2");
  assert.equal(blur.availability, "available");
  assert.equal(present(profile.entries.find((entry) => entry.matchName === "ADBE Fill"), "ADBE Fill").availability, "unavailable");
  assert.equal(profile.probeNeeded.includes("adobe.fill"), false);
  const enriched = { ...profile, entries: profile.entries.map((entry) => entry.id === "host:Vendor Effect" ? { ...entry, operationStatus: "read-only" as const, probeState: "probed" as const, controls: [{ path: "Vendor Effect/Amount", matchName: "Amount", displayName: "Amount", valueType: "number" }] } : entry) };
  const unchanged = makeHostProfile(makeInventory(host, [item("ADBE Gaussian Blur 2", "Autre libellé"), { ...item("Vendor Effect"), version: "1" }]), enriched);
  assert.equal(present(unchanged.entries.find((entry) => entry.id === "host:Vendor Effect"), "host:Vendor Effect").controls?.[0]?.matchName, "Amount");
  const changed = makeHostProfile(makeInventory(host, [item("ADBE Gaussian Blur 2"), { ...item("Vendor Effect"), version: "2" }]), enriched);
  assert.deepEqual(changed.probeNeeded, ["host:Vendor Effect"]);
  const partial = makeInventory(host, [item("ADBE Gaussian Blur 2")], true);
  assert.equal(diffInventory(first, partial).removed.length, 0);
});
test("an inventory that cannot see an effect never overwrites what an earlier profile established", () => {
  const seen = makeHostProfile(makeInventory(host, [item("ADBE Ramp", "Gradient Ramp")]));
  assert.equal(present(seen.entries.find((entry) => entry.matchName === "ADBE Ramp"), "ADBE Ramp").availability, "available");
  const unscanned = makeHostProfile(makeInventory(host, [], false, "partial"), seen);
  assert.equal(present(unscanned.entries.find((entry) => entry.matchName === "ADBE Ramp"), "ADBE Ramp").availability, "available");
  const assumed = { ...seen, entries: seen.entries.map((entry) => entry.matchName === "ADBE Ramp" ? { ...entry, operationStatus: "probeNeeded" as const, provenance: "curated; assumed installed for this profile (--assume-installed)" } : entry) };
  assert.equal(present(makeHostProfile(makeInventory(host, [], false, "partial"), assumed).entries.find((entry) => entry.matchName === "ADBE Ramp"), "ADBE Ramp").availability, "available");
  assert.equal(present(makeHostProfile(makeInventory(host, []), assumed).entries.find((entry) => entry.matchName === "ADBE Ramp"), "ADBE Ramp").availability, "unavailable");
});
test("effects observed in the open project are a partial inventory, never a census", () => {
  const observed = observeSnapshotEffects(representativeSnapshot);
  assert.equal(observed.completeness, "partial");
  assert.equal(observed.truncated, true);
  const profile = makeHostProfile(observed);
  assert.equal(profile.inventoryCompleteness, "partial");
  const listed = new Set(observed.items.map((entry) => entry.matchName));
  const unlisted = profile.entries.filter((entry) => entry.kind === "effect" && typeof entry.matchName === "string" && !listed.has(entry.matchName));
  assert.ok(unlisted.length > 0, "the fixture uses fewer effects than the catalogue curates");
  for (const entry of unlisted) assert.equal(entry.availability, "unknown", `${String(entry.matchName)} is unlisted, so its availability is unknown rather than disproved`);
});
test("curates the bundled Cycore (CC) effect family alongside native Adobe effects", () => {
  assert.ok(searchCapabilities(BASE_CATALOGUE, "sparkle").some((c) => c.matchName === "CC Star Burst"));
  assert.ok(searchCapabilities(BASE_CATALOGUE, "vignette").some((c) => c.matchName === "CS Vignette"));
  assert.ok(BASE_CATALOGUE.capabilities.some((c) => c.matchName === "CC Light Sweep"));
});
test("semantic resolution distinguishes unavailable, absent, and exactly-one", () => {
  assert.equal(resolveCapability(representativeSnapshot, { capabilityId: "adobe.not-installed", layerId: "layer-title" }).availability, "unavailable");
  assert.equal(resolveCapability(representativeSnapshot, { capabilityId: "adobe.gaussian-blur", layerId: "layer-footage" }).status, "absent");
  const resolved = resolveCapability(representativeSnapshot, { capabilityId: "adobe.gaussian-blur", layerId: "layer-title" });
  assert.equal(resolved.status, "exactly-one");
  assert.ok(resolved.instances[0]?.evidence.some((evidence) => evidence.kind === "observed"));
});
test("semantic controls traverse nested groups and report duplicate effect ambiguity", () => {
  const amount = resolveControl(representativeSnapshot, { capabilityId: "adobe.gaussian-blur", role: "blur.amount", layerId: "layer-title" });
  assert.equal(amount.status, "exactly-one");
  assert.equal(amount.controls[0]?.propertyPath, "ADBE Effect Parade/ADBE Gaussian Blur 2/ADBE Gaussian Blur 2-0001");
  const position = resolveControl(representativeSnapshot, { capabilityId: "adobe.transform", role: "transform.position", layerId: "layer-title" });
  assert.equal(position.status, "exactly-one");
  assert.equal(position.controls[0]?.propertyPath, "ADBE Transform Group/ADBE Position");
  const duplicate = structuredClone(representativeSnapshot);
  const parade = present(duplicate.compositions[0]?.layers[0]?.properties[2], "the effect parade");
  const effect = structuredClone(present(parade.children?.[0], "the first effect"));
  effect.path = "ADBE Effect Parade/ADBE Gaussian Blur 2[2]";
  present(effect.children?.[0], "the effect's first control").path = `${effect.path}/ADBE Gaussian Blur 2-0001`;
  present(parade.children, "the parade's effects").push(effect);
  assert.equal(resolveCapability(duplicate, { capabilityId: "adobe.gaussian-blur", layerId: "layer-title" }).status, "multiple");
  assert.equal(resolveControl(duplicate, { capabilityId: "adobe.gaussian-blur", role: "blur.amount", layerId: "layer-title" }).status, "multiple");
});

test("live effect-control evidence gives installed effects pageable schemas, ranges, menus, and host caveats", () => {
  const rows = [{ m: "ACME Glow-0001", n: "Amount", t: "OneD", v: 10, min: 0, max: 100 }, { m: "ACME Glow-0002", n: "Mode", t: "OneD", v: 1, dd: true, items: ["Screen", "Add"] }, { m: "ADBE Effect Built In Params", n: "Compositing Options", g: 1 }, { m: "ADBE Effect Mask Opacity", n: "Effect Opacity", t: "OneD", v: 100, min: 0, max: 100, static: true }];
  const controls = controlsFromProbeRows("ACME Glow", rows);
  assert.deepEqual(controls.map((control) => control.path), ["ACME Glow/ACME Glow-0001", "ACME Glow/ACME Glow-0002", "ACME Glow/ADBE Effect Built In Params", "ACME Glow/ADBE Effect Built In Params/ADBE Effect Mask Opacity"]);
  assert.equal(present(controls[1], "the menu control").valueType, "enum"); assert.deepEqual(present(controls[1], "the menu control").menu, ["Screen", "Add"]); assert.equal(present(controls[3], "the fourth control").animatable, false);
  const profile = makeHostProfile(makeInventory(host, [item("ACME Glow", "Acme Glow"), item("ADBE Dropdown Control", "Dropdown Menu Control")]));
  const probed = applyEffectControlEvidence(profile, { host: { version: "26.2.1x2" }, effects: { "ACME Glow": { controls: rows }, "ADBE Dropdown Control": { controls: [] } } });
  const glow = present(probed.entries.find((entry) => entry.matchName === "ACME Glow"), "ACME Glow");
  assert.equal(glow.probeState, "probed"); assert.equal(glow.operationStatus, "supported"); assert.equal(glow.controls?.length, 4);
  assert.equal(present(probed.entries.find((entry) => entry.matchName === "ADBE Dropdown Control"), "ADBE Dropdown Control").operationStatus, "unsupported", "effects the host cannot confirm are never offered as supported");
  assert.match(String(effectControlValueError(probed, "ACME Glow", "ACME Glow-0001", 150)), /accepts 0-100/);
  assert.match(String(effectControlValueError(probed, "ACME Glow", "ACME Glow-0002", 3)), /use 1-2: 1 Screen, 2 Add\./);
  assert.equal(effectControlValueError(probed, "ACME Glow", "ACME Glow-0001", 50), null);
});

function probedControlMatchNames(evidence: ReturnType<typeof loadFixtureEffectEvidence>, matchName: string): Set<string | undefined> {
  return new Set((evidence?.effects[matchName]?.controls ?? []).map((row) => row.m));
}

function assertCuratedControls(evidence: ReturnType<typeof loadFixtureEffectEvidence>, id: string, matchName: string): void {
  const capability = BASE_CATALOGUE.capabilities.find((candidate) => candidate.id === id);
  assert.equal(capability?.matchName, matchName);
  const probed = probedControlMatchNames(evidence, matchName);
  for (const control of capability?.controls ?? []) assert.ok(probed.has(control.matchName), control.matchName);
}

test("gradient generators are curated with evidence-matched controls", () => {
  const evidence = loadFixtureEffectEvidence();
  for (const [id, matchName] of [["adobe.gradient-ramp", "ADBE Ramp"], ["adobe.four-color-gradient", "ADBE 4ColorGradient"]] as const) assertCuratedControls(evidence, id, matchName);
  assert.ok(searchCapabilities(BASE_CATALOGUE, "gradient").some((c) => c.id === "adobe.gradient-ramp"));
  assert.equal(BASE_CATALOGUE.capabilities.find((c) => c.id === "adobe.gradient-ramp")?.controls?.find((c) => c.role === "gradient.end-color")?.matchName, "ADBE Ramp-0004");
});

const HOST_BUILT_IN = /^(ADBE|CC) /;

test("every curated host built-in effect matchName exists in the fixture probe evidence", () => {
  const evidence = loadFixtureEffectEvidence();
  const missing = BASE_CATALOGUE.capabilities.filter((c) => c.kind === "effect" && !c.nativeFamily && c.matchName && HOST_BUILT_IN.test(c.matchName) && !evidence?.effects[c.matchName]).map((c) => c.matchName);
  assert.deepEqual(missing, []);
});

test("every probed Adobe effect is curated exactly once with a unique id", () => {
  const evidence = loadFixtureEffectEvidence();
  const effects = BASE_CATALOGUE.capabilities.filter((c) => c.kind === "effect" && !c.nativeFamily);
  const ids = BASE_CATALOGUE.capabilities.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, "capability ids are unique");
  const curated = new Set(effects.map((c) => c.matchName));
  assert.deepEqual(Object.keys(evidence?.effects ?? {}).filter((matchName) => !curated.has(matchName) && !matchName.startsWith("FXV ")), []);
  assert.equal(effects.length, curated.size, "no matchName is curated twice");
  assert.ok(effects.every((c) => (c.description ?? "").length >= 20));
  assert.ok(BASE_CATALOGUE.capabilities.find((c) => c.matchName === "ADBE DE Bounce")?.requirements?.[0]?.includes("apply_preset"));
});

test("profile cache is invalidated when curated catalogue content changes", () => {
  const inventory = makeInventory(host, [item("ADBE Ramp", "Gradient Ramp")]);
  const profile = makeHostProfile(inventory);
  const stale = { ...profile, profileId: "profile-from-an-older-catalogue" };
  assert.equal(makeHostProfile(inventory, stale).cacheStatus, "fresh");
  assert.equal(makeHostProfile(inventory, profile).cacheStatus, "unchanged");
});

test("a ledger entry recorded without an architecture covers that host's real architecture", () => {
  const recorded = "26.2.1x2 (2) macOS/unknown";
  assert.equal(ledgerKeyApplies(recorded, "26.2.1x2 (2) macOS/arm64"), true);
  assert.equal(ledgerKeyApplies(recorded, "26.2.1x2 (2) macOS/x86_64"), true);
  assert.equal(ledgerKeyApplies(recorded, recorded), true);
  assert.equal(ledgerKeyApplies(recorded, "26.3.0x1 (5) macOS/arm64"), false);
  assert.equal(ledgerKeyApplies(recorded, "26.2.1x2 (2) Windows/arm64"), false);
  assert.equal(ledgerKeyApplies("26.2.1x2 (2) macOS/arm64", "26.2.1x2 (2) macOS/x86_64"), false);
});

test("a widened unknown-architecture ledger entry never hides a real per-architecture result", () => {
  const hostKey = "24.6 (61) darwin/arm64";
  const ledger = ledgerOf([
    ledgerEntry("24.6 (61) darwin/unknown", { set_layer_name: { status: "verified", cases: ["widened"] } }),
    ledgerEntry(hostKey, { set_layer_name: { status: "failed", cases: [], failedCases: ["exact-arm64"] } }),
  ]);
  assert.equal(planTypeVerification("set_layer_name", { hostKey, ledger }).status, "regressed");
  assert.equal(planTypeVerification("set_layer_name", { hostKey: "24.6 (61) darwin/x86_64", ledger }).status, "verified");
});

test("a host two kits ran keeps both claims, resolves to the newest, and still answers from the older kit where the newest is silent", () => {
  const hostKey = "26.2.1x2 (2) macOS/unknown";
  const six = ledgerEntry(hostKey, { set_layer_name: { status: "verified", cases: ["layer.set-name"] }, add_marker: { status: "verified", cases: ["markers.add"] } },
    { hostLabel: "After Effects 26.2.1 (build 2) macOS/unknown", runAt: "2026-09-16T12:46:28.313Z", reportDigest: "a".repeat(64), kit: { extyntVersion: "0.6.0", packDigest: "c".repeat(64) } });
  const eight = ledgerEntry(hostKey, { set_layer_name: { status: "failed", cases: [], failedCases: ["layer.set-name"] } },
    { hostLabel: six.hostLabel, runAt: "2026-09-16T20:52:35.000Z", reportDigest: "b".repeat(64), kit: { extyntVersion: "0.8.0", packDigest: "1".repeat(64) } });
  const ledger = ledgerOf([six, eight]);
  assert.equal(planTypeVerification("set_layer_name", { hostKey, ledger }).status, "regressed");
  assert.equal(planTypeVerification("add_marker", { hostKey, ledger }).status, "verified");
  const reversed = ledgerOf([...ledger.hosts].reverse());
  assert.equal(planTypeVerification("set_layer_name", { hostKey, ledger: reversed }).status, "regressed");
  assert.equal(planTypeVerification("add_marker", { hostKey, ledger: reversed }).status, "verified");
  assert.equal(six.kit.extyntVersion, "0.6.0");
  assert.equal(eight.kit.extyntVersion, "0.8.0");
});

