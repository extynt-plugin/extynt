// Writes the lifecycle of a requested control change: prepared against an observation, bound to a native ticket, or invalidated.
import type { JsonObject } from "@extynt/decode";
import { object, string } from "@extynt/decode";
import type { DatabaseSync } from "node:sqlite";
import { execute, selectOne } from "./graph-sql.js";
import { desiredRow } from "./graph-desired-row.js";
import type { DesiredRow } from "./graph-desired-row.js";
import { numericComponents } from "./graph-record.js";
import type { NumericComponents } from "./graph-record.js";
import type { ControlBinding, DesiredApplyInput, DesiredParameterInput } from "./graph-control-types.js";

const MAX_TOKEN = 128;
const ownerRow = object({ owner: string() });
const INSERT_REQUEST = `INSERT INTO desired_control_requests(plan_id,control_id,source_observation_id,source_owner,source_panel_instance_id,source_session_id,source_epoch,source_revision,requested_at,status,shape)
  VALUES(?,?,?,?,?,?,?,?,?,'prepared',?)`;

function plainScalar(current: ControlBinding["current"]): boolean {
  return current.valueType === "OneD" && typeof current.value === "number" && current.keyframeCount === 0;
}

function literalAssignment(current: ControlBinding["current"]): boolean {
  return current.expressionEnabled === false && current.expressionPresent === false && current.isTimeVarying === false && current.canSetValue === true;
}

function requireLiteral(binding: ControlBinding): void {
  if (binding.state !== "observed" || binding.stamp.revision === null) throw Error("GRAPH_CONTROL_STALE");
  if (!plainScalar(binding.current) || !literalAssignment(binding.current)) throw Error("GRAPH_CONTROL_UNSUPPORTED");
}

function requireDesiredValue(binding: ControlBinding, input: DesiredParameterInput): NumericComponents {
  const value = numericComponents(input.value), { minimum, maximum } = binding.current, [first] = value.values;
  if (value.shape !== "scalar" || first === undefined || minimum === null || maximum === null) throw Error("GRAPH_DESIRED_VALUE_INVALID");
  if (first < minimum || first > maximum) throw Error("GRAPH_DESIRED_VALUE_INVALID");
  return value;
}

/** Records a prepared request for a new value of the observed control; a stale, unsupported or out-of-range request throws its code. */
export function writeDesiredParameter(database: DatabaseSync, input: DesiredParameterInput, binding: ControlBinding, at: number): void {
  requireLiteral(binding);
  if (!input.planId || input.planId.length > MAX_TOKEN || binding.observationId !== input.sourceObservationId) throw Error("GRAPH_DESIRED_IDENTITY_INVALID");
  const value = requireDesiredValue(binding, input);
  const source = selectOne(database, "SELECT owner FROM control_observations WHERE control_id=? AND observation_id=?", ownerRow, input.controlInstanceId, input.sourceObservationId);
  if (!source) throw Error("GRAPH_CONTROL_STALE");
  execute(database, INSERT_REQUEST, input.planId, input.controlInstanceId, input.sourceObservationId, source.owner, binding.panelInstanceId, binding.collectionSessionId, binding.stamp.epoch, binding.stamp.revision, at, value.shape);
  value.values.forEach((component, index) => execute(database, "INSERT INTO desired_control_components(plan_id,component,value) VALUES(?,?,?)", input.planId, index, component));
}

function requireSourceBinding(request: DesiredRow, input: DesiredApplyInput): void {
  const mismatched = (input.sourceObservationId !== undefined && input.sourceObservationId !== request.source_observation_id)
    || (input.controlInstanceId !== undefined && input.controlInstanceId !== request.control_id);
  const moved = request.source_panel_instance_id !== input.panelInstanceId || request.source_epoch !== input.stamp.epoch || request.source_revision !== input.stamp.revision;
  if (mismatched || moved) throw Error("GRAPH_DESIRED_BINDING_INVALID");
}

/** Binds a prepared request to the native ticket and read set it will be applied under; anything that does not match the request throws its code. */
export function bindDesiredParameter(database: DatabaseSync, input: DesiredApplyInput, binding: ControlBinding): JsonObject {
  requireLiteral(binding);
  if (!/^[a-f0-9]{64}$/.test(input.readSetDigest) || !input.ticket || input.ticket.length > MAX_TOKEN) throw Error("GRAPH_DESIRED_BINDING_INVALID");
  const request = selectOne(database, "SELECT * FROM desired_control_requests WHERE plan_id=?", desiredRow, input.planId);
  if (!request || request.status !== "prepared" || request.source_observation_id !== binding.observationId) throw Error("GRAPH_DESIRED_BINDING_INVALID");
  requireSourceBinding(request, input);
  execute(database, "UPDATE desired_control_requests SET status='bound',ticket=?,read_set_digest=? WHERE plan_id=? AND status='prepared'", input.ticket, input.readSetDigest, input.planId);
  return { ok: true, state: "bound", planId: input.planId, sourceObservationId: request.source_observation_id };
}

/** Marks a prepared or bound request invalidated. */
export function invalidateDesiredParameter(database: DatabaseSync, planId: string, at: number): void {
  execute(database, "UPDATE desired_control_requests SET status='invalidated',settled_at=? WHERE plan_id=? AND status IN ('prepared','bound')", at, planId);
}
