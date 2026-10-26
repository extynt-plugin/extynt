// Writes an effect-definition bundle (sources, plugins, effects, parameters, facts) inside the caller's transaction, enforcing identity and provenance rules.
import type { DatabaseSync } from "node:sqlite";
import { nullable, object, string } from "@extynt/decode";
import type { DefinitionDefault, DefinitionProvenance, EffectDefinition, EffectDefinitionBundle, ParameterDefinition, ParameterDefinitionFacts, PluginDefinition } from "@extynt/project-graph";
import { writingDefinitionRows } from "./catalogue-evidence-cache.js";
import { execute, selectOne } from "./graph-sql.js";
import { checkingDefinitionRows, definitionSource } from "./effect-definition-rows.js";
import { effectDefinitionId, escapeParameterSegment, parameterDefinitionId } from "./effect-definition-identity.js";
import { definitionNullableText, definitionText, validateDefinitionFacts, validateDefinitionSource } from "./effect-definition-validate.js";
import { definitionSourceReplacements, retainDefinitionHistory } from "./definition-retention.js";
import type { DefinitionRetentionBudget, SourceReplacement } from "./definition-retention.js";

const IDENTITY_INVALID = "GRAPH_DEFINITION_IDENTITY_INVALID";
const PROVENANCE_INVALID = "GRAPH_DEFINITION_PROVENANCE_INVALID";
const MAX_PATH_SEGMENTS = 16;
const SIBLING_SUFFIX = /#(?:[2-9]|[1-9][0-9]+)$/;
const SOURCE_KEYS = ["id", "kind", "sourceUrl", "title", "hostKey", "observedAt", "observationContext", "instanceBinding"] as const satisfies readonly (keyof DefinitionProvenance)[];

const SOURCE_BY_ID_SQL = "SELECT * FROM definition_sources WHERE id=?";
const INSERT_SOURCE_SQL = "INSERT INTO definition_sources(id,kind,source_url,title,host_key,observed_at,observation_context,instance_binding) VALUES(?,?,?,?,?,?,?,?)";
const PLUGIN_NATIVE_ID_SQL = "SELECT native_id FROM plugin_definitions WHERE id=?";
const UPSERT_PLUGIN_SQL = "INSERT INTO plugin_definitions VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,vendor=excluded.vendor,version=excluded.version,provenance_id=excluded.provenance_id";
const UPSERT_EFFECT_SQL = "INSERT INTO effect_definitions VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,category=excluded.category,plugin_id=excluded.plugin_id,provenance_id=excluded.provenance_id";
const UPSERT_PARAMETER_SQL = "INSERT INTO parameter_definitions VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,parent_parameter_id=excluded.parent_parameter_id,ordinal=excluded.ordinal,provenance_id=excluded.provenance_id";
const UPSERT_FACTS_SQL = "INSERT INTO parameter_definition_facts VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(parameter_definition_id,provenance_id) DO UPDATE SET value_type=excluded.value_type,units=excluded.units,minimum=excluded.minimum,maximum=excluded.maximum,default_state=excluded.default_state,default_shape=excluded.default_shape,documentation=excluded.documentation,meaning=excluded.meaning,can_vary=excluded.can_vary,can_expression=excluded.can_expression";
const DELETE_COMPONENTS_SQL = "DELETE FROM parameter_default_components WHERE parameter_definition_id=? AND provenance_id=?";
const INSERT_COMPONENT_SQL = "INSERT INTO parameter_default_components VALUES(?,?,?,?)";
const EFFECT_HOST_OF_PARAMETER_SQL = "SELECT host_key FROM effect_definitions WHERE id=?";
const EFFECT_HOST_OF_FACTS_SQL = "SELECT e.host_key FROM parameter_definitions p JOIN effect_definitions e ON e.id=p.effect_definition_id WHERE p.id=?";
const SOURCE_HOST_SQL = "SELECT host_key FROM definition_sources WHERE id=?";
const PLUGIN_PROVENANCE_SQL = "SELECT provenance_id FROM plugin_definitions WHERE id=?";
const PARENT_PARAMETER_SQL = "SELECT effect_definition_id,path FROM parameter_definitions WHERE id=?";

