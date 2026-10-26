// How the host capability profile is shown to the model: the overview counts, a compact row per capability, the font counts, and the paging cursor.
import { emptyFontInventory, fontsAreAuthoritative, inventoryIsAuthoritative } from "@extynt/capability-catalogue";
import type { FontInventory, HostCapabilityProfile, HostProfileEntry } from "@extynt/capability-catalogue";
import { decodeJson, number, object, string } from "@extynt/decode";
import type { Infer } from "@extynt/decode";

const REQUIREMENTS_SHOWN = 3;
const REQUIREMENT_CHARS = 160;

const cursorShape = object({ profileId: string(), offset: number({ int: true, min: 0 }) });

type ProfileCursor = Infer<typeof cursorShape>;

/** The opaque cursor that resumes a profile answer at `offset`. */
export function encodeCursor(profileId: string, offset: number): string {
  return Buffer.from(JSON.stringify({ profileId, offset })).toString("base64url");
}

/** The position a cursor names, or `null` when the text is not one of ours. */
export function decodeCursor(cursor: string): ProfileCursor | null {
  const decoded = decodeJson(Buffer.from(cursor, "base64url").toString("utf8"), cursorShape);
  return decoded.ok ? decoded.value : null;
}

/** Counts only: a font list is a vocabulary, and the names come from ae_search_fonts. */
export function fontSummary(inventory: FontInventory) {
  return {
    families: inventory.familiesReported,
    styles: inventory.totalReported,
    returned: inventory.items.length,
    completeness: inventory.completeness,
    truncated: inventory.truncated,
    authoritative: fontsAreAuthoritative(inventory),
    loading: inventory.loading === true,
    searchTool: "ae_search_fonts",
  };
}

/** One capability row, compact by design; the first caveats ride along because an "unsupported" status without its reason reads as transient. */
export function projectHostRow(entry: HostProfileEntry, usage: ReadonlyMap<string, number>) {
  const used = entry.kind === "effect" && entry.matchName ? usage.get(entry.matchName) : undefined;
  const shortened = (requirement: string) => (requirement.length > REQUIREMENT_CHARS ? `${requirement.slice(0, REQUIREMENT_CHARS - 1)}…` : requirement);
  return {
    id: entry.id,
    kind: entry.kind,
    matchName: entry.matchName ?? null,
    displayName: entry.displayName,
    category: entry.category ?? null,
    availability: entry.availability,
    operationStatus: entry.operationStatus,
    evidence: entry.evidence,
    probeState: entry.probeState,
    ...(entry.userAssisted ? { userAssisted: entry.userAssisted.note } : {}),
    requirements: (entry.requirements ?? []).slice(0, REQUIREMENTS_SHOWN).map(shortened),
    ...(used ? { used } : {}),
  };
}

function tally(profile: HostCapabilityProfile, field: "availability" | "operationStatus" | "probeState"): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of profile.entries) counts[entry[field]] = (counts[entry[field]] ?? 0) + 1;
  return counts;
}

function effectsOverview(profile: HostCapabilityProfile) {
  const effectEntries = profile.entries.filter((entry) => entry.kind === "effect").length;
  return {
    fingerprint: profile.shallowFingerprint,
    completeness: profile.inventoryCompleteness ?? (profile.inventoryTruncated ? "partial" : "complete"),
    authoritative: inventoryIsAuthoritative(profile),
    total: profile.inventoryTotalReported ?? effectEntries,
    returned: profile.inventoryReturnedCount ?? effectEntries,
  };
}

function presetsOverview({ presetInventory }: HostCapabilityProfile) {
  const count = presetInventory.items.length;
  return { fingerprint: presetInventory.fingerprint, completeness: presetInventory.truncated ? "partial" : "complete", total: count, returned: count };
}

/** What the summary and status answers share: the profile's identity, cache state, and the counts of what it holds. */
export function profileOverview(profile: HostCapabilityProfile) {
  return {
    profileId: profile.profileId,
    phase: profile.phase,
    cacheStatus: profile.cacheStatus,
    cacheSource: profile.cacheStatus === "restored" ? "disk" : "shallow-scan",
    effects: effectsOverview(profile),
    presets: presetsOverview(profile),
    fonts: fontSummary(profile.fontInventory ?? emptyFontInventory()),
    counts: { availability: tally(profile, "availability"), operationStatus: tally(profile, "operationStatus"), probeState: tally(profile, "probeState") },
    lastShallowScan: profile.lastShallowScan,
  };
}
