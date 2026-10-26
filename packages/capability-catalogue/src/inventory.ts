// Inventory construction and comparison: canonical order, content fingerprints, preset entries and diffs between scans.

import { CATALOGUE_SCHEMA } from "./catalogue-model.js";
import type {
  HostCapabilityProfile, HostInstallation, HostProfileEntry, Inventory, InventoryCompleteness, InventoryDiff, InventoryItem,
  PresetInventory, PresetInventoryItem,
} from "./catalogue-model.js";
import { compareText, sha256Hex, stableJson } from "./canonical.js";

/** The items in canonical order: match name, then display name. */
export function canonicalInventory(items: InventoryItem[]): InventoryItem[] {
  return [...items].sort((a, b) => compareText(a.matchName, b.matchName) || compareText(a.displayName, b.displayName));
}

/** A hash of what the inventory says about the host, independent of item order. */
export function inventoryFingerprint(inventory: Omit<Inventory, "fingerprint">): string {
  const items = inventory.items
    .map((item) => ({ matchName: item.matchName, version: item.version ?? null, available: item.available, ...(item.hasOptionsDialog ? { hasOptionsDialog: true } : {}) }))
    .sort((a, b) => compareText(a.matchName, b.matchName));
  return sha256Hex(stableJson({ schemaVersion: inventory.schemaVersion, host: { ...inventory.host }, completeness: inventory.completeness, items }));
}

/** Builds an inventory in canonical order; the census can report "failed", which is a different fact from "stopped early". */
export function makeInventory(host: HostInstallation, items: InventoryItem[], truncated = false, completeness?: InventoryCompleteness): Inventory {
  const verdict = completeness ?? (truncated ? "partial" : "complete");
  const base = { schemaVersion: CATALOGUE_SCHEMA, host, items: canonicalInventory(items), truncated: truncated || verdict !== "complete", completeness: verdict };
  return { ...base, fingerprint: inventoryFingerprint(base) };
}

/** A profile is evidence of absence only when the enumeration behind it ran to completion; a profile without a verdict falls back to its truncation flag. */
export function inventoryIsAuthoritative(profile: Pick<HostCapabilityProfile, "inventoryTruncated" | "inventoryCompleteness">): boolean {
  if (profile.inventoryCompleteness === undefined) return !profile.inventoryTruncated;
  return profile.inventoryCompleteness === "complete" && !profile.inventoryTruncated;
}

/** Builds a preset inventory in canonical order; `scannedAt` defaults to now. */
export function makePresetInventory(items: PresetInventoryItem[], truncated = false, scannedAt = new Date().toISOString()): PresetInventory {
  const ordered = [...items].sort((a, b) => compareText(a.root, b.root) || compareText(a.id, b.id));
  const identity = ordered.map((item) => ({ id: item.id, root: item.root, statFingerprint: item.statFingerprint }));
  return { items: ordered, truncated, scannedAt, fingerprint: sha256Hex(stableJson({ items: identity, truncated })) };
}

/** The profile id an installed preset gets. */
export function presetEntryId(preset: PresetInventoryItem): string {
  return `preset:${preset.root}:${preset.id}`;
}

/** One shallow profile entry per installed preset. */
export function materializePresetEntries(presets: PresetInventory): HostProfileEntry[] {
  return presets.items.map((preset) => {
    const isUser = preset.root === "user-presets";
    return {
      id: presetEntryId(preset),
      kind: "preset",
      displayName: preset.name,
      description: `Installed ${isUser ? "user" : "After Effects"} preset; its contents have not been deeply probed.`,
      version: null,
      category: preset.category,
      provider: isUser ? "User presets" : "After Effects",
      availability: "available",
      operationStatus: "probeNeeded",
      evidence: ["installed"],
      provenance: "live shallow preset inventory",
      probeState: "probeNeeded",
    };
  });
}

function indexByMatchName(inventory: Inventory | undefined): Map<string, InventoryItem> {
  return new Map((inventory?.items ?? []).map((item) => [item.matchName, item]));
}

function itemChanged(before: InventoryItem, after: InventoryItem): boolean {
  return (before.version ?? null) !== (after.version ?? null) || before.available !== after.available;
}

/** What `after` added or changed against `before`; removals are claimed only when both scans completed, because otherwise absence is not evidence. */
export function diffInventory(before: Inventory | undefined, after: Inventory): InventoryDiff {
  const old = indexByMatchName(before);
  const next = indexByMatchName(after);
  const added = [...next.values()].filter((item) => !old.has(item.matchName));
  const changed = [...next.values()].flatMap((item) => {
    const previous = old.get(item.matchName);
    return previous && itemChanged(previous, item) ? [{ before: previous, after: item }] : [];
  });
  const scansComplete = before?.completeness === "complete" && after.completeness === "complete";
  const removed = scansComplete ? [...old.values()].filter((item) => !next.has(item.matchName)) : [];
  return { added, removed, changed, unchanged: Math.max(0, next.size - added.length - changed.length) };
}
