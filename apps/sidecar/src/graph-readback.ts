// Accepts a verified readback as the new observation of the control a bound change targeted, after checking it against the request it answers.
import { array, boolean, decode, fallback, nullable, number, object, string, type JsonValue } from "@extynt/decode";
import type { Infer, JsonObject } from "@extynt/decode";
import type { DatabaseSync } from "node:sqlite";
import { execute, selectOne } from "./graph-sql.js";
import { desiredComponents, desiredFields } from "./graph-desired-row.js";
import { blurControls } from "./graph-control-observation.js";
import { writeControlObservation } from "./graph-control-write.js";
import { countOrNull, pageProject, textOr } from "./native-page.js";
import type { ControlObservation, GraphContext, VerifiedReadbackInput } from "./graph-control-types.js";
import { wireObject } from "./wire-object.js";

const MAX_RECEIPT = 512;
const BOUND_REQUEST = `SELECT d.*,e.project_id,e.composition_id,e.layer_id,e.item_index,e.layer_index,e.effect_index,e.match_name AS effect_match_name,c.match_name AS control_match_name,c.index_path
  FROM desired_control_requests d JOIN control_instances c ON c.id=d.control_id JOIN effect_instances e ON e.id=c.effect_instance_id WHERE d.plan_id=?`;
const boundRow = object({
  ...desiredFields, project_id: string(), composition_id: string(), layer_id: string(), item_index: nullable(number()), layer_index: nullable(number()),
  effect_index: number(), effect_match_name: string(), control_match_name: string(), index_path: string(),
});
const sourceRow = object({ minimum: nullable(number()), maximum: nullable(number()), units: nullable(string()) });
const text = fallback(string(), undefined);
const proofRow = object({
  operationIndex: fallback(number(), undefined), compositionId: text, layerId: text, layerIndex: fallback(number(), undefined),
  value: fallback(number(), undefined), name: text, locked: fallback(boolean(), undefined), selected: fallback(boolean(), undefined),
});
const NO_ROW: Infer<typeof proofRow> = { operationIndex: undefined, compositionId: undefined, layerId: undefined, layerIndex: undefined, value: undefined, name: undefined, locked: undefined, selected: undefined };
const stampFacts = object({ epoch: countOrNull, revision: countOrNull });
const NO_STAMP: Infer<typeof stampFacts> = { epoch: null, revision: null };
const layerFacts = object({ name: text, selected: fallback(boolean(), undefined) });
const NO_LAYER: Infer<typeof layerFacts> = { name: undefined, selected: undefined };
const metadataFacts = object({ layer: fallback(layerFacts, NO_LAYER) });
const NO_METADATA: Infer<typeof metadataFacts> = { layer: NO_LAYER };
const readbackFacts = object({
  planId: textOr(""), readSetDigest: textOr(""), complete: fallback(boolean(), undefined), rows: fallback(array(fallback(proofRow, NO_ROW)), undefined),
  stamp: fallback(stampFacts, NO_STAMP), metadata: fallback(metadataFacts, NO_METADATA),
});
const stampOnly = object({ stamp: fallback(stampFacts, NO_STAMP) });
const NO_READBACK: JsonObject = {};

type BoundRow = Infer<typeof boundRow>;
type ReadbackFacts = Infer<typeof readbackFacts>;

/** A verified readback proof whose readback is a JSON object; a readback that is not one reads as empty and fails its checks. */
export type ReadbackProof = Omit<VerifiedReadbackInput, "readback"> & { readback: JsonObject };

interface ReadbackWrite { database: DatabaseSync; input: ReadbackProof; at: number; projectSession: string; hostKey: string }

/** The proof with its readback read as a JSON object. */
export function readbackProof(input: VerifiedReadbackInput): ReadbackProof {
  const readback = decode(wireObject, input.readback);
  return { ...input, readback: readback.ok ? readback.value : NO_READBACK };
}

/** The native stamp a readback reports; a missing or malformed part is null. */
export function readbackStamp(readback: JsonValue | undefined): { epoch: number | null; revision: number | null } {
  const found = decode(stampOnly, readback);
  return found.ok ? found.value.stamp : NO_STAMP;
}

function requestUnbound(row: BoundRow, input: ReadbackProof): boolean {
  const ticketMismatch = row.status !== "bound" || row.ticket !== input.ticket;
  const readSetMismatch = row.read_set_digest !== input.readSetDigest || row.source_panel_instance_id !== input.panelInstanceId;
  const observationMismatch = input.sourceObservationId !== undefined && row.source_observation_id !== input.sourceObservationId;
  return ticketMismatch || readSetMismatch || observationMismatch;
}

function boundRequest(database: DatabaseSync, input: ReadbackProof): BoundRow {
  const row = selectOne(database, BOUND_REQUEST, boundRow, input.planId);
  if (!row || requestUnbound(row, input)) throw Error("GRAPH_READBACK_BINDING_INVALID");
  return row;
}

function proofMismatch(input: ReadbackProof, facts: ReadbackFacts): boolean {
  return facts.planId !== input.planId || facts.readSetDigest !== input.readSetDigest || facts.complete !== true;
}

function receiptInvalid(reference: string): boolean {
  return !reference || reference.length > MAX_RECEIPT || reference.includes("\0");
}

function rowCountInvalid(facts: ReadbackFacts): boolean {
  return facts.rows?.length !== 1 || facts.rows[0]?.operationIndex !== 0;
}

function requireProof(input: ReadbackProof, facts: ReadbackFacts): void {
  if (proofMismatch(input, facts) || receiptInvalid(input.receiptReference) || rowCountInvalid(facts)) throw Error("GRAPH_READBACK_PROOF_INVALID");
}

