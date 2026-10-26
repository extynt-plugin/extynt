// Readback repair: whether a batch that applied but failed read-back has been answered by a later verified write to the same target.

import type { WorkflowId } from "./identity.js";
import type { JsonObject } from "@extynt/decode";
import { objectView } from "./json-view.js";
import { isJsonObject } from "@extynt/decode";
import type { WorkflowBatch, WorkflowOperation } from "./state-types.js";

/** The operations a state holds, by id; a batch names its operations by id and the admitted payload carries the typed target. */
export type OperationLookup = Readonly<Record<WorkflowId, WorkflowOperation>>;

const VERIFIED_OUTCOMES: ReadonlySet<string> = new Set(["confirmed", "host_confirmed", "coerced_equivalent"]);
const STACK_TYPES: ReadonlySet<string> = new Set(["reorder_layer"]);

function textField(value: JsonObject | undefined, key: string): string | undefined {
  const field = value?.[key];
  return typeof field === "string" ? field : undefined;
}

function payloadOf(operation: WorkflowOperation): JsonObject | undefined {
  return objectView(operation.payload);
}

function targetOf(operation: WorkflowOperation): JsonObject | undefined {
  const target = payloadOf(operation)?.target;
  return isJsonObject(target) ? target : undefined;
}

function sameLayer(mismatched: WorkflowOperation, repair: WorkflowOperation): boolean {
  const [a, b] = [targetOf(mismatched), targetOf(repair)];
  return !!a && !!b && textField(a, "compositionId") === textField(b, "compositionId") && textField(a, "layerId") === textField(b, "layerId") && textField(a, "layerId") !== undefined;
}

function answers(mismatched: WorkflowOperation, repair: WorkflowOperation): boolean {
  if (!sameLayer(mismatched, repair)) return false;
  const [a, b] = [targetOf(mismatched), targetOf(repair)];
  const path = textField(a, "propertyPath") ?? textField(a, "effectPath");
  if (path !== undefined) return (textField(b, "propertyPath") ?? textField(b, "effectPath")) === path;
  if (STACK_TYPES.has(mismatched.type)) return STACK_TYPES.has(repair.type);
  return mismatched.type === repair.type && textField(payloadOf(mismatched), "role") === textField(payloadOf(repair), "role");
}

function verifiedOperations(batch: WorkflowBatch | undefined, operations: OperationLookup): WorkflowOperation[] {
  if (batch?.lifecycle !== "settled" || batch.verification.state !== "verified") return [];
  const outcomes = batch.execution.receipt?.outcomes ?? [];
  return outcomes.flatMap((outcome) => {
    const operation = operations[outcome.operationId];
    return operation && VERIFIED_OUTCOMES.has(outcome.outcome) ? [operation] : [];
  });
}

function readbackFailed(batch: WorkflowBatch): boolean {
  return batch.execution.state === "executed" && batch.execution.mutation === "applied" && batch.verification.state === "failed"
    && batch.execution.receipt !== null && batch.execution.receipt.outcomes.some((outcome) => outcome.outcome === "readback_mismatch");
}

/** Whether the batch at `index` is a readback-mismatch batch whose every mismatched operation has a verified operation on the same target in a later settled, verified batch; a property-level mismatch is answered by a verified write to the same property or effect path, a layer-level one by the same kind of write (same attribute role) or, for layer order, a verified restack. */
export function readbackRepaired(batches: readonly (WorkflowBatch | undefined)[], index: number, operations: OperationLookup): boolean {
  const batch = batches[index];
  if (!batch || !readbackFailed(batch)) return false;
  const repairs = batches.slice(index + 1).flatMap((later) => verifiedOperations(later, operations));
  const mismatched = (batch.execution.receipt?.outcomes ?? []).filter((outcome) => outcome.outcome === "readback_mismatch");
  return mismatched.every((outcome) => {
    const operation = operations[outcome.operationId];
    return !!operation && repairs.some((repair) => answers(operation, repair));
  });
}
