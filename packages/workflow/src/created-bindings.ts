// Created-id bindings: which placeholders a batch declares, how a receipt's created ids are correlated to its creator operations, and which bindings may seed a continuation.

import type { WorkflowAdmittedOperation } from "./admission-types.js";
import { assert } from "./assertions.js";
import type { WorkflowCreatedBinding, WorkflowOperationOutcome, WorkflowReceipt } from "./evidence-types.js";
import type { WorkflowId } from "./identity.js";
import { objectView, valueAtPath } from "./json-view.js";
import type { JsonValue } from "@extynt/decode";
import { MAX_WORKFLOW_CONTINUATION_BINDINGS } from "./limits.js";
import { CREATOR_PLACEHOLDER_PATHS, isPlaceholderName } from "./placeholders.js";
import { looksSensitive } from "./redaction.js";
import type { WorkflowBatch, WorkflowOperation } from "./state-types.js";

type ContinuationBinding = WorkflowCreatedBinding & { readonly sourceBatchId: WorkflowId };
type BindingAccumulator = {
  readonly bindings: ContinuationBinding[];
  readonly byPlaceholder: Map<string, string>;
  readonly byCreatedId: Map<string, string>;
  readonly conflictedPlaceholders: Set<string>;
  readonly conflictedIds: Set<string>;
};
type Conflict = { readonly placeholder: string; readonly createdId: string; readonly priorPlaceholder: string | undefined; readonly priorId: string | undefined };

const CONFIRMED_ROW_OUTCOMES: ReadonlySet<WorkflowOperationOutcome["outcome"]> = new Set(["confirmed", "host_confirmed", "coerced_equivalent"]);
const CONFLICT_MARK = "__conflict__";

const CREATOR_READBACK_FIELDS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  create_layer: { "target.layerId": "layerId" },
  duplicate_layer: { newLayerId: "layerId" },
  derive_layer: { newLayerId: "layerId" },
  create_composition: { newCompositionId: "compositionId" },
  duplicate_composition: { newCompositionId: "compositionId" },
  precompose_layers: { newCompositionId: "newCompositionId", newLayerId: "layerId" },
  create_folder: { newFolderId: "itemId" },
  import_file: { newItemId: "itemId" },
  create_vector_artwork: { newItemId: "itemId" },
};

function declaredPlaceholder(candidate: JsonValue | undefined): candidate is string {
  return typeof candidate === "string" && isPlaceholderName(candidate);
}

function payloadPlaceholders(admitted: WorkflowAdmittedOperation): readonly string[] {
  const payload = objectView(admitted.payload);
  if (payload === undefined) return [];
  return (CREATOR_PLACEHOLDER_PATHS[admitted.payload.type] ?? []).map((path) => valueAtPath(payload, path)).filter(declaredPlaceholder);
}

function creatorPlaceholderSet(batch: WorkflowBatch): ReadonlySet<string> {
  return new Set((batch.admission?.operations ?? []).flatMap(payloadPlaceholders));
}

/** Placeholder names that are declared by a creator operation in this batch. */
export function declaredWorkflowCreatedPlaceholders(batch: WorkflowBatch): readonly string[] {
  return [...creatorPlaceholderSet(batch)];
}

function creatorReadbackField(operation: WorkflowAdmittedOperation, placeholder: string): string | null {
  const fields = CREATOR_READBACK_FIELDS[operation.type];
  const payload = objectView(operation.payload);
  if (!fields || payload === undefined) return null;
  const matches = Object.entries(fields).filter(([path]) => valueAtPath(payload, path) === placeholder);
  return matches.length === 1 ? (matches[0]?.[1] ?? null) : null;
}

function validateBindingCorrelation(binding: WorkflowCreatedBinding, admitted: WorkflowAdmittedOperation, row: WorkflowOperationOutcome | undefined, receipt: WorkflowReceipt): void {
  const expectedField = creatorReadbackField(admitted, binding.placeholder);
  assert(expectedField !== null && expectedField === binding.readbackField, "INVALID_RECEIPT", "Created-id binding is not correlated to a supported creator/readback field.");
  assert(row !== undefined && CONFIRMED_ROW_OUTCOMES.has(row.outcome) && row.verification === "verified", "INVALID_RECEIPT", "Created-id binding requires an exactly verified creator operation outcome.");
  assert(binding.observedFingerprint === receipt.observedFingerprint, "INVALID_RECEIPT", "Created-id binding snapshot evidence must match the verified receipt snapshot.");
}

