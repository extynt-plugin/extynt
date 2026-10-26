// Records what the catalogue probes on the test layer and reads it back as the control trees the host profile merges.
import type { DatabaseSync } from "node:sqlite";
import { fallback, nullable, number, object, string } from "@extynt/decode";
import type { Infer } from "@extynt/decode";
import type { EffectProbeEvidence, EffectProbeRow } from "@extynt/capability-catalogue";
import { freezeDeep } from "@extynt/project-graph";
import type { DefinitionProvenance } from "@extynt/project-graph";
import { effectControlDefinitions } from "./catalogue-controls.js";
import { evidenceCacheOf } from "./catalogue-evidence-cache.js";
import type { LatestSource } from "./catalogue-evidence-cache.js";
import type { CatalogueEffectResult } from "./catalogue-page.js";
import { INSTANCE_SOURCES, PROBE_SOURCES, definedEffectId, displayNamesOf, newestSource, observationSourceId, probedKeyList, sourceTable, writeObservation } from "./catalogue-sources.js";
import { readValid, selectAll, sqlFlag } from "./graph-sql.js";
import { numberOrNull } from "./native-page.js";

/** The title records what the observation covers: probing again is needed when any of it changes. Probes before "full tree" stopped at 96 rows and 3 levels and silently lost the rest of big effects, so they no longer count as probed and are collected again. */
export function catalogueProbeTitle(build: string | null, version: string | null): string {
  return `Native effect control probe (AE build ${build ?? "unknown"}; effect version ${version ?? "unversioned"}; full tree)`;
}

/** The `matchName\0title` key under which a probed effect counts as collected. */
export function catalogueProbeKey(matchName: string, build: string | null, version: string | null): string {
  return `${matchName}\0${catalogueProbeTitle(build, version)}`;
}

/** Which effects already have a runtime-probed control tree on this host, or one read from a project instance: `matchName\0title` keys, as a set the caller may change. */
export function catalogueProbedKeys(database: DatabaseSync, hostKey: string): Set<string> {
  return new Set(probedKeyList(database, hostKey));
}

/** One probed effect: which host and run probed it, when, and the control tree that came back. */
export interface CatalogueProbeWrite { hostKey: string; runId: string; observedAt: number; hostBuild: string | null; version: string | null; effect: CatalogueEffectResult }

/** One probed effect: its source (also the "probed" marker for effects with no controls), parameters, facts and the menu and layout extras. Throws on any invalid row; the caller's transaction rolls the effect back. */
export function writeCatalogueEffect(database: DatabaseSync, input: CatalogueProbeWrite): void {
  const { hostKey, runId, observedAt, hostBuild, version, effect } = input;
  const effectId = definedEffectId(database, input, effect.matchName);
  const sourceId = observationSourceId(PROBE_SOURCES, input, effect.matchName);
  const source: DefinitionProvenance = {
    id: sourceId, kind: "native-observation", sourceUrl: null, title: catalogueProbeTitle(hostBuild, version), hostKey, observedAt,
    observationContext: PROBE_SOURCES.context, instanceBinding: `${PROBE_SOURCES.prefix}${runId}:${effect.matchName}`,
  };
  writeObservation(database, source, effectControlDefinitions(effectId, sourceId, effect.controls));
}

function latestProbeSources(database: DatabaseSync, hostKey: string, only: ReadonlySet<string> | undefined): Map<string, LatestSource> {
  const newest = sourceTable(database, hostKey, PROBE_SOURCES).newest;
  return only ? new Map([...only].flatMap((name) => { const source = newest.get(name); return source ? [[name, source] as const] : []; })) : new Map(newest);
}

/** The newest probe source of one effect on this host, found without deriving the table of every effect. */
export function latestProbeSource(database: DatabaseSync, hostKey: string, matchName: string): LatestSource | undefined {
  return newestSource(database, hostKey, PROBE_SOURCES, matchName);
}

const parameterColumns = object({
  id: string(), match_name: string(), display_name: string(), parent_parameter_id: nullable(string()), ordinal: number(),
  value_type: string(), minimum: numberOrNull, maximum: numberOrNull, units: fallback(string({ nonEmpty: true }), null),
  default_shape: string(), can_vary: numberOrNull, is_group: sqlFlag, hidden: sqlFlag,
});
const componentRow = object({ parameter_definition_id: string(), value: number() });
const menuRow = object({ parameter_definition_id: string(), label: string() });

type ParameterColumns = Infer<typeof parameterColumns>;
interface ParameterRow extends ParameterColumns { menu: string[]; components: number[] }

