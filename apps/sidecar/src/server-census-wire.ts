// What a host census must contain to be accepted, and the inventory facts read from one that was.
import { array, boolean, literal, number, object, optional, refine, string } from "@extynt/decode";
import type { Infer } from "@extynt/decode";
import type { InventoryItem } from "@extynt/capability-catalogue";
import { SNAPSHOT_SCHEMA_VERSION } from "./server-limits.js";
import { installedEffect, probeRuntime } from "./server-probe-wire.js";

const MAX_CENSUS_ROWS = 10_000;
const MAX_FINGERPRINT_CHARS = 128;
const MAX_NAME_CHARS = 512;

const installedFonts = array(
  object({ family: optional(string()), style: optional(string()), postScriptName: optional(string({ maxLength: MAX_NAME_CHARS })), technology: optional(string()) }),
  { maxLength: MAX_CENSUS_ROWS },
);

const completeness = literal("complete", "partial", "failed");

const envelope = {
  schemaVersion: literal(SNAPSHOT_SCHEMA_VERSION),
  ok: literal(true),
  requestId: string({ nonEmpty: true, maxLength: MAX_FINGERPRINT_CHARS }),
  warnings: array(string()),
};

const fontReport = {
  fontTotalReported: optional(number()),
  fontFamiliesReported: optional(number()),
  fontCompleteness: optional(completeness),
  durationMs: optional(object({ effects: optional(number()), fonts: optional(number()), fontsEnumerate: optional(number()), fontsRead: optional(number()), fontsSort: optional(number()), total: optional(number()) })),
  fontFingerprint: optional(string({ maxLength: MAX_FINGERPRINT_CHARS })),
  fontsUnchanged: optional(boolean()),
};

const effectsResult = object({
  runtime: probeRuntime,
  installedEffects: array(installedEffect, { maxLength: MAX_CENSUS_ROWS }),
  totalReported: number({ int: true, min: 0 }),
  returnedCount: number({ int: true }),
  completeness,
  installedFonts: optional(installedFonts),
  part: optional(literal("effects", "fonts", "all")),
  ...fontReport,
});

/** Decodes a host census of effects. */
export const hostCensus = object({
  ...envelope,
  result: refine(effectsResult, (result): result is typeof result => result.returnedCount === result.installedEffects.length, "a returnedCount equal to the number of installed effects"),
});

/** Decodes the fonts half of a split census. */
export const fontCensus = object({
  ...envelope,
  result: object({ part: literal("fonts"), runtime: probeRuntime, installedFonts, ...fontReport }),
});

/**
 * The effects the host has installed, as a bounded, successful schema 0.1 census from a supported host. A panel older than the font census
 * sends no fonts; `durationMs` is the host's own measure of each phase; `part` says which half the census carries (absent or "all" is both);
 * `fontFingerprint` is the host's cheap key for the font list, and `fontsUnchanged` says the list the caller named by it is still the host's,
 * so `installedFonts` is empty. Every font member is optional because a host of another version or a split census leaves it out.
 */
export type HostCensus = Infer<typeof hostCensus>;

/** The fonts half of a split census: a bounded list (empty when the host says the caller's list is unchanged), counts, and an optional bounded fingerprint. */
export type FontCensus = Infer<typeof fontCensus>;

/** The host installation a census or snapshot runtime describes. */
export function hostInstallation(runtime: HostCensus["result"]["runtime"]) {
  return { application: "After Effects" as const, version: runtime.appVersion, buildNumber: runtime.buildNumber, platform: runtime.platform, architecture: runtime.architecture };
}

/** The catalogue entry for one installed effect the census reported. */
export function inventoryItem(item: HostCensus["result"]["installedEffects"][number]): InventoryItem {
  return {
    matchName: item.matchName,
    displayName: item.displayName ?? item.matchName,
    version: typeof item.version === "string" ? item.version : null,
    available: item.available !== false,
    ...(typeof item.category === "string" ? { category: item.category } : {}),
    ...(item.hasOptionsDialog === true ? { hasOptionsDialog: true } : {}),
    evidence: [{ kind: "observed", source: "host", note: "Reported by the startup After Effects host census." }],
  };
}
