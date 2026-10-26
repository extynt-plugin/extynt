// Writes one observed control and the effect it belongs to: the definitions it implies, the instance rows and the current observation.
import { createHash } from "node:crypto";
import { object, string } from "@extynt/decode";
import type { DatabaseSync } from "node:sqlite";
import type { DefinitionProvenance, EffectDefinitionBundle } from "@extynt/project-graph";
import { effectDefinitionId, parameterDefinitionId, writeEffectDefinitions } from "./effect-definition-store.js";
import { nativeRelativePath } from "./effect-context.js";
import { graphFlag, numericComponents } from "./graph-record.js";
import { graphSql, returnedId, selectAll } from "./graph-sql.js";
import type { ControlEvidence, ControlObservation, EffectObservation } from "./graph-control-types.js";
import type { DefinitionRetentionBudget } from "./definition-retention.js";

const existingControl = object({ match_name: string(), relative_path: string() });
const UPSERT_EFFECT = `INSERT INTO effect_instances(project_id,composition_id,layer_id,effect_index,match_name,display_name,definition_id,enabled,item_index,layer_index,owner,epoch,revision,observed_at)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(project_id,composition_id,layer_id,effect_index,match_name) DO UPDATE SET display_name=excluded.display_name,definition_id=excluded.definition_id,
  enabled=excluded.enabled,item_index=excluded.item_index,layer_index=excluded.layer_index,owner=excluded.owner,epoch=excluded.epoch,revision=excluded.revision,observed_at=excluded.observed_at RETURNING id`;
const UPSERT_CURRENT = `INSERT INTO control_observations(control_id,observation_id,source_kind,owner,panel_instance_id,collection_session_id,epoch,revision,observed_at,native_type,minimum,maximum,units,units_source,value_state,shape,keyframe_count,is_time_varying,expression_enabled,expression_present,can_set_value,coverage)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(control_id) DO UPDATE SET observation_id=excluded.observation_id,source_kind=excluded.source_kind,owner=excluded.owner,panel_instance_id=excluded.panel_instance_id,
  collection_session_id=excluded.collection_session_id,epoch=excluded.epoch,revision=excluded.revision,observed_at=excluded.observed_at,native_type=excluded.native_type,minimum=excluded.minimum,maximum=excluded.maximum,
  units=excluded.units,units_source=excluded.units_source,value_state=excluded.value_state,shape=excluded.shape,keyframe_count=excluded.keyframe_count,is_time_varying=excluded.is_time_varying,
  expression_enabled=excluded.expression_enabled,expression_present=excluded.expression_present,can_set_value=excluded.can_set_value,coverage=excluded.coverage`;
const UPSERT_CONTROL = `INSERT INTO control_instances(effect_instance_id,match_name,relative_path,index_path,display_name,definition_id) VALUES(?,?,?,?,?,?)
  ON CONFLICT(effect_instance_id,relative_path,index_path) DO UPDATE SET match_name=excluded.match_name,display_name=excluded.display_name,definition_id=excluded.definition_id RETURNING id`;

/** Where and how a control observation is written: the database, the host it came from, its evidence and the definition retention budget. */
export interface ControlWrite { database: DatabaseSync; hostKey: string; evidence: ControlEvidence; retention?: DefinitionRetentionBudget }

function observationIdentity(evidence: ControlEvidence, identity: string): string {
  const context = evidence.context;
  return createHash("sha256").update([identity, context.owner, context.epoch, context.revision, evidence.at, evidence.sourceKind, evidence.session, evidence.proofReference ?? ""].join("\0")).digest("hex");
}

function sourceFor(input: ControlWrite, identity: string): DefinitionProvenance {
  return {
    id: observationIdentity(input.evidence, identity), kind: "native-observation", sourceUrl: null, title: "Bounded native property observation",
    hostKey: input.hostKey, observedAt: input.evidence.at, observationContext: "property-metadata", instanceBinding: identity,
  };
}

function nativeBinding(values: readonly (string | number)[]): string {
  return createHash("sha256").update(values.join("\0")).digest("hex");
}

function effectDefinition(input: ControlWrite, effect: EffectObservation, source: DefinitionProvenance): EffectDefinitionBundle {
  return {
    sources: [source], plugins: [], parameters: [], facts: [],
    effects: [{ id: effectDefinitionId(input.hostKey, effect.matchName, null), hostKey: input.hostKey, matchName: effect.matchName, displayName: effect.name, category: null, version: null, pluginId: null, provenanceId: source.id }],
  };
}

