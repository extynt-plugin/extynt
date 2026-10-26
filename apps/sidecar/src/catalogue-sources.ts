// The definition sources the catalogue records, probe or project instance: how they are named, written together with their menu and layout extras, and read back as tables derived once per database.
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { number, object, string } from "@extynt/decode";
import type { DefinitionProvenance } from "@extynt/project-graph";
import type { CatalogueEffectDefinitions } from "./catalogue-controls.js";
import { evidenceCacheOf, remembered, writingDefinitionRows } from "./catalogue-evidence-cache.js";
import type { LatestSource, SourceTable } from "./catalogue-evidence-cache.js";
import { effectDefinitionId, writeEffectDefinitions } from "./effect-definition-store.js";
import { execute, selectOne, selectValid } from "./graph-sql.js";

interface SourceKind { tag: "catalogue-probe" | "catalogue-instance"; prefix: string; context: "factory-default" | "property-metadata"; tieBreakById: boolean }

interface ObservationIdentity { hostKey: string; runId: string; observedAt: number; version: string | null }

/** Sources written by probing an effect on the test layer; their defaults are factory defaults. */
export const PROBE_SOURCES: SourceKind = { tag: "catalogue-probe", prefix: "catalogue-probe:", context: "factory-default", tieBreakById: true };

/** Sources written by reading an effect in the user's project; the structure and ranges After Effects reports, never factory defaults. */
export const INSTANCE_SOURCES: SourceKind = { tag: "catalogue-instance", prefix: "catalogue-instance:", context: "property-metadata", tieBreakById: false };

const sourceRow = object({ id: string(), instance_binding: string(), title: string(), observed_at: number() });
const presentRow = object({ present: number() });
const nameRow = object({ match_name: string(), display_name: string() });

function boundMatchName(kind: SourceKind, binding: string): string {
  const rest = binding.slice(kind.prefix.length), colon = rest.indexOf(":");
  return colon > 0 ? rest.slice(colon + 1) : "";
}

function newer(kind: SourceKind, candidate: LatestSource, known: LatestSource | undefined): boolean {
  if (!known || candidate.observedAt > known.observedAt) return true;
  return kind.tieBreakById && candidate.observedAt === known.observedAt && candidate.sourceId > known.sourceId;
}

function reduceSources(kind: SourceKind, database: DatabaseSync, hostKey: string): SourceTable {
  const sql = `SELECT id,instance_binding,title,observed_at FROM definition_sources WHERE kind='native-observation' AND observation_context='${kind.context}' AND host_key=? AND instance_binding LIKE '${kind.prefix}%'`;
  const newest = new Map<string, LatestSource>(), keys: string[] = [];
  for (const row of selectValid(database, sql, sourceRow, hostKey)) {
    const matchName = boundMatchName(kind, row.instance_binding);
    if (!matchName) continue;
    keys.push(`${matchName}\0${row.title}`);
    const candidate = { sourceId: row.id, observedAt: row.observed_at };
    if (newer(kind, candidate, newest.get(matchName))) newest.set(matchName, candidate);
  }
  return { newest, keys };
}

function likeLiteral(text: string): string {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}

const EFFECT_SOURCES_SQL = "SELECT id,instance_binding,title,observed_at FROM definition_sources WHERE kind='native-observation' AND observation_context=? AND host_key=? AND instance_binding LIKE ? ESCAPE '\\'";

/** The newest source of one effect of this kind on this host: read from the derived table when it exists, else with a query for that effect alone, so asking about one effect never builds the host-wide table. */
export function newestSource(database: DatabaseSync, hostKey: string, kind: SourceKind, matchName: string): LatestSource | undefined {
  const cache = evidenceCacheOf(database), derived = (kind.tag === "catalogue-probe" ? cache.probeSources : cache.instanceSources).get(hostKey);
  if (derived) return derived.newest.get(matchName);
  let newest: LatestSource | undefined;
  for (const row of selectValid(database, EFFECT_SOURCES_SQL, sourceRow, kind.context, hostKey, `${likeLiteral(kind.prefix)}%:${likeLiteral(matchName)}`)) {
    const candidate = { sourceId: row.id, observedAt: row.observed_at };
    if (boundMatchName(kind, row.instance_binding) === matchName && newer(kind, candidate, newest)) newest = candidate;
  }
  return newest;
}

