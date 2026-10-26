// The postcondition and host evidence a settled receipt carries into the workflow.

import type { WorkflowHostEvidence, WorkflowOperationOutcome, WorkflowPostconditionEvidence, WorkflowReceipt } from "@extynt/workflow";
import { postconditionContractsForPlan } from "./workflow-coordinator-admission.js";
import { eventId, iso, type WorkflowPlanRecord } from "./workflow-coordinator-types.js";
import type { ReceiptFacts } from "./workflow-panel-receipt.js";
import { exactValuesEvidence, proportionalEvidence, type EvidenceContext } from "./workflow-proportional-evidence.js";

function observedFingerprintOf(facts: ReceiptFacts): string | undefined {
  return facts.afterFingerprint ? facts.afterFingerprint.slice(0, 512) : undefined;
}

function structuralEvidence(record: WorkflowPlanRecord, facts: ReceiptFacts, verification: WorkflowReceipt["verification"]): readonly WorkflowPostconditionEvidence[] | undefined {
  const observedFingerprint = observedFingerprintOf(facts);
  if (verification !== "verified" || !observedFingerprint) return undefined;
  const structural = (postconditionContractsForPlan(record.plan) ?? []).filter((contract) => contract.kind === "structural");
  return structural.length ? structural.map((contract) => ({ postconditionId: contract.postconditionId, kind: "structural", state: "passed", basis: "legacy receipt structural readback", observedFingerprint })) : undefined;
}

/** The postconditions the receipt reports, or the admitted structural contracts a verified receipt proves. */
export function postconditionEvidence(record: WorkflowPlanRecord, facts: ReceiptFacts, verification: WorkflowReceipt["verification"]): readonly WorkflowPostconditionEvidence[] | undefined {
  return facts.postconditions.length ? facts.postconditions : structuralEvidence(record, facts, verification);
}

function hostConfirmedEvidence(input: { readonly record: WorkflowPlanRecord; readonly facts: ReceiptFacts; readonly rows: readonly WorkflowOperationOutcome[]; readonly now: () => Date }): readonly WorkflowHostEvidence[] {
  const { record, facts, rows, now } = input;
  const observedFingerprint = observedFingerprintOf(facts);
  return rows.filter((row) => row.outcome === "host_confirmed").map((row): WorkflowHostEvidence => ({
    evidenceId: eventId("host-evidence", `${record.batchId}:${row.operationId}`),
    jobId: record.jobId,
    batchId: record.batchId,
    operationId: row.operationId,
    kind: "host_evidence",
    basis: (row.basis ?? "host-confirmed operation evidence").slice(0, 1000),
    ...(observedFingerprint ? { observedFingerprint } : {}),
    recordedAt: facts.receivedAt ?? iso(now),
  }));
}

/** Everything a settled receipt proves about the host: host-confirmed operations, the exact-values check and the proportional checks. */
export function receiptHostEvidence(input: { readonly record: WorkflowPlanRecord; readonly facts: ReceiptFacts; readonly rows: readonly WorkflowOperationOutcome[]; readonly converted: WorkflowReceipt; readonly now: () => Date; readonly evidenceContext?: EvidenceContext }): readonly WorkflowHostEvidence[] {
  const { record, converted, now, evidenceContext } = input;
  const exact = exactValuesEvidence(evidenceContext?.goal, record, converted, iso(now));
  const proportional = evidenceContext ? proportionalEvidence(evidenceContext, record, converted, iso(now)).filter((evidence) => !(exact && evidence.kind === "visual")) : [];
  return [...hostConfirmedEvidence(input), ...(exact ? [exact] : []), ...proportional];
}
