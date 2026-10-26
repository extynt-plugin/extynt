// Reads controls back from the graph: one control by id and observation, or a bounded page of the controls on a layer, each with its freshness.
import { NATIVE_PARAMETER_VALUE_TYPES } from "@extynt/project-graph";
import { absentAs, decodeOrThrow, fallback, literal, number, object, string, wireJson } from "@extynt/decode";
import type { Infer, JsonObject } from "@extynt/decode";
import type { DatabaseSync } from "node:sqlite";
import { readValid, selectAll, selectOne, selectValid, sqlFlag } from "./graph-sql.js";
import { liveCurrent } from "./graph-freshness.js";
import { DEFINITION_ROW_INVALID, DefinitionRowInvalid } from "./effect-definition-rows.js";
import { queryParameterDefinitionFacts } from "./effect-definition-store.js";
import { countOrNull, numberOrNull, textOr } from "./native-page.js";
import type { ControlBinding, CurrentControl, GraphContext } from "./graph-control-types.js";

const CONTROL_SELECT = `SELECT c.id AS control_id,c.match_name AS control_match_name,c.relative_path,c.index_path,c.display_name AS control_name,c.definition_id AS parameter_definition_id,
 e.project_id,e.composition_id,e.layer_id,e.effect_index,e.match_name AS effect_match_name,e.definition_id AS effect_definition_id,e.enabled,e.item_index,e.layer_index,
 o.* FROM control_instances c JOIN effect_instances e ON e.id=c.effect_instance_id JOIN control_observations o ON o.control_id=c.id`;
const QUERY_CONTROLS = `${CONTROL_SELECT} WHERE e.project_id=? AND e.composition_id=? AND e.layer_id=? AND c.id>? AND (?='' OR e.match_name=?) AND (?='' OR c.match_name=?) AND (?=0 OR c.id=?) AND (?=0 OR e.effect_index=?) ORDER BY c.id LIMIT ?`;
const flag = fallback(sqlFlag, null);
const controlRow = object({
  control_id: number(), control_match_name: textOr(""), relative_path: textOr(""), index_path: textOr(""),
  parameter_definition_id: textOr(""), effect_definition_id: textOr(""), composition_id: textOr(""), layer_id: textOr(""),
  effect_index: number(), effect_match_name: textOr(""), item_index: countOrNull, layer_index: countOrNull,
  observation_id: textOr(""), panel_instance_id: textOr(""), collection_session_id: textOr(""), source_kind: string(), coverage: string(),
  owner: string(), epoch: number(), revision: countOrNull, observed_at: number(), units_source: string(),
  native_type: absentAs(literal(...NATIVE_PARAMETER_VALUE_TYPES), "unknown" as const), minimum: numberOrNull, maximum: numberOrNull,
  units: fallback(string(), null), value_state: string(), shape: string(), keyframe_count: countOrNull,
  is_time_varying: flag, expression_enabled: flag, expression_present: flag, can_set_value: flag,
});
const componentRow = object({ value: number() });

type ControlRow = Infer<typeof controlRow>;

interface StoredIdentity { observedAt: number; owner: string; epoch: number; revision: number | null }

/** The control a caller names by id and the observation it was read from. */
export interface ControlResolve { controlInstanceId: number; observationId: string }

/** A bounded page of the controls on one layer, optionally narrowed to one effect or control. */
export interface ControlQuery {
  compositionId: string; layerId: string; effectMatchName: string | undefined; effectIndex: number | undefined;
  controlMatchName: string | undefined; controlInstanceId: number | undefined; cursor: string | undefined; limit: number | undefined;
}

/** Whether a stored observation is current for the active context: observed, stale, or unknown when either side has no revision. */
export function graphFreshness(row: StoredIdentity, context: GraphContext, now: number): "observed" | "stale" | "unknown" {
  if (row.revision === null || context.revision === null) return "unknown";
  const identity = row.owner === context.owner && row.epoch === context.epoch && row.revision === context.revision;
  return identity && liveCurrent(now - row.observedAt, context.liveAt, now) ? "observed" : "stale";
}

function readComponents(database: DatabaseSync, row: ControlRow): number | number[] | null {
  const values = selectAll(database, "SELECT value FROM control_observation_components WHERE control_id=? ORDER BY component", componentRow, row.control_id).map((component) => component.value);
  if (row.value_state !== "observed-static") return null;
  return row.shape === "scalar" ? values[0] ?? null : values;
}

function currentControl(database: DatabaseSync, row: ControlRow): CurrentControl {
  return {
    valueType: row.native_type, value: readComponents(database, row), minimum: row.minimum, maximum: row.maximum, units: row.units,
    keyframeCount: row.keyframe_count, expressionEnabled: row.expression_enabled, expressionPresent: row.expression_present,
    isTimeVarying: row.is_time_varying, canSetValue: row.can_set_value,
  };
}