/** Records an observed effect on a layer, with its definition, and returns the instance id. */
export function writeEffectInstance(input: ControlWrite, effect: EffectObservation): number {
  const identity = nativeBinding([input.evidence.context.project, effect.compositionId, effect.layerId, effect.effectIndex, effect.matchName]), source = sourceFor(input, identity);
  const bundle = effectDefinition(input, effect, source), definition = bundle.effects[0];
  writeEffectDefinitions(input.database, bundle, input.retention);
  const evidence = input.evidence, context = evidence.context;
  return returnedId(
    input.database, UPSERT_EFFECT, context.project, effect.compositionId, effect.layerId, effect.effectIndex, effect.matchName, effect.name, definition?.id ?? null,
    graphFlag(effect.enabled), effect.itemIndex, effect.layerIndex, context.owner, context.epoch, context.revision, evidence.at,
  );
}

function writeControlDefinition(input: ControlWrite, observation: ControlObservation, effectId: string): string {
  const { effect, current } = observation;
  const identity = nativeBinding([input.evidence.context.project, effect.compositionId, effect.layerId, effect.effectIndex, observation.indexPath, observation.relativePath]), source = sourceFor(input, identity);
  const parameterId = parameterDefinitionId(effectId, observation.relativePath);
  writeEffectDefinitions(input.database, {
    sources: [source], plugins: [], effects: [],
    parameters: [{ id: parameterId, effectDefinitionId: effectId, matchName: observation.matchName, path: observation.relativePath, displayName: observation.name, parentParameterId: null, ordinal: null, provenanceId: source.id }],
    facts: [{
      parameterDefinitionId: parameterId, provenanceId: source.id, valueType: current.valueType, units: current.units, minimum: current.minimum, maximum: current.maximum,
      defaultValue: { state: "unknown" }, description: null, meaning: null, canVaryOverTime: observation.canVaryOverTime, canSetExpression: observation.canSetExpression,
    }],
  }, input.retention);
  return parameterId;
}

function writeComponents(database: DatabaseSync, control: number, values: readonly number[]): void {
  graphSql(database, "DELETE FROM control_observation_components WHERE control_id=?").run(control);
  const insert = graphSql(database, "INSERT INTO control_observation_components(control_id,component,value) VALUES(?,?,?)");
  values.forEach((value, component) => insert.run(control, component, value));
}

function writeCurrent(input: ControlWrite, control: number, observation: ControlObservation): string {
  const evidence = input.evidence, context = evidence.context, current = observation.current;
  const value = numericComponents(current.value), observationId = observationIdentity(evidence, String(control));
  graphSql(input.database, UPSERT_CURRENT).run(
    control, observationId, evidence.sourceKind, context.owner, evidence.panel, evidence.session, context.epoch, context.revision, evidence.at,
    current.valueType, current.minimum, current.maximum, current.units, current.units === null ? "unknown" : "native-observation", value.shape === "unknown" ? "unknown" : "observed-static", value.shape,
    current.keyframeCount, graphFlag(current.isTimeVarying), graphFlag(current.expressionEnabled), graphFlag(current.expressionPresent), graphFlag(current.canSetValue), observation.coverage,
  );
  writeComponents(input.database, control, value.values);
  return observationId;
}

function observedControlPath(input: ControlWrite, effect: number, observation: ControlObservation): ControlObservation {
  if (input.evidence.sourceKind === "descriptor-page" || !observation.indexPath) return observation;
  const rows = selectAll(input.database, "SELECT match_name,relative_path FROM control_instances WHERE effect_instance_id=? AND index_path=? LIMIT 2", existingControl, effect, observation.indexPath);
  const [existing] = rows;
  if (rows.length !== 1 || existing === undefined) return observation;
  if (existing.match_name !== observation.matchName || nativeRelativePath(existing.relative_path) !== nativeRelativePath(observation.relativePath)) return observation;
  return { ...observation, relativePath: existing.relative_path };
}

/** Records one observed control with its effect, definitions and current state; returns the control instance and observation ids. */
export function writeControlObservation(input: ControlWrite, observation: ControlObservation): { controlInstanceId: number; observationId: string } {
  const effect = writeEffectInstance(input, observation.effect), normalized = observedControlPath(input, effect, observation);
  const effectId = effectDefinitionId(input.hostKey, normalized.effect.matchName, null), definitionId = writeControlDefinition(input, normalized, effectId);
  const controlInstanceId = returnedId(input.database, UPSERT_CONTROL, effect, normalized.matchName, normalized.relativePath, normalized.indexPath, normalized.name, definitionId);
  return { controlInstanceId, observationId: writeCurrent(input, controlInstanceId, normalized) };
}
