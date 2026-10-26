/**
 * Derives a host capability profile from the live verification reports under `docs/live-reports/`: an
 * `ensure_effect` step that came back `applied` is proof the effect exists on that host build, so
 * availability is evidence-backed. An `unavailable` is only inherited where the census was
 * authoritative; an unproven effect is left `unknown`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { array, boolean, decodeJson, literal, map, number, object, string } from "@extynt/decode";
import type { Decoder } from "@extynt/decode";
import { inventoryIsAuthoritative, makeFontInventory, type FontInventory, type HostCapabilityProfile } from "@extynt/capability-catalogue";
import { wireObject } from "@extynt/fake-plugin";
import { effectsProvenApplied, type FontCensusFile, type LiveReport } from "./profile-reports.js";
import { lenient } from "./lenient.js";
import { stringMember } from "./wire-reads.js";
import type { WireObject, WireValue } from "./wire-types.js";

/** What a derivation did to the base profile. */
export interface DerivedProfile {
  directory: string;
  hostKey: string;
  proven: number;
  total: number;
  available: number;
  assumed: number;
  cleared: number;
  seededFonts: number;
  reports: string[];
  note?: string;
}

interface DeriveRequest {
  base: string;
  out: string;
  reports: readonly LiveReport[];
  assumeInstalled: boolean;
  fonts: FontCensusFile | undefined;
}

type Completeness = NonNullable<HostCapabilityProfile["inventoryCompleteness"]>;

interface FixtureProfile {
  entries: WireObject[];
  host?: WireObject | undefined;
  fontInventory?: FontInventory | undefined;
  inventoryTruncated?: boolean | undefined;
  inventoryCompleteness?: Completeness | undefined;
}

const completenessOf: Decoder<Completeness> = literal("complete", "partial", "failed");

const fontInventoryOf: Decoder<FontInventory> = map(
  object({
    items: array(object({ family: string(), style: string(), postScriptName: string() })),
    truncated: boolean(),
    completeness: completenessOf,
    totalReported: number(),
    familiesReported: number(),
    fingerprint: string(),
  }),
  (inventory) => ({ ...inventory, items: inventory.items.map((item) => ({ ...item })) }),
);

const fixtureProfileOf: Decoder<FixtureProfile> = map(
  object({
    entries: array(wireObject),
    host: lenient(wireObject),
    fontInventory: lenient(fontInventoryOf),
    inventoryTruncated: lenient(boolean()),
    inventoryCompleteness: lenient(completenessOf),
  }),
  (profile) => ({ ...profile, entries: [...profile.entries] }),
);

interface Disposition { assumeInstalled: boolean; proven: ReadonlyMap<string, number>; baseIsAuthoritative: boolean; hostVersion: string }
interface Tally { entries: WireObject[]; marked: number; assumed: number; cleared: number }

function hostField(profile: FixtureProfile, field: string): string {
  const value = profile.host?.[field];
  return value === undefined || value === null ? "?" : String(value);
}

function hostVersionOf(profile: FixtureProfile): string {
  const version = hostField(profile, "version");
  return version === "?" ? "this host" : version;
}

function hostKeyOf(profile: FixtureProfile): string {
  return `${hostField(profile, "version")} (${hostField(profile, "buildNumber")}) ${hostField(profile, "platform")}`;
}

function derivationNote(stats: { marked: number; assumed: number }): { note?: string } {
  if (stats.assumed > 0) return { note: `Every effect is marked installed because --assume-installed was given, not because the evidence proves it.` };
  if (stats.marked === 0) return { note: "No effect in the base profile was proven by these reports; the derived profile is no better than the base." };
  return {};
}

function evidenceOf(entry: WireObject): string[] {
  const evidence = entry.evidence;
  return Array.isArray(evidence) ? evidence.filter((item): item is string => typeof item === "string") : [];
}

function provenanceOf(entry: WireObject, suffix: string): string {
  return `${stringMember(entry, "provenance") ?? "curated"}; ${suffix}`;
}

function markInstalled(entry: WireObject, reason: string, probed: boolean): WireObject {
  const operationStatus = entry.operationStatus === "unknown" ? { operationStatus: "probeNeeded" } : {};
  const evidence = [...new Set([...evidenceOf(entry), "installed", ...(probed ? ["probed"] : [])])];
  return { ...entry, availability: "available", ...operationStatus, evidence, provenance: provenanceOf(entry, reason) };
}

