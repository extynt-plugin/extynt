// Decodes the completion evidence and reference a workflow close-out carries.
import { decode, literal, map, string, strictObject, union, type Decoder } from "@extynt/decode";
import type { JsonValue } from "@extynt/decode";

export type WorkflowCompletionReferenceInput =
  | { readonly kind: "batch_receipt"; readonly batchId: string; readonly receiptId: string }
  | { readonly kind: "observation"; readonly evidenceId: string };

export type WorkflowCompletionEvidenceInput = {
  readonly criterionId: string;
  readonly reference: WorkflowCompletionReferenceInput;
};

const workflowId = string({ pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/ });

const referenceDecoder: Decoder<WorkflowCompletionReferenceInput> = union(
  map(
    strictObject({ kind: literal("batch_receipt"), batchId: workflowId, receiptId: workflowId }),
    (row): WorkflowCompletionReferenceInput => ({ kind: "batch_receipt", batchId: row.batchId, receiptId: row.receiptId }),
  ),
  map(
    strictObject({ kind: literal("observation"), evidenceId: workflowId }),
    (row): WorkflowCompletionReferenceInput => ({ kind: "observation", evidenceId: row.evidenceId }),
  ),
);

const evidenceDecoder: Decoder<WorkflowCompletionEvidenceInput> = strictObject({
  criterionId: workflowId,
  reference: referenceDecoder,
});

/** Decodes one completion reference exactly; hybrid objects naming unrelated ids are rejected. */
export function workflowCompletionReferenceOf(value: JsonValue): WorkflowCompletionReferenceInput | undefined {
  const result = decode(referenceDecoder, value);
  return result.ok ? result.value : undefined;
}

/** Decodes one workflow completion evidence row. */
export function workflowCompletionEvidenceOf(value: JsonValue): WorkflowCompletionEvidenceInput | undefined {
  const result = decode(evidenceDecoder, value);
  return result.ok ? result.value : undefined;
}