const PARAMETERS_SQL = `SELECT p.id,p.match_name,p.display_name,p.parent_parameter_id,p.ordinal,f.value_type,f.minimum,f.maximum,f.units,f.default_shape,f.can_vary,COALESCE(u.is_group,0) AS is_group,COALESCE(u.hidden,0) AS hidden
  FROM parameter_definition_facts f JOIN parameter_definitions p ON p.id=f.parameter_definition_id LEFT JOIN parameter_definition_observed_ui u ON u.parameter_definition_id=f.parameter_definition_id AND u.provenance_id=f.provenance_id
  WHERE f.provenance_id=? ORDER BY p.ordinal,p.id`;
const COMPONENTS_SQL = "SELECT parameter_definition_id,value FROM parameter_default_components WHERE provenance_id=? ORDER BY parameter_definition_id,component";
const MENUS_SQL = "SELECT parameter_definition_id,label FROM parameter_definition_menu_items WHERE provenance_id=? ORDER BY parameter_definition_id,ordinal";

function parameterRows(database: DatabaseSync, sourceId: string): ParameterRow[] {
  const rows = selectAll(database, PARAMETERS_SQL, parameterColumns, sourceId).map((row): ParameterRow => ({ ...row, menu: [], components: [] }));
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const row of selectAll(database, COMPONENTS_SQL, componentRow, sourceId)) byId.get(row.parameter_definition_id)?.components.push(row.value);
  for (const row of selectAll(database, MENUS_SQL, menuRow, sourceId)) byId.get(row.parameter_definition_id)?.menu.push(row.label);
  return rows;
}

function rangeProbeFacts(row: ParameterRow): Pick<EffectProbeRow, "min" | "max" | "u"> {
  return { ...(row.minimum === null ? {} : { min: row.minimum }), ...(row.maximum === null ? {} : { max: row.maximum }), ...(row.units === null ? {} : { u: row.units }) };
}

function leafProbeRow(row: ParameterRow): EffectProbeRow {
  const value = row.default_shape === "scalar" ? row.components[0] : row.default_shape === "vector" ? row.components : undefined;
  return {
    m: row.match_name, n: row.display_name, t: row.value_type === "unknown" ? null : row.value_type, ...(value === undefined ? {} : { v: value }), ...rangeProbeFacts(row),
    ...(row.menu.length ? { dd: true, items: row.menu } : {}), ...(row.can_vary === 0 ? { static: true } : {}), ...(row.hidden ? { hid: true } : {}),
  };
}

function childrenByParent(rows: readonly ParameterRow[]): Map<string | null, ParameterRow[]> {
  const children = new Map<string | null, ParameterRow[]>();
  for (const row of rows) {
    const siblings = children.get(row.parent_parameter_id);
    if (siblings) siblings.push(row);
    else children.set(row.parent_parameter_id, [row]);
  }
  return children;
}

function visitRows(children: ReadonlyMap<string | null, ParameterRow[]>, parent: string | null, out: EffectProbeRow[]): void {
  for (const row of children.get(parent) ?? []) {
    if (!row.is_group) {
      out.push(leafProbeRow(row));
      continue;
    }
    out.push({ m: row.match_name, n: row.display_name, g: (children.get(row.id) ?? []).length });
    visitRows(children, row.id, out);
  }
}

function probeRows(rows: readonly ParameterRow[]): EffectProbeRow[] {
  const out: EffectProbeRow[] = [];
  visitRows(childrenByParent(rows), null, out);
  return out;
}

function controlTree(database: DatabaseSync, sourceId: string): EffectProbeRow[] {
  const trees = evidenceCacheOf(database).trees, known = trees.get(sourceId);
  if (known) return known;
  const built = freezeDeep(probeRows(parameterRows(database, sourceId)));
  trees.set(sourceId, built);
  return built;
}

function chosenSources(database: DatabaseSync, hostKey: string, only: readonly string[] | undefined): Map<string, LatestSource> {
  const wanted = only ? new Set(only) : undefined, chosen = latestProbeSources(database, hostKey, wanted);
  for (const [matchName, source] of sourceTable(database, hostKey, INSTANCE_SOURCES).newest) if (!chosen.has(matchName) && (!wanted || wanted.has(matchName))) chosen.set(matchName, source);
  return chosen;
}

/** The runtime-probed control trees for a host (factory-default probes, else project-instance reads, whose defaults stay unknown), in the probe-row shape the host profile already merges; an effect whose stored tree does not decode is left out and tallied, never the whole host. Nothing outside this host's own observations is read. */
export function readCatalogueEvidence(database: DatabaseSync, hostKey: string, only?: readonly string[]): EffectProbeEvidence {
  const display = displayNamesOf(database, hostKey), effects: EffectProbeEvidence["effects"] = {};
  const trees = readValid(database, [...chosenSources(database, hostKey, only)], ([matchName, source]) => [matchName, { name: display.get(matchName) ?? matchName, controls: controlTree(database, source.sourceId) }] as const);
  for (const [matchName, tree] of trees) effects[matchName] = tree;
  return { effects };
}