const nativeIdRow = object({ native_id: string() });
const hostKeyRow = object({ host_key: string() });
const sourceHostRow = object({ host_key: nullable(string()) });
const provenanceIdRow = object({ provenance_id: string() });
const parentRow = object({ effect_definition_id: string(), path: string() });

function saveSource(database: DatabaseSync, source: DefinitionProvenance): void {
  validateDefinitionSource(source);
  const stored = selectOne(database, SOURCE_BY_ID_SQL, definitionSource, source.id);
  if (stored) {
    if (SOURCE_KEYS.some((key) => stored[key] !== source[key])) throw Error("GRAPH_DEFINITION_SOURCE_CONFLICT");
    return;
  }
  execute(database, INSERT_SOURCE_SQL, source.id, source.kind, source.sourceUrl, source.title, source.hostKey, source.observedAt, source.observationContext, source.instanceBinding);
}

function savePlugin(database: DatabaseSync, plugin: PluginDefinition): void {
  [plugin.id, plugin.nativeId, plugin.displayName, plugin.provenanceId].forEach(definitionText);
  definitionNullableText(plugin.vendor); definitionNullableText(plugin.version);
  const existing = selectOne(database, PLUGIN_NATIVE_ID_SQL, nativeIdRow, plugin.id);
  if (existing && existing.native_id !== plugin.nativeId) throw Error(IDENTITY_INVALID);
  execute(database, UPSERT_PLUGIN_SQL, plugin.id, plugin.nativeId, plugin.displayName, plugin.vendor, plugin.version, plugin.provenanceId);
}

function assertSourceHost(database: DatabaseSync, sourceId: string, hostKey: string): void {
  const source = selectOne(database, SOURCE_HOST_SQL, sourceHostRow, sourceId);
  if (!source || (source.host_key !== null && source.host_key !== hostKey)) throw Error(PROVENANCE_INVALID);
}

function assertPluginHost(database: DatabaseSync, pluginId: string | null, hostKey: string): void {
  if (pluginId === null) return;
  const plugin = selectOne(database, PLUGIN_PROVENANCE_SQL, provenanceIdRow, pluginId);
  if (!plugin) throw Error(IDENTITY_INVALID);
  assertSourceHost(database, plugin.provenance_id, hostKey);
}

function saveEffect(database: DatabaseSync, effect: EffectDefinition): void {
  [effect.id, effect.hostKey, effect.matchName, effect.displayName, effect.provenanceId].forEach(definitionText);
  [effect.category, effect.version, effect.pluginId].forEach(definitionNullableText);
  assertSourceHost(database, effect.provenanceId, effect.hostKey);
  assertPluginHost(database, effect.pluginId, effect.hostKey);
  if (effect.id !== effectDefinitionId(effect.hostKey, effect.matchName, effect.version)) throw Error(IDENTITY_INVALID);
  execute(database, UPSERT_EFFECT_SQL, effect.id, effect.hostKey, effect.matchName, effect.displayName, effect.category, effect.version, effect.pluginId, effect.provenanceId);
}

function parameterNativeName(segment: string): string {
  const plain = segment.replace(SIBLING_SUFFIX, "");
  let native: string;
  try { native = decodeURIComponent(plain); }
  catch { throw Error(IDENTITY_INVALID); }
  if (escapeParameterSegment(native) !== plain) throw Error(IDENTITY_INVALID);
  return native;
}

function assertParameterPath(database: DatabaseSync, parameter: ParameterDefinition): void {
  const parts = parameter.path.split("/");
  if (parts.length > MAX_PATH_SEGMENTS || parts.some((part) => part.length === 0) || parts.map(parameterNativeName).at(-1) !== parameter.matchName) throw Error(IDENTITY_INVALID);
  if (parameter.parentParameterId === null) return;
  const parent = selectOne(database, PARENT_PARAMETER_SQL, parentRow, parameter.parentParameterId);
  if (!parent || parent.effect_definition_id !== parameter.effectDefinitionId || parent.path !== parts.slice(0, -1).join("/")) throw Error(IDENTITY_INVALID);
}