/** The newest source of each effect of this kind on this host, with the key of every source, derived once until the definition rows next change. */
export function sourceTable(database: DatabaseSync, hostKey: string, kind: SourceKind): SourceTable {
  const cache = evidenceCacheOf(database);
  return remembered(kind.tag === "catalogue-probe" ? cache.probeSources : cache.instanceSources, hostKey, () => reduceSources(kind, database, hostKey));
}

/** The `matchName\0title` keys of effects already probed, or read from a project instance, on this host; derived once until the definition rows next change. */
export function probedKeyList(database: DatabaseSync, hostKey: string): readonly string[] {
  return remembered(evidenceCacheOf(database).probedKeys, hostKey, () => [...sourceTable(database, hostKey, PROBE_SOURCES).keys, ...sourceTable(database, hostKey, INSTANCE_SOURCES).keys]);
}

/** The display name of each effect defined on this host, derived once until the definition rows next change. */
export function displayNamesOf(database: DatabaseSync, hostKey: string): ReadonlyMap<string, string> {
  return remembered(evidenceCacheOf(database).displayNames, hostKey, () => {
    const rows = selectValid(database, "SELECT match_name,display_name FROM effect_definitions WHERE host_key=? ORDER BY match_name", nameRow, hostKey);
    return new Map(rows.map((row) => [row.match_name, row.display_name]));
  });
}

/** The id of the effect definition an observation is for; throws when the census never defined it. */
export function definedEffectId(database: DatabaseSync, identity: ObservationIdentity, matchName: string): string {
  const effectId = effectDefinitionId(identity.hostKey, matchName, identity.version);
  if (!selectOne(database, "SELECT 1 AS present FROM effect_definitions WHERE id=?", presentRow, effectId)) throw Error("GRAPH_CATALOGUE_EFFECT_MISSING");
  return effectId;
}

/** The id of one run's source for one effect: a digest of everything that names it, so a rewrite of the same run and time lands on the same source. */
export function observationSourceId(kind: SourceKind, identity: ObservationIdentity, matchName: string): string {
  return createHash("sha256").update([kind.tag, identity.hostKey, matchName, identity.version ?? "", identity.runId, String(identity.observedAt)].join("\0")).digest("hex");
}

function writeExtras(database: DatabaseSync, sourceId: string, definitions: CatalogueEffectDefinitions): void {
  for (const extra of definitions.extras) {
    execute(database, "INSERT OR REPLACE INTO parameter_definition_observed_ui VALUES(?,?,?,?)", extra.parameterDefinitionId, sourceId, Number(extra.isGroup), extra.hidden === null ? null : Number(extra.hidden));
    execute(database, "DELETE FROM parameter_definition_menu_items WHERE parameter_definition_id=? AND provenance_id=?", extra.parameterDefinitionId, sourceId);
    extra.menu.forEach((label, index) => execute(database, "INSERT INTO parameter_definition_menu_items VALUES(?,?,?,?)", extra.parameterDefinitionId, sourceId, index + 1, label));
  }
}

/** Writes one observation: the source, its parameters and facts through the definition store, then the menu and layout extras. Throws on any invalid row; the caller's transaction rolls the effect back. */
export function writeObservation(database: DatabaseSync, source: DefinitionProvenance, definitions: CatalogueEffectDefinitions): void {
  writingDefinitionRows(database, () => {
    writeEffectDefinitions(database, { sources: [source], plugins: [], effects: [], parameters: definitions.parameters, facts: definitions.facts });
    writeExtras(database, source.id, definitions);
  });
}
