// Builds the host capability profile: the curated catalogue joined to the live inventory, presets and fonts, carried forward from a previous profile.
import { sha256Hex, stableJson, compareText } from "./canonical.js";
import { HOST_PROFILE_SCHEMA } from "./catalogue-model.js";
import type { HostCapabilityProfile, HostProfileEntry, Inventory, PresetInventory } from "./catalogue-model.js";
import { BASE_CATALOGUE, CATALOGUE_CONTENT_FINGERPRINT } from "./curated-catalogue.js";
import { emptyFontInventory } from "./fonts.js";
import type { FontInventory } from "./fonts.js";
import { curatedProfileEntry, installedProfileEntry } from "./host-profile-entries.js";
import { makePresetInventory, materializePresetEntries, presetEntryId } from "./inventory.js";

function mergedStatus(entry: HostProfileEntry, before: HostProfileEntry): Pick<HostProfileEntry, "operationStatus" | "probeState"> {
  const refusedBefore = before.operationStatus === "unsupported" && entry.userAssisted !== undefined;
  return refusedBefore ? { operationStatus: entry.operationStatus, probeState: entry.probeState } : { operationStatus: before.operationStatus, probeState: before.probeState };
}

function mergeProfileEntry(entry: HostProfileEntry, before: HostProfileEntry | undefined): HostProfileEntry {
  if (!before || before.version !== entry.version) return entry;
  if (before.operationStatus === "probeNeeded" && before.availability !== "available") return entry;
  return {
    ...before,
    ...entry,
    availability: entry.availability === "unknown" ? before.availability : entry.availability,
    ...mergedStatus(entry, before),
    controls: before.controls,
  };
}

function removedEntryIds(inventory: Inventory, previous: HostCapabilityProfile | undefined, current: ReadonlySet<string>): string[] {
  if (inventory.completeness !== "complete" || previous?.inventoryTruncated !== false) return [];
  return [...new Set((previous?.entries ?? []).map((entry) => entry.id))].filter((id) => !current.has(id));
}

function profileIdentity(inventory: Inventory, presets: PresetInventory, fonts: FontInventory): string {
  return sha256Hex(stableJson({
    schema: HOST_PROFILE_SCHEMA, catalogue: BASE_CATALOGUE.catalogueVersion, catalogueContent: CATALOGUE_CONTENT_FINGERPRINT,
    host: { ...inventory.host }, inventory: inventory.fingerprint, presets: presets.fingerprint, fonts: fonts.fingerprint,
  }));
}

function profileIsUnchanged(previous: HostCapabilityProfile, profileId: string, presets: PresetInventory): boolean {
  if (previous.profileId !== profileId) return false;
  const previousIds = new Set(previous.entries.map((entry) => entry.id));
  return presets.items.every((preset) => previousIds.has(presetEntryId(preset)));
}

function profileEntries(inventory: Inventory, presets: PresetInventory): HostProfileEntry[] {
  const live = new Map(inventory.items.map((item) => [item.matchName, item]));
  const authoritative = inventory.completeness === "complete" && !inventory.truncated;
  const curated = BASE_CATALOGUE.capabilities.map((capability) => curatedProfileEntry(capability, live, authoritative));
  const known = new Set(curated.map((entry) => entry.matchName));
  const installed = inventory.items.filter((item) => !known.has(item.matchName)).map(installedProfileEntry);
  return [...curated, ...installed, ...materializePresetEntries(presets)]
    .sort((a, b) => compareText(a.displayName, b.displayName) || compareText(a.matchName ?? "", b.matchName ?? ""));
}

function needsProbe(entry: HostProfileEntry, prior: HostProfileEntry | undefined): boolean {
  return entry.operationStatus === "probeNeeded" && (!prior || prior.version !== entry.version);
}

interface ProfileSource { inventory: Inventory; presets: PresetInventory; fonts: FontInventory; profileId: string }

function rebuiltProfile({ inventory, presets, fonts, profileId }: ProfileSource, previous: HostCapabilityProfile | undefined): HostCapabilityProfile {
  const entries = profileEntries(inventory, presets);
  const prior = new Map((previous?.entries ?? []).map((entry) => [entry.id, entry]));
  const merged = entries.map((entry) => mergeProfileEntry(entry, prior.get(entry.id)));
  return {
    schemaVersion: HOST_PROFILE_SCHEMA, catalogueVersion: BASE_CATALOGUE.catalogueVersion, host: inventory.host, shallowFingerprint: inventory.fingerprint, profileId,
    cacheStatus: "fresh", inventoryTruncated: inventory.truncated, inventoryCompleteness: inventory.completeness, presetInventory: presets, fontInventory: fonts,
    phase: inventory.truncated || presets.truncated ? "partial" : "shallow", entries: merged,
    probeNeeded: merged.filter((entry) => needsProbe(entry, prior.get(entry.id))).map((entry) => entry.id),
    removed: removedEntryIds(inventory, previous, new Set(entries.map((entry) => entry.id))), lastShallowScan: presets.scannedAt,
  };
}

/** The profile for an inventory: reused untouched when nothing it depends on changed, otherwise rebuilt with earlier probe results carried over. */
export function makeHostProfile(inventory: Inventory, previous?: HostCapabilityProfile, presets: PresetInventory = makePresetInventory([]), fonts: FontInventory = emptyFontInventory()): HostCapabilityProfile {
  const profileId = profileIdentity(inventory, presets, fonts);
  if (previous && profileIsUnchanged(previous, profileId, presets)) return { ...previous, fontInventory: fonts, cacheStatus: "unchanged" };
  return rebuiltProfile({ inventory, presets, fonts, profileId }, previous);
}
