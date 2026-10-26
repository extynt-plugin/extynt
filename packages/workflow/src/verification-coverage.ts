// Verification coverage: which independent kinds of evidence a settled batch actually carries.

import type { WorkflowReceipt, WorkflowVerificationCoverage, WorkflowVerificationKind } from "./evidence-types.js";
import type { WorkflowBatch } from "./state-types.js";

/** Evidence kinds a verified receipt actually carries, not kinds its prose implies. */
export function receiptVerificationKinds(receipt: WorkflowReceipt): ReadonlySet<WorkflowVerificationKind> {
  const kinds = new Set<WorkflowVerificationKind>();
  if (receipt.verification === "verified") kinds.add("structural");
  for (const condition of receipt.postconditions ?? []) if (condition.state === "passed") kinds.add(condition.kind);
  for (const evidence of receipt.hostEvidence ?? []) kinds.add(evidence.kind);
  return kinds;
}

/** Projects a settled batch into independent facts for UI and model continuation: `applied` never implies `readback`, and `readback` never implies that a rendered frame or motion sample was checked. */
export function workflowVerificationCoverage(batch: WorkflowBatch): WorkflowVerificationCoverage {
  const receipt = batch.execution.receipt;
  const kinds = receipt ? receiptVerificationKinds(receipt) : new Set<WorkflowVerificationKind>();
  const verified = batch.verification.state === "verified";
  return {
    applied: batch.execution.mutation === "applied",
    readback: verified && (kinds.has("structural") || kinds.has("host_evidence")),
    visual: verified && kinds.has("visual"),
    temporal: verified && kinds.has("temporal"),
  };
}
