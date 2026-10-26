// What every deterministic correction shares: the operation being shaped, the snapshot it may read, and the
// list of changes it reports. A correction applies only when the sidecar knows the one right answer; otherwise
// the operation is left alone and the validator's own refusal speaks.
import type { LayerSnapshot, ProjectSnapshot } from "@extynt/project-graph";
import type { OperationChange } from "./batch.js";
import type { Refusal } from "./compose-pass.js";
import { stringAt } from "./json.js";
import type { JsonArray, JsonObject, JsonValue } from "@extynt/decode";
import { fieldsOf } from "./operation-fields.js";
import type { OperationFields } from "./operation-fields.js";

/** The operation under correction, with the changes made so far, where it sits in the call, the call's other operations as submitted, and the real layer ids this same work already created. */
export interface CorrectionContext {
  snapshot: ProjectSnapshot;
  type: string;
  index: number;
  changes: OperationChange[];
  call?: JsonArray;
  ownedLayerIds?: ReadonlySet<string>;
}

/** A correction step: it edits the operation copy, records what it changed, and may refuse when the intent is unrecoverable. */
export type CorrectionStep = (operation: OperationFields, context: CorrectionContext) => Refusal | undefined;

/** The operation types that write keyframes onto a property. */
export const ANIMATING_TYPES: ReadonlySet<string> = new Set(["animate_property", "animate_control"]);

/** Adds one change to the list the correction reports. */
export function recordChange(context: CorrectionContext, change: OperationChange): void {
  context.changes.push(change);
}

/** True when both values serialise to the same JSON. */
export function isSameJson(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** A fresh copy of the target object, so a correction never edits the caller's own. */
export function ownTarget(operation: OperationFields): OperationFields | undefined {
  const copy = fieldsOf(operation.target);
  if (copy) operation.target = copy;
  return copy;
}

/** The layer an operation's target names in the snapshot, when it names a real one. */
export function targetLayer(snapshot: ProjectSnapshot, target: JsonObject): LayerSnapshot | undefined {
  const layerId = stringAt(target, "layerId");
  if (layerId === undefined) return undefined;
  const compositionId = stringAt(target, "compositionId") ?? snapshot.activeCompositionId;
  return snapshot.compositions.find((composition) => composition.id === compositionId)?.layers.find((layer) => layer.id === layerId);
}
