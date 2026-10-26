// The meaning of a receipt, reduced to the fields that decide whether two receipts say the same thing, so a resend is told apart from a different result.
import { array, boolean, decodeOrThrow, type Decoder, fallback, type Infer, isJsonArray, isJsonObject, jsonValue, type JsonValue, map, number, object, optional, string } from "@extynt/decode";
import type { StoredReceipt } from "@extynt/mcp-server";
import { PROPOSAL_OPERATION_LIMIT } from "@extynt/mcp-server";

type Receipt = StoredReceipt;

function given<Value>(decoder: Decoder<Value>): Decoder<Value | undefined> {
  return optional(fallback(decoder, undefined));
}

const evidence: Decoder<JsonValue | undefined> = map(fallback(jsonValue, undefined), (value) => (value !== undefined && value !== null && typeof value === "object" ? value : undefined));

const semanticReceipt = object({
  status: given(string()),
  operation: given(string()),
  postcondition: given(string()),
  approvalId: given(string()),
  beforeFingerprint: given(string()),
  afterRevision: given(string()),
  appliedOperations: given(array(jsonValue)),
  completedOperations: given(array(jsonValue)),
  mayHaveMutated: given(boolean()),
  mutationState: given(string()),
  rollback: given(string()),
  undoGroups: given(number()),
  batchSize: given(number()),
  keyframeSteps: given(array(jsonValue)),
  hostError: optional(evidence),
  verification: optional(evidence),
  failure: optional(evidence),
  repair: optional(evidence),
  created: optional(evidence),
});

const undoSemantic = object({
  status: given(string()),
  executed: given(boolean()),
  times: given(number()),
  method: given(string()),
  hostError: optional(evidence),
});

function canonical(value: JsonValue): JsonValue {
  if (isJsonArray(value)) return value.map(canonical);
  if (!isJsonObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key] ?? null)]));
}

function stableJson(value: JsonValue): string {
  return JSON.stringify(canonical(value));
}

function capped(operations: readonly JsonValue[] | undefined): readonly JsonValue[] | null {
  return operations === undefined ? null : operations.slice(0, PROPOSAL_OPERATION_LIMIT);
}

type Read = Infer<typeof semanticReceipt>;

function outcomeFields(read: Read, afterFingerprint: string | null): Record<string, JsonValue> {
  return {
    status: read.status ?? "unknown",
    operation: read.operation ?? "unknown",
    postcondition: read.postcondition ?? "unknown",
    approvalId: read.approvalId ?? null,
    beforeFingerprint: read.beforeFingerprint ?? null,
    afterFingerprint,
    afterRevision: read.afterRevision ?? null,
  };
}

function sizeFields(read: Read): Record<string, JsonValue> {
  return { rollback: read.rollback ?? null, undoGroups: read.undoGroups ?? null, batchSize: read.batchSize ?? null };
}

function operationFields(read: Read): Record<string, JsonValue> {
  return {
    appliedOperations: capped(read.appliedOperations),
    completedOperations: capped(read.completedOperations),
    mayHaveMutated: read.mayHaveMutated === true,
    mutationState: read.mutationState ?? (read.mayHaveMutated === true ? "mutation-unknown" : "not-applied"),
    keyframeSteps: read.keyframeSteps ?? null,
  };
}

function evidenceFields(read: Read): Record<string, JsonValue> {
  return {
    hostError: read.hostError ?? null,
    verification: read.verification ?? null,
    failure: read.failure ?? null,
    repair: read.repair ?? null,
    created: read.created ?? null,
  };
}

/** One string that is the same for two receipts exactly when they report the same outcome; the stored after-fingerprint stands in for the receipt's own. */
export function receiptSemantic(receipt: Receipt, normalizedAfterFingerprint: string | null): string {
  const read = decodeOrThrow(semanticReceipt, receipt);
  return stableJson({ ...outcomeFields(read, normalizedAfterFingerprint), ...sizeFields(read), ...operationFields(read), ...evidenceFields(read) });
}

/** The same reduction for an undo receipt. */
export function undoReceiptSemantic(receipt: Receipt): string {
  const read = decodeOrThrow(undoSemantic, receipt);
  return stableJson({ status: read.status ?? "unknown", executed: read.executed === true, times: read.times ?? 1, method: read.method ?? null, hostError: read.hostError ?? null });
}