function clearUnproven(entry: WireObject): WireObject {
  return { ...entry, availability: "unknown", provenance: provenanceOf(entry, "availability not established (the base inventory is not an authoritative census)") };
}

function dispositionOf(entry: WireObject, rule: Disposition): "assumed" | "probed" | "cleared" | "untouched" {
  if (rule.assumeInstalled) return "assumed";
  const matchName = stringMember(entry, "matchName") ?? "";
  if (matchName && rule.proven.has(matchName)) return "probed";
  return entry.availability === "unavailable" && !rule.baseIsAuthoritative ? "cleared" : "untouched";
}

function updatedEntry(entry: WireObject, rule: Disposition): { entry: WireObject; kind: "assumed" | "probed" | "cleared" | "untouched" } {
  if (entry.kind !== "effect") return { entry, kind: "untouched" };
  const kind = dispositionOf(entry, rule);
  if (kind === "assumed") return { entry: markInstalled(entry, "assumed installed for this profile (--assume-installed)", false), kind };
  if (kind === "probed") return { entry: markInstalled(entry, `applied by the live verification matrix on ${rule.hostVersion}`, true), kind };
  return { entry: kind === "cleared" ? clearUnproven(entry) : entry, kind };
}

function updateEffectEntries(entries: readonly WireObject[], rule: Disposition): Tally {
  const tally: Tally = { entries: [], marked: 0, assumed: 0, cleared: 0 };
  for (const original of entries) {
    const { entry, kind } = updatedEntry(original, rule);
    tally.entries.push(entry);
    if (kind === "assumed") tally.assumed += 1;
    if (kind === "probed") tally.marked += 1;
    if (kind === "cleared") tally.cleared += 1;
  }
  return tally;
}

function availableEffectCount(entries: readonly WireObject[]): number {
  return entries.filter((entry) => entry.kind === "effect" && entry.availability === "available").length;
}

function seededInventory(census: FontCensusFile): FontInventory {
  const families = new Set(census.fonts.flatMap((font) => (font.family ? [font.family] : [])));
  return makeFontInventory(census.fonts, { completeness: "complete", totalReported: census.fonts.length, familiesReported: families.size });
}

function profileJson(profile: FixtureProfile, entries: readonly WireObject[], fontInventory: FontInventory | undefined): string {
  const { host, inventoryTruncated, inventoryCompleteness } = profile;
  return JSON.stringify({ entries, host, fontInventory, inventoryTruncated, inventoryCompleteness });
}

function readBaseProfile(directory: string): FixtureProfile {
  const basePath = join(directory, "host-capability-profile.json");
  if (!existsSync(basePath)) throw new Error(`No base profile at ${basePath}. Point --base at a profile directory that has one.`);
  const decoded = decodeJson(readFileSync(basePath, "utf8"), fixtureProfileOf);
  if (!decoded.ok) throw new Error("The base profile is not a bounded host profile.");
  return decoded.value;
}

/** Writes the base profile with the effects the reports prove marked installed, and says what changed. */
export function deriveHostProfile(request: DeriveRequest): DerivedProfile {
  const profile = readBaseProfile(request.base);
  const proven = effectsProvenApplied(request.reports.map((report): WireValue => report.value));
  const baseIsAuthoritative = inventoryIsAuthoritative({
    inventoryTruncated: profile.inventoryTruncated === true,
    ...(profile.inventoryCompleteness ? { inventoryCompleteness: profile.inventoryCompleteness } : {}),
  });
  const tally = updateEffectEntries(profile.entries, {
    assumeInstalled: request.assumeInstalled,
    proven,
    baseIsAuthoritative,
    hostVersion: hostVersionOf(profile),
  });
  const seeded = request.fonts ? seededInventory(request.fonts) : undefined;
  mkdirSync(request.out, { recursive: true });
  writeFileSync(join(request.out, "host-capability-profile.json"), profileJson(profile, tally.entries, seeded ?? profile.fontInventory), { mode: 0o600 });
  return {
    directory: request.out, hostKey: hostKeyOf(profile), proven: proven.size, total: profile.entries.filter((entry) => entry.kind === "effect").length,
    available: availableEffectCount(tally.entries), assumed: tally.assumed, cleared: tally.cleared, seededFonts: seeded?.items.length ?? 0,
    reports: request.reports.map((report) => report.path), ...derivationNote(tally),
  };
}
