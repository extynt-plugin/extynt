// Grades each operation of a plan against the panel's receipt, and names the rows a settlement could not confirm.

import type { ActionPlan } from "@extynt/action-plan";
import { decode, type Decoder, fallback, type JsonValue, jsonValue, object, optional, skippingInvalidRecord } from "@extynt/decode";
import { isVerifiedOutcome, operationOutcomes, type OperationOutcome, type OperationOutcomeRow, type StoredReceipt, receiptJson } from "@extynt/mcp-server";
import type { WorkflowId, WorkflowOperationOutcome } from "@extynt/workflow";
import type { ReceiptFacts, PanelStep } from "./workflow-panel-receipt.js";
import { WORKFLOW_OPERATION_LIMIT, operationIdFor } from "./workflow-coordinator-types.js";

type JsonFields = Readonly<Record<string, JsonValue | undefined>>;

const ROW_EXPECTED_FIELDS = ["expectedValue", "expectedKeys", "expectedDigest", "requestedValue"];
const ROW_OBSERVED_FIELDS = ["observedValue", "observedEnabled", "observedKeys", "observedDigest", "mismatches"];
const OPERATION_EXPECTED_FIELDS = ["value", "name", "settings", "enabled", "color", "size"];

const VERIFICATION_BY_OUTCOME: Readonly<Record<OperationOutcome, WorkflowOperationOutcome["verification"]>> = {
  confirmed: "verified",
  host_confirmed: "verified",
  coerced_equivalent: "verified",
  applied_unconfirmed: "applied_unverified",
  readback_mismatch: "failed",
  rejected_before_apply: "not_requested",
  failed_during_apply: "unknown",
  applied_before_failure: "unknown",
  not_attempted: "unknown",
};

const jsonFields = skippingInvalidRecord(jsonValue);
const operationFields = object({
  value: optional(fallback(jsonValue, undefined)),
  name: optional(fallback(jsonValue, undefined)),
  settings: optional(fallback(jsonValue, undefined)),
  enabled: optional(fallback(jsonValue, undefined)),
  color: optional(fallback(jsonValue, undefined)),
  size: optional(fallback(jsonValue, undefined)),
});

function fieldsOf<Source>(decoder: Decoder<JsonFields>, source: Source): JsonFields {
  const decoded = decode(decoder, source);
  return decoded.ok ? decoded.value : {};
}

function mutationOf(mutated: OperationOutcomeRow["mutated"]): WorkflowOperationOutcome["mutation"] {
  if (mutated === false) return "none";
  return mutated === true ? "applied" : "unknown";
}

function readbackValue(fields: JsonFields, names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = fields[name];
    if (value !== undefined) return (typeof value === "string" ? value : JSON.stringify(value)).slice(0, 512);
  }
  return undefined;
}

function failureBasis(row: OperationOutcomeRow): string | undefined {
  if (row.basis) return row.basis.slice(0, 1000);
  return row.error ? `${row.error.code}: ${row.error.message}`.slice(0, 1000) : undefined;
}

function readbackEvidence(row: OperationOutcomeRow, operation: ActionPlan["operations"][number] | undefined): WorkflowOperationOutcome["readback"] | undefined {
  const targetLayerId = row.targets.layerId;
  const rowFields = fieldsOf(jsonFields, row.readBack);
  const expected = readbackValue(rowFields, ROW_EXPECTED_FIELDS) ?? readbackValue(fieldsOf(operationFields, operation), OPERATION_EXPECTED_FIELDS);
  const observed = readbackValue(rowFields, ROW_OBSERVED_FIELDS);
  if (!targetLayerId && !expected && !observed) return undefined;
  return { ...(targetLayerId ? { targetLayerId } : {}), ...(expected !== undefined ? { expected } : {}), ...(observed !== undefined ? { observed } : {}) };
}

function operationRow(row: OperationOutcomeRow, batchId: WorkflowId, operation: ActionPlan["operations"][number] | undefined): WorkflowOperationOutcome {
  const mutation = mutationOf(row.mutated);
  const basis = failureBasis(row);
  const readback = readbackEvidence(row, operation);
  return {
    operationId: operationIdFor(batchId, row.index),
    ordinal: row.index,
    type: row.type,
    outcome: row.outcome,
    mutation,
    verification: VERIFICATION_BY_OUTCOME[row.outcome],
    mayHaveMutated: mutation !== "none",
    ...(basis ? { basis } : {}),
    ...(readback ? { readback } : {}),
  };
}

/** The graded rows of a plan's receipt, one per operation up to the operation limit. */
export function operationRows(plan: ActionPlan, receipt: StoredReceipt, batchId: WorkflowId): readonly WorkflowOperationOutcome[] {
  return operationOutcomes(plan, receiptJson(receipt) ?? {}).rows.slice(0, WORKFLOW_OPERATION_LIMIT).map((row) => operationRow(row, batchId, plan.operations[row.index]));
}

/** Whether a row was confirmed by the host or by an equivalent read-back. */
export function verifiedRow(row: WorkflowOperationOutcome | undefined): row is WorkflowOperationOutcome {
  return row !== undefined && row.verification === "verified" && isVerifiedOutcome(row.outcome);
}

/** Whether there is at least one row and every row is verified. */
export function allRowsVerified(rows: readonly WorkflowOperationOutcome[]): boolean {
  return rows.length > 0 && rows.every(verifiedRow);
}

function stepLeftUnverified(step: PanelStep | undefined, row: WorkflowOperationOutcome): boolean {
  return step !== undefined && step.operation === row.type && (step.expressionMotionUnverified === true || step.verificationState === "applied_unverified");
}

/** The rows an applied_unverified aggregate could not confirm: the rows whose panel step was left unverified, else the rows only coercion or host evidence confirmed, else every row. */
export function unconfirmedRows(facts: ReceiptFacts, rows: readonly WorkflowOperationOutcome[]): readonly WorkflowOperationOutcome[] {
  if (rows.some((row) => row.outcome === "applied_unconfirmed")) return rows;
  const positional = !facts.verificationTrimmed && facts.steps.length === rows.length;
  const tiers: ReadonlyArray<(row: WorkflowOperationOutcome, index: number) => boolean> = [
    (row, index) => positional && stepLeftUnverified(facts.steps[index], row),
    (row) => row.outcome !== "confirmed",
    () => true,
  ];
  for (const tier of tiers) {
    const chosen = rows.map((row, index) => isVerifiedOutcome(row.outcome) && tier(row, index));
    if (chosen.some(Boolean)) return rows.map((row, index): WorkflowOperationOutcome => (chosen[index] ? { ...row, outcome: "applied_unconfirmed", verification: "applied_unverified" } : row));
  }
  return rows;
}