/** Accepts a receipt's created-id map only when each binding points to one admitted creator operation, its exact stable readback field, a confirmed operation outcome and the receipt's observed post-apply snapshot; the reducer enforces this so a replayed event cannot smuggle in an invented map. */
export function validateCreatedBindingsAgainstBatch(
  receipt: WorkflowReceipt,
  current: WorkflowBatch,
  rows: readonly WorkflowOperationOutcome[],
  operations: Readonly<Record<string, WorkflowOperation>>,
): void {
  if (!receipt.createdBindings || receipt.createdBindings.length === 0) return;
  assert(receipt.verification === "verified", "INVALID_RECEIPT", "Created-id bindings require a verified creator receipt.");
  assert(current.admission !== null, "INVALID_RECEIPT", "Created-id bindings require an admitted batch.");
  assert(receipt.observedFingerprint !== undefined && receipt.observedFingerprint.length > 0, "INVALID_RECEIPT", "Created-id bindings require an observed receipt snapshot.");
  const seenKeys = new Set<string>();
  for (const binding of receipt.createdBindings) {
    const admitted = current.admission.operations.find((candidate) => candidate.operationId === binding.operationId);
    assert(admitted !== undefined, "INVALID_RECEIPT", "Created-id binding operation is not admitted in this batch.");
    validateBindingCorrelation(binding, admitted, rows.find((candidate) => candidate.operationId === binding.operationId), receipt);
    const operation = operations[binding.operationId];
    assert(operation !== undefined && operation.batchId === current.batchId, "WRONG_OWNER", "Created-id binding operation belongs to another batch.");
    const key = `${binding.operationId}:${binding.readbackField}`;
    assert(!seenKeys.has(key), "DUPLICATE_EVENT_CONFLICT", "Created-id binding readback evidence must be unique.");
    seenKeys.add(key);
  }
}

function poisonBinding(accumulator: BindingAccumulator, conflict: Conflict): void {
  accumulator.conflictedPlaceholders.add(conflict.placeholder);
  accumulator.conflictedIds.add(conflict.createdId);
  if (conflict.priorPlaceholder) accumulator.conflictedPlaceholders.add(conflict.priorPlaceholder);
  if (conflict.priorId) accumulator.conflictedIds.add(conflict.priorId);
  for (let index = accumulator.bindings.length - 1; index >= 0; index -= 1) {
    const candidate = accumulator.bindings[index];
    if (candidate && (accumulator.conflictedPlaceholders.has(candidate.placeholder) || accumulator.conflictedIds.has(candidate.createdId))) accumulator.bindings.splice(index, 1);
  }
}

function bindingConflicts(accumulator: BindingAccumulator, binding: WorkflowCreatedBinding, priorId: string | undefined, priorPlaceholder: string | undefined): boolean {
  const alreadyConflicted = accumulator.conflictedPlaceholders.has(binding.placeholder) || accumulator.conflictedIds.has(binding.createdId);
  return alreadyConflicted || priorId !== undefined || (priorPlaceholder !== undefined && priorPlaceholder !== binding.placeholder);
}

function addContinuationBinding(accumulator: BindingAccumulator, binding: WorkflowCreatedBinding, sourceBatchId: WorkflowId, declared: ReadonlySet<string>): void {
  if (accumulator.bindings.length >= MAX_WORKFLOW_CONTINUATION_BINDINGS) return;
  if (!declared.has(binding.placeholder) || looksSensitive(binding.createdId)) return;
  const priorId = accumulator.byPlaceholder.get(binding.placeholder);
  const priorPlaceholder = accumulator.byCreatedId.get(binding.createdId);
  if (bindingConflicts(accumulator, binding, priorId, priorPlaceholder)) {
    poisonBinding(accumulator, { placeholder: binding.placeholder, createdId: binding.createdId, priorPlaceholder, priorId });
    accumulator.byPlaceholder.set(binding.placeholder, CONFLICT_MARK);
    return;
  }
  accumulator.byPlaceholder.set(binding.placeholder, binding.createdId);
  accumulator.byCreatedId.set(binding.createdId, binding.placeholder);
  accumulator.bindings.push({ ...binding, sourceBatchId });
}

function collectContinuationBatch(accumulator: BindingAccumulator, current: WorkflowBatch): void {
  const receipt = current.execution.receipt;
  if (!receipt || receipt.verification !== "verified") return;
  const declared = creatorPlaceholderSet(current);
  for (const binding of receipt.createdBindings ?? []) {
    addContinuationBinding(accumulator, binding, current.batchId, declared);
    if (accumulator.bindings.length >= MAX_WORKFLOW_CONTINUATION_BINDINGS) break;
  }
}

/** The created-id bindings of settled batches that a continuation may rely on: declared, non-sensitive, unambiguous across batches and bounded. */
export function continuationCreatedBindings(settled: readonly WorkflowBatch[]): readonly ContinuationBinding[] {
  const accumulator: BindingAccumulator = { bindings: [], byPlaceholder: new Map(), byCreatedId: new Map(), conflictedPlaceholders: new Set(), conflictedIds: new Set() };
  for (const current of settled) {
    collectContinuationBatch(accumulator, current);
    if (accumulator.bindings.length >= MAX_WORKFLOW_CONTINUATION_BINDINGS) break;
  }
  return accumulator.bindings;
}
