// Decoders for the definition tables: every SQLite row becomes a project-graph definition type once, at the query boundary.
import { DecodeFailure, literal, map, nullable, number, object, string } from "@extynt/decode";
import type { Decoder, Infer } from "@extynt/decode";
import { NATIVE_PARAMETER_VALUE_TYPES } from "@extynt/project-graph";
import type { DefinitionProvenance, EffectDefinition, ParameterDefinition, ParameterDefinitionFacts, PluginDefinition } from "@extynt/project-graph";
import { sqlFlag } from "./graph-sql.js";

/** The error code thrown when a stored definition row does not fit its type. */
export const DEFINITION_ROW_INVALID = "GRAPH_DEFINITION_ROW_INVALID";

/** One stored definition is unusable; the rest of the store is not. Its message is DEFINITION_ROW_INVALID. */
export class DefinitionRowInvalid extends Error {
  constructor() { super(DEFINITION_ROW_INVALID); }
}

/** Runs an operation over the definition tables; a stored row that does not fit throws DefinitionRowInvalid instead of a decode failure. */
export function checkingDefinitionRows<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    throw error instanceof DecodeFailure ? new DefinitionRowInvalid() : error;
  }
}

const text = string();
const optionalText = nullable(text);
const optionalNumber = nullable(number());

const sourceColumns = {
  id: text,
  kind: literal("native-observation", "authored-documentation", "official-documentation"),
  source_url: optionalText,
  title: text,
  host_key: optionalText,
  observed_at: optionalNumber,
  observation_context: nullable(literal("factory-default", "property-metadata", "effect-inventory")),
  instance_binding: optionalText,
};

const factColumns = {
  parameter_definition_id: text,
  provenance_id: text,
  value_type: literal(...NATIVE_PARAMETER_VALUE_TYPES),
  units: optionalText,
  minimum: optionalNumber,
  maximum: optionalNumber,
  default_state: literal("unknown", "known"),
  default_shape: literal("unknown", "scalar", "vector"),
  documentation: optionalText,
  meaning: optionalText,
  can_vary: nullable(sqlFlag),
  can_expression: nullable(sqlFlag),
};

const sourceRow = object(sourceColumns);

function sourceOf(row: Infer<typeof sourceRow>): DefinitionProvenance {
  return { id: row.id, kind: row.kind, sourceUrl: row.source_url, title: row.title, hostKey: row.host_key, observedAt: row.observed_at, observationContext: row.observation_context, instanceBinding: row.instance_binding };
}

/** A definition source row as provenance. */
export const definitionSource: Decoder<DefinitionProvenance> = map(sourceRow, sourceOf);

/** A plugin definition row. */
export const pluginDefinition: Decoder<PluginDefinition> = map(
  object({ id: text, native_id: text, display_name: text, vendor: optionalText, version: optionalText, provenance_id: text }),
  (row) => ({ id: row.id, nativeId: row.native_id, displayName: row.display_name, vendor: row.vendor, version: row.version, provenanceId: row.provenance_id }),
);

/** An effect definition row. */
export const effectDefinition: Decoder<EffectDefinition> = map(
  object({ id: text, host_key: text, match_name: text, display_name: text, category: optionalText, version: optionalText, plugin_id: optionalText, provenance_id: text }),
  (row) => ({ id: row.id, hostKey: row.host_key, matchName: row.match_name, displayName: row.display_name, category: row.category, version: row.version, pluginId: row.plugin_id, provenanceId: row.provenance_id }),
);

/** A parameter definition row. */
export const parameterDefinition: Decoder<ParameterDefinition> = map(
  object({ id: text, effect_definition_id: text, match_name: text, path: text, display_name: text, parent_parameter_id: optionalText, ordinal: optionalNumber, provenance_id: text }),
  (row) => ({ id: row.id, effectDefinitionId: row.effect_definition_id, matchName: row.match_name, path: row.path, displayName: row.display_name, parentParameterId: row.parent_parameter_id, ordinal: row.ordinal, provenanceId: row.provenance_id }),
);

/** One fact row joined to its source: the facts that need no component query, and how the default is stored. */
export interface EvidenceRow {
  provenance: DefinitionProvenance;
  facts: Omit<ParameterDefinitionFacts, "defaultValue">;
  defaultState: "unknown" | "known";
  defaultShape: "unknown" | "scalar" | "vector";
}

/** A parameter fact row joined to its definition source. */
export const evidenceRow: Decoder<EvidenceRow> = map(
  object({ ...sourceColumns, ...factColumns }),
  (row) => ({
    provenance: sourceOf(row),
    defaultState: row.default_state,
    defaultShape: row.default_shape,
    facts: {
      parameterDefinitionId: row.parameter_definition_id, provenanceId: row.provenance_id, valueType: row.value_type, units: row.units, minimum: row.minimum, maximum: row.maximum,
      description: row.documentation, meaning: row.meaning, canVaryOverTime: row.can_vary, canSetExpression: row.can_expression,
    },
  }),
);
