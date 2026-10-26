// Keyset-paged queries over the definition tables: provenance, plugins, effects, parameters and the evidence behind a parameter.
import type { DatabaseSync } from "node:sqlite";
import { number, object } from "@extynt/decode";
import type { DefinitionDefault, DefinitionPage, DefinitionProvenance, EffectDefinition, EffectDefinitionQuery, ParameterDefinitionEvidence, ParameterDefinitionFactQuery, ParameterDefinitionQuery, ParameterDefinitionView, PluginDefinition, PluginDefinitionQuery } from "@extynt/project-graph";
import { selectAll, selectOne, selectValid } from "./graph-sql.js";
import { DEFINITION_ROW_INVALID, checkingDefinitionRows, definitionSource, effectDefinition, evidenceRow, parameterDefinition, pluginDefinition } from "./effect-definition-rows.js";
import type { EvidenceRow } from "./effect-definition-rows.js";
import { definitionLimit, definitionText } from "./effect-definition-validate.js";

const MAX_PAGE = 25;
const MAX_EVIDENCE_PAGE = 8;
const MAX_DEFAULT_COMPONENTS = 16;
const DEFAULT_COMPONENTS_SQL = `SELECT component,value FROM parameter_default_components WHERE parameter_definition_id=? AND provenance_id=? ORDER BY component LIMIT ${MAX_DEFAULT_COMPONENTS}`;
const defaultComponent = object({ component: number(), value: number() });

function cursorPage<T>(rows: T[], hasMore: boolean, identity: (row: T) => string): DefinitionPage<T> {
  const last = rows[rows.length - 1];
  return { rows, nextCursor: hasMore && last !== undefined ? identity(last) : null, writeAuthorizing: false };
}

function page<T>(selected: readonly T[], limit: number, identity: (row: T) => string): DefinitionPage<T> {
  return cursorPage(selected.slice(0, limit), selected.length > limit, identity);
}

/** The provenance record with this id, or undefined when none is stored; a stored record that does not fit throws GRAPH_DEFINITION_ROW_INVALID. */
export function getDefinitionProvenance(database: DatabaseSync, id: string): DefinitionProvenance | undefined {
  definitionText(id);
  return checkingDefinitionRows(() => selectOne(database, "SELECT * FROM definition_sources WHERE id=?", definitionSource, id));
}

/** One page of plugin definitions in id order, optionally only those with one native id; a stored plugin that does not fit is left out and counted. */
export function queryPluginDefinitions(database: DatabaseSync, query: PluginDefinitionQuery): DefinitionPage<PluginDefinition> {
  const limit = definitionLimit(query.limit, MAX_PAGE), cursor = query.cursor ?? "";
  if (query.nativeId === undefined) {
    return page(selectValid(database, "SELECT * FROM plugin_definitions WHERE id>? ORDER BY id LIMIT ?", pluginDefinition, cursor, limit + 1), limit, (row) => row.id);
  }
  definitionText(query.nativeId);
  return page(selectValid(database, "SELECT * FROM plugin_definitions WHERE native_id=? AND id>? ORDER BY id LIMIT ?", pluginDefinition, query.nativeId, cursor, limit + 1), limit, (row) => row.id);
}

/** One page of a host's effect definitions in id order, optionally only those with one match name; a stored effect that does not fit is left out and counted. */
export function queryEffectDefinitions(database: DatabaseSync, query: EffectDefinitionQuery): DefinitionPage<EffectDefinition> {
  definitionText(query.hostKey);
  const cursor = query.cursor ?? "", limit = definitionLimit(query.limit, MAX_PAGE);
  if (query.matchName === undefined) {
    return page(selectValid(database, "SELECT * FROM effect_definitions WHERE host_key=? AND id>? ORDER BY id LIMIT ?", effectDefinition, query.hostKey, cursor, limit + 1), limit, (row) => row.id);
  }
  definitionText(query.matchName);
  return page(selectValid(database, "SELECT * FROM effect_definitions WHERE host_key=? AND match_name=? AND id>? ORDER BY id LIMIT ?", effectDefinition, query.hostKey, query.matchName, cursor, limit + 1), limit, (row) => row.id);
}

/** One page of an effect's parameters in id order, each with its first page of evidence; a stored row of this effect that does not fit throws GRAPH_DEFINITION_ROW_INVALID. */
export function queryParameterDefinitions(database: DatabaseSync, query: ParameterDefinitionQuery): DefinitionPage<ParameterDefinitionView> {
  definitionText(query.effectDefinitionId);
  const limit = definitionLimit(query.limit, MAX_PAGE);
  const selected = checkingDefinitionRows(() => selectAll(database, "SELECT * FROM parameter_definitions WHERE effect_definition_id=? AND id>? ORDER BY id LIMIT ?", parameterDefinition, query.effectDefinitionId, query.cursor ?? "", limit + 1));
  const views = selected.slice(0, limit).map((parameter) => ({ parameter, facts: queryParameterDefinitionFacts(database, { parameterDefinitionId: parameter.id }) }));
  return cursorPage(views, selected.length > limit, (view) => view.parameter.id);
}

function knownDefault(shape: EvidenceRow["defaultShape"], values: readonly number[]): DefinitionDefault {
  const [first] = values;
  if (shape === "scalar" && values.length === 1 && first !== undefined) return { state: "known", value: first };
  if (shape === "vector" && values.length > 0) return { state: "known", value: [...values] };
  throw Error(DEFINITION_ROW_INVALID);
}

function readDefault(database: DatabaseSync, row: EvidenceRow): DefinitionDefault {
  if (row.defaultState === "unknown") return { state: "unknown" };
  const components = selectAll(database, DEFAULT_COMPONENTS_SQL, defaultComponent, row.facts.parameterDefinitionId, row.facts.provenanceId);
  const values = components.map((component, index) => {
    if (component.component !== index) throw Error(DEFINITION_ROW_INVALID);
    return component.value;
  });
  return knownDefault(row.defaultShape, values);
}

function evidenceOf(database: DatabaseSync, row: EvidenceRow): ParameterDefinitionEvidence {
  return { provenance: row.provenance, facts: { ...row.facts, defaultValue: readDefault(database, row) } };
}

/** One page of the evidence recorded for a parameter, in provenance-id order; a stored row that does not fit throws GRAPH_DEFINITION_ROW_INVALID. */
export function queryParameterDefinitionFacts(database: DatabaseSync, query: ParameterDefinitionFactQuery): DefinitionPage<ParameterDefinitionEvidence> {
  definitionText(query.parameterDefinitionId);
  const limit = definitionLimit(query.limit, MAX_EVIDENCE_PAGE);
  const sql = "SELECT f.*,s.id,s.kind,s.source_url,s.title,s.host_key,s.observed_at,s.observation_context,s.instance_binding FROM parameter_definition_facts f JOIN definition_sources s ON s.id=f.provenance_id WHERE f.parameter_definition_id=? AND f.provenance_id>? ORDER BY f.provenance_id LIMIT ?";
  return checkingDefinitionRows(() => {
    const selected = selectAll(database, sql, evidenceRow, query.parameterDefinitionId, query.cursor ?? "", limit + 1);
    return page(selected.map((row) => evidenceOf(database, row)), limit, (evidence) => evidence.provenance.id);
  });
}