function effectMismatch(effect: ControlObservation["effect"], request: BoundRow): boolean {
  return effect.compositionId !== request.composition_id || effect.layerId !== request.layer_id || effect.effectIndex !== request.effect_index || effect.matchName !== request.effect_match_name;
}

function controlMismatch(observation: ControlObservation, request: BoundRow): boolean {
  const effect = observation.effect;
  const positionMismatch = effect.itemIndex !== request.item_index || effect.layerIndex !== request.layer_index || observation.matchName !== request.control_match_name;
  return positionMismatch || (!!request.index_path && observation.indexPath !== request.index_path);
}

function requireAddress(observation: ControlObservation, request: BoundRow): void {
  if (effectMismatch(observation.effect, request) || controlMismatch(observation, request)) throw Error("GRAPH_READBACK_IDENTITY_INVALID");
}

function requireValue(database: DatabaseSync, observation: ControlObservation, request: BoundRow): void {
  const values = desiredComponents(database, request.plan_id);
  if (request.shape !== "scalar" || values.length !== 1 || observation.current.value !== values[0]) throw Error("GRAPH_READBACK_VALUE_INVALID");
}

function rowMismatch(row: typeof NO_ROW, observation: ControlObservation): boolean {
  const effect = observation.effect;
  return row.compositionId !== effect.compositionId || row.layerId !== effect.layerId || row.layerIndex !== effect.layerIndex || row.value !== observation.current.value;
}

function layerMismatch(row: typeof NO_ROW, layer: ReadbackFacts["metadata"]["layer"]): boolean {
  return row.name !== layer.name || row.locked !== false || row.selected !== layer.selected;
}

function requireReadbackRow(facts: ReadbackFacts, observation: ControlObservation): void {
  const row = facts.rows?.[0] ?? NO_ROW;
  if (rowMismatch(row, observation) || layerMismatch(row, facts.metadata.layer)) throw Error("GRAPH_READBACK_IDENTITY_INVALID");
}

function rangeMismatch(current: ControlObservation["current"], source: Infer<typeof sourceRow>): boolean {
  return current.minimum !== source.minimum || current.maximum !== source.maximum || current.units !== source.units;
}

function isAnimated(current: ControlObservation["current"]): boolean {
  return current.isTimeVarying !== false || current.expressionEnabled !== false || current.expressionPresent !== false || current.keyframeCount !== 0;
}

function requireReadbackState(database: DatabaseSync, observation: ControlObservation, request: BoundRow): void {
  const source = selectOne(database, "SELECT minimum,maximum,units FROM control_observations WHERE control_id=? AND observation_id=?", sourceRow, request.control_id, request.source_observation_id);
  if (!source) throw Error("GRAPH_READBACK_BINDING_INVALID");
  const current = observation.current;
  if (rangeMismatch(current, source) || isAnimated(current)) throw Error("GRAPH_READBACK_STATE_INVALID");
}

function requireStamp(stamp: ReadbackFacts["stamp"], request: BoundRow, project: string): { epoch: number; revision: number } {
  const { epoch, revision } = stamp;
  if (project !== request.project_id || epoch === null || epoch !== request.source_epoch || revision === null || revision < request.source_revision) throw Error("GRAPH_READBACK_STAMP_INVALID");
  return { epoch, revision };
}

function settleRequest(input: ReadbackWrite, observationId: string, stamp: { epoch: number; revision: number }): void {
  const { database, input: proof, at } = input;
  execute(database, "UPDATE desired_control_requests SET status='verified',verified_observation_id=?,receipt_reference=?,settled_at=?,verified_epoch=?,verified_revision=? WHERE plan_id=? AND status='bound'",
    observationId, proof.receiptReference, at, stamp.epoch, stamp.revision, proof.planId);
}

/** Checks the readback against the bound request and, when it proves the change, records it as the control's new observation and settles the request. */
export function writeVerifiedReadback(input: ReadbackWrite): { context: GraphContext; result: JsonObject } {
  const proof = input.input, facts = decode(readbackFacts, proof.readback);
  if (!facts.ok) throw Error("GRAPH_READBACK_PROOF_INVALID");
  requireProof(proof, facts.value);
  const request = boundRequest(input.database, proof), project = pageProject(proof.readback, input.projectSession);
  if (!Number.isSafeInteger(input.at) || input.at < request.requested_at) throw Error("GRAPH_READBACK_TIME_INVALID");
  const stamp = requireStamp(facts.value.stamp, request, project.id), observation = blurControls(proof.readback)[0];
  if (!observation) throw Error("INVALID_LOCAL_EFFECT_OBSERVATION");
  requireAddress(observation, request); requireValue(input.database, observation, request);
  requireReadbackRow(facts.value, observation); requireReadbackState(input.database, observation, request);
  const context: GraphContext = { project: project.id, owner: request.source_owner, epoch: stamp.epoch, revision: stamp.revision, liveAt: undefined };
  const evidence = { context, panel: proof.panelInstanceId, session: request.source_session_id, at: input.at, sourceKind: "verified-readback" as const, proofReference: [proof.ticket, proof.readSetDigest, proof.receiptReference].join("/") };
  const saved = writeControlObservation({ database: input.database, hostKey: input.hostKey, evidence }, observation);
  if (saved.controlInstanceId !== request.control_id) throw Error("GRAPH_READBACK_IDENTITY_INVALID");
  settleRequest(input, saved.observationId, stamp);
  return { context, result: { ok: true, state: "observed", planId: proof.planId, ...saved, beforeStamp: { epoch: request.source_epoch, revision: request.source_revision }, afterStamp: stamp, receiptReference: proof.receiptReference, writeAuthorizing: false } };
}
