// Turns a host census of installed effects into effect definitions, and keeps the fingerprint that says whether the stored ones are still current.
import { createHash } from "node:crypto";
import { number, object, string } from "@extynt/decode";
import type { DatabaseSync } from "node:sqlite";
import { effectDefinitionId, writeEffectDefinitions } from "./effect-definition-store.js";
import { execute, selectOne } from "./graph-sql.js";
import type { PresetInventory } from "@extynt/capability-catalogue";
import type { HostCensus } from "./server-types.js";
import { definitionInventoryRetentionBudget } from "./definition-retention.js";

const TEXT_LIMIT = 4096;
const fingerprintRow = object({ fingerprint: string() });
const totalRow = object({ total: number() });

type CensusEffect = HostCensus["result"]["installedEffects"][number];

function censusText(value: string | null | undefined): string {
  return value !== null && value !== undefined && value.length <= TEXT_LIMIT ? value : "";
}

function codeUnitOrder(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }

/** The host a census was read from, as `application:version:platform`. */
export function censusHostKey(census: HostCensus): string {
  const runtime = census.result.runtime;
  return `${runtime.application}:${runtime.appVersion}:${runtime.platform}`;
}

function writeCensusEffect(database: DatabaseSync, census: HostCensus, effect: CensusEffect, at: number): void {
  const hostKey = censusHostKey(census), version = censusText(effect.version) || null;
  const sourceId = createHash("sha256").update([hostKey, effect.matchName, version, at, census.result.completeness].join("\0")).digest("hex");
  const retention = definitionInventoryRetentionBudget(census.result.installedEffects.length);
  const source = { id: sourceId, kind: "native-observation" as const, sourceUrl: null, title: "Native installed effect inventory", hostKey, observedAt: at, observationContext: "effect-inventory" as const, instanceBinding: null };
  const definition = {
    id: effectDefinitionId(hostKey, effect.matchName, version), hostKey, matchName: effect.matchName, displayName: censusText(effect.displayName) || effect.matchName,
    category: censusText(effect.category) || null, version, pluginId: null, provenanceId: sourceId,
  };
  writeEffectDefinitions(database, { sources: [source], plugins: [], parameters: [], facts: [], effects: [definition] }, retention);
}

/** Writes an effect definition, with its provenance, for every effect the census reports installed. */
export function writeCensusDefinitions(database: DatabaseSync, census: HostCensus, at: number): void {
  for (const effect of census.result.installedEffects) writeCensusEffect(database, census, effect, at);
}

/** Identity of what the host reported installed: AE version and build plus every effect's matchName and version, order-independent. */
export function censusFingerprint(census: HostCensus): string {
  const runtime = census.result.runtime;
  const rows = census.result.installedEffects.map((effect) => [effect.matchName, censusText(effect.version)] as const).sort((a, b) => codeUnitOrder(a[0], b[0]) || codeUnitOrder(a[1], b[1]));
  return createHash("sha256").update(JSON.stringify([runtime.appVersion, runtime.buildNumber ?? null, rows])).digest("hex");
}

/** True only when the stored fingerprint matches AND the file still holds a definition for every reported effect, so a deleted or rebuilt file is never mistaken for a current one. */
export function censusDefinitionsCurrent(database: DatabaseSync, census: HostCensus, hostKey: string, fingerprint: string): boolean {
  const stored = selectOne(database, "SELECT fingerprint FROM catalogue_fingerprints WHERE host_key=?", fingerprintRow, hostKey);
  if (!stored || stored.fingerprint !== fingerprint || census.result.completeness === "failed") return false;
  const expected = new Set(census.result.installedEffects.map((effect) => effect.matchName)).size;
  const held = selectOne(database, "SELECT count(DISTINCT match_name) AS total FROM effect_definitions WHERE host_key=?", totalRow, hostKey);
  return (held?.total ?? Number.NaN) >= expected;
}

/** Remembers the fingerprint of the census whose definitions were just written. */
export function saveCensusFingerprint(database: DatabaseSync, hostKey: string, fingerprint: string, at: number): void {
  execute(database, "INSERT INTO catalogue_fingerprints VALUES(?,?,?) ON CONFLICT(host_key) DO UPDATE SET fingerprint=excluded.fingerprint,observed_at=excluded.observed_at", hostKey, fingerprint, at);
}

/** Records which effects the host reports installed, replacing what was stored for the same host and effect. */
export function writeInstalledEffects(database: DatabaseSync, census: HostCensus, at: number): void {
  const hostKey = censusHostKey(census);
  for (const effect of census.result.installedEffects) {
    execute(database, "INSERT INTO installed_effects VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(host_key,match_name) DO UPDATE SET display_name=excluded.display_name,category=excluded.category,version=excluded.version,installed=excluded.installed,observed_at=excluded.observed_at,completeness=excluded.completeness",
      hostKey, effect.matchName, censusText(effect.displayName), censusText(effect.category), censusText(effect.version), effect.available === undefined ? null : Number(effect.available), at, census.result.completeness);
  }
}

/** Records the presets found on the host, replacing what was stored for the same host and preset. */
export function savePresetInventory(database: DatabaseSync, hostKey: string, presets: PresetInventory): void {
  for (const preset of presets.items) {
    execute(database, "INSERT INTO presets VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(host_key,id) DO UPDATE SET name=excluded.name,category=excluded.category,root=excluded.root,stat_fingerprint=excluded.stat_fingerprint,scanned_at=excluded.scanned_at,truncated=excluded.truncated",
      hostKey, preset.id, preset.name, preset.category, preset.root, preset.statFingerprint, presets.scannedAt, Number(presets.truncated));
  }
}