function controlBinding(database: DatabaseSync, row: ControlRow, context: GraphContext, now: number): ControlBinding {
  const current = currentControl(database, row);
  return {
    state: graphFreshness({ observedAt: row.observed_at, owner: row.owner, epoch: row.epoch, revision: row.revision }, context, now),
    controlInstanceId: row.control_id, observationId: row.observation_id, parameterDefinitionId: row.parameter_definition_id || null, effectDefinitionId: row.effect_definition_id || null,
    panelInstanceId: row.panel_instance_id, collectionSessionId: row.collection_session_id, observedAt: row.observed_at, stamp: { epoch: row.epoch, revision: row.revision },
    address: {
      compositionId: row.composition_id, layerId: row.layer_id, itemIndex: row.item_index, layerIndex: row.layer_index, effectIndex: row.effect_index,
      effectMatchName: row.effect_match_name, controlMatchName: row.control_match_name, propertyPath: `ADBE Effect Parade/${row.effect_match_name}/${row.relative_path}`,
    },
    current, unknowns: Object.entries(current).filter(([, value]) => value === null).map(([field]) => field),
    unitProvenance: { kind: row.units_source, observationId: row.observation_id, collectionSessionId: row.collection_session_id, semanticMeaning: "unknown" },
    nativePropertyIndices: row.index_path.split("/").filter(Boolean).map(Number), sourceKind: row.source_kind,
    coverage: { fields: row.coverage, dependencyClosure: "unknown", absentOutsidePage: "unknown", deletionReconciliation: "not-established" }, writeAuthorizing: false,
  };
}

/** The control a caller names by id and observation, or undefined when that observation is no longer the stored one. */
export function resolveCurrentControl(database: DatabaseSync, input: ControlResolve, context: GraphContext, now: number): ControlBinding | undefined {
  if (!Number.isSafeInteger(input.controlInstanceId) || input.controlInstanceId < 1 || !/^[a-f0-9]{64}$/.test(input.observationId)) throw Error("GRAPH_CONTROL_QUERY_INVALID");
  const row = selectOne(database, `${CONTROL_SELECT} WHERE e.project_id=? AND c.id=? AND o.observation_id=?`, controlRow, context.project, input.controlInstanceId, input.observationId);
  return row && controlBinding(database, row, context, now);
}

function controlCursor(value: string | undefined): number {
  if (value === undefined) return 0;
  const parsed = Number(value);
  if (!/^[0-9]+$/.test(value) || !Number.isSafeInteger(parsed)) throw Error("GRAPH_CONTROL_QUERY_INVALID");
  return parsed;
}

function withDefinitionFacts(database: DatabaseSync, binding: ControlBinding): JsonObject {
  const parameter = binding.parameterDefinitionId;
  if (!parameter) return { ...binding, definitionFacts: { rows: [], nextCursor: null, writeAuthorizing: false } };
  try { return { ...binding, definitionFacts: decodeOrThrow(wireJson, queryParameterDefinitionFacts(database, { parameterDefinitionId: parameter, limit: 8 })) }; }
  catch (error) {
    if (!(error instanceof DefinitionRowInvalid)) throw error;
    return { ...binding, definitionFacts: { state: "unknown", code: DEFINITION_ROW_INVALID, writeAuthorizing: false } };
  }
}

function controlFilter(input: ControlQuery): { effect: string; control: string; id: number; index: number } {
  return { effect: input.effectMatchName ?? "", control: input.controlMatchName ?? "", id: input.controlInstanceId ?? 0, index: input.effectIndex ?? 0 };
}

/** A bounded page of the controls on a layer with their definition facts; `nextCursor` continues the page. */
export function queryCurrentControls(database: DatabaseSync, input: ControlQuery, context: GraphContext, now: number): JsonObject {
  const limit = Math.max(1, Math.min(25, input.limit ?? 25)), cursor = controlCursor(input.cursor);
  const { effect, control, id, index } = controlFilter(input);
  const selected = selectValid(database, QUERY_CONTROLS, controlRow, context.project, input.compositionId, input.layerId, cursor, effect, effect, control, control, id, id, index, index, limit + 1);
  const rows = readValid(database, selected.slice(0, limit), (row) => withDefinitionFacts(database, controlBinding(database, row, context, now)));
  return {
    state: rows.length ? "retained" : "unknown", rows, nextCursor: selected.length > limit ? String(selected[limit - 1]?.control_id) : null, writeAuthorizing: false,
    coverage: { scope: "bounded-typed-observations", currentMirror: "not-established", absentOutsidePage: "unknown", dependencyClosure: "unknown", deletionReconciliation: "not-established" },
  };
}
