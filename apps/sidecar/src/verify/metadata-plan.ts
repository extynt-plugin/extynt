// The approved read-set plan a metadata readback is checked against: the decoded command and the snapshot it was prepared from, and the snapshot a reconciled readback becomes.
import type { JsonObject, JsonValue } from "@extynt/decode";
import { decode } from "@extynt/decode";
import { sameValue } from "./compare-values.js";
import type { ApplyCommand, HostSnapshot } from "./host-types.js";
import { beforeSnapshot, commandShape } from "./metadata-shapes.js";
import type { ApprovedCommand, BeforeEnvelope, BoundReadback, CompositionView, Held, HostStamp, TargetBase } from "./metadata-shapes.js";

/** The command a read-set plan runs and the observation it was prepared from. */
export interface ReadSetPlan {
  readonly command: ApprovedCommand;
  readonly before: Held<BeforeEnvelope>;
}

/** The plan when the command and the snapshot before it are well formed and describe the same observation. */
export function planOf(command: ApplyCommand, before: HostSnapshot | null): ReadSetPlan | null {
  const approved = decode(commandShape, command);
  const snapshot = decode(beforeSnapshot, before);
  if (!approved.ok || !snapshot.ok) return null;
  const { readSet, operations } = approved.value;
  const sameObservation = sameValue(snapshot.value.view.result.view.hostStamp, readSet.stamp);
  return sameObservation && readSet.targets.length === operations.length ? { command: approved.value, before: snapshot.value } : null;
}

/** Whether the layer a target names is, in the snapshot before, the unlocked layer the plan was prepared against. */
export function targetLayerMatches(target: TargetBase, compositions: ReadonlyArray<Held<CompositionView>>): boolean {
  const comp = compositions.find((candidate) => candidate.view.id === target.compositionId);
  if (!comp || comp.view.itemIndex !== target.itemIndex) return false;
  const layer = comp.view.layers.find((candidate) => candidate.view.id === target.layerId);
  return layer !== undefined && layer.view.index === target.layerIndex && layer.view.name === target.name && layer.view.locked === false;
}

/** Whether the readback answers this exact approved plan, taken no earlier than the observation, with one row per operation. */
export function readbackBound(plan: ReadSetPlan, readback: BoundReadback): boolean {
  const { command } = plan;
  const { stamp } = command.readSet;
  const answersPlan = readback.planId === command.planId && readback.readSetDigest === command.readSet.digest;
  return answersPlan && readback.stamp.epoch === stamp.epoch && readback.stamp.revision >= stamp.revision && readback.rows.length === command.operations.length;
}

/** The snapshot after the readback: the one before, with the readback's stamp, request and the result fields the readback replaces. */
export function reconciled(plan: ReadSetPlan, observed: { readonly stamp: HostStamp }, input: { readonly requestId: string; readonly result: JsonObject }): JsonObject {
  const revision: JsonValue = `${observed.stamp.epoch}:${observed.stamp.revision}`;
  return { ...plan.before.row, requestId: input.requestId, result: { ...plan.before.view.result.row, ...input.result, hostStamp: observed.stamp, revision } };
}