function saveParameter(database: DatabaseSync, parameter: ParameterDefinition): void {
  [parameter.id, parameter.effectDefinitionId, parameter.matchName, parameter.path, parameter.displayName, parameter.provenanceId].forEach(definitionText);
  definitionNullableText(parameter.parentParameterId);
  assertParameterPath(database, parameter);
  const effect = selectOne(database, EFFECT_HOST_OF_PARAMETER_SQL, hostKeyRow, parameter.effectDefinitionId);
  if (!effect) throw Error(IDENTITY_INVALID);
  assertSourceHost(database, parameter.provenanceId, effect.host_key);
  if (parameter.id !== parameterDefinitionId(parameter.effectDefinitionId, parameter.path)) throw Error(IDENTITY_INVALID);
  if (parameter.ordinal !== null && (!Number.isSafeInteger(parameter.ordinal) || parameter.ordinal < 1)) throw Error("GRAPH_DEFINITION_INVALID");
  execute(database, UPSERT_PARAMETER_SQL, parameter.id, parameter.effectDefinitionId, parameter.matchName, parameter.path, parameter.displayName, parameter.parentParameterId, parameter.ordinal, parameter.provenanceId);
}

function storedDefault(value: DefinitionDefault): { shape: "unknown" | "scalar" | "vector"; components: readonly number[] } {
  if (value.state === "unknown") return { shape: "unknown", components: [] };
  return Array.isArray(value.value) ? { shape: "vector", components: value.value } : { shape: "scalar", components: [value.value] };
}

function flagNumber(value: boolean | null): number | null { return value === null ? null : Number(value); }

function writeFacts(database: DatabaseSync, facts: ParameterDefinitionFacts): void {
  const { shape, components } = storedDefault(facts.defaultValue);
  execute(database, UPSERT_FACTS_SQL, facts.parameterDefinitionId, facts.provenanceId, facts.valueType, facts.units, facts.minimum, facts.maximum, facts.defaultValue.state, shape, facts.description, facts.meaning, flagNumber(facts.canVaryOverTime), flagNumber(facts.canSetExpression));
  execute(database, DELETE_COMPONENTS_SQL, facts.parameterDefinitionId, facts.provenanceId);
  components.forEach((component, index) => execute(database, INSERT_COMPONENT_SQL, facts.parameterDefinitionId, facts.provenanceId, index, component));
}

function saveFacts(database: DatabaseSync, facts: ParameterDefinitionFacts): void {
  const source = selectOne(database, SOURCE_BY_ID_SQL, definitionSource, facts.provenanceId);
  if (!source) throw Error(PROVENANCE_INVALID);
  validateDefinitionFacts(facts, source);
  const effect = selectOne(database, EFFECT_HOST_OF_FACTS_SQL, hostKeyRow, facts.parameterDefinitionId);
  if (!effect) throw Error(IDENTITY_INVALID);
  assertSourceHost(database, facts.provenanceId, effect.host_key);
  writeFacts(database, facts);
}

function writeBundle(database: DatabaseSync, bundle: EffectDefinitionBundle, retention: DefinitionRetentionBudget | undefined): void {
  const replacements: readonly SourceReplacement[] = definitionSourceReplacements(database, bundle, retention);
  for (const source of bundle.sources) saveSource(database, source);
  for (const plugin of bundle.plugins) savePlugin(database, plugin);
  for (const effect of bundle.effects) saveEffect(database, effect);
  for (const parameter of bundle.parameters) saveParameter(database, parameter);
  for (const facts of bundle.facts) saveFacts(database, facts);
  retainDefinitionHistory(database, bundle, replacements, retention);
}

/** Writes the whole bundle in dependency order inside the caller's transaction and prunes superseded history when a retention budget is given; a stored row that does not fit throws GRAPH_DEFINITION_ROW_INVALID. */
export function writeEffectDefinitions(database: DatabaseSync, bundle: EffectDefinitionBundle, retention?: DefinitionRetentionBudget): void {
  writingDefinitionRows(database, () => checkingDefinitionRows(() => writeBundle(database, bundle, retention)));
}
