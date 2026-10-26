// Grades a panel receipt into the workflow's execution, mutation and verification states, and the per-operation rows behind them.

import type { StoredReceipt } from "@extynt/mcp-server";
import type { ActionPlan } from "@extynt/action-plan";
import type { WorkflowId, WorkflowOperationOutcome, WorkflowReceipt } from "@extynt/workflow";
import { allRowsVerified, operationRows, unconfirmedRows } from "./workflow-coordinator-outcomes.js";
import type { ReceiptFacts } from "./workflow-panel-receipt.js";

/** The states a receipt settles into, with the two facts that decide whether the panel's own failure report stands. */
export interface ReceiptGrade {
  readonly executed: boolean;
  readonly mutation: WorkflowReceipt["mutation"];
  readonly verification: WorkflowReceipt["verification"];
  readonly execution: WorkflowReceipt["execution"];
  readonly hasMismatch: boolean;
  readonly explicitVerificationFailure: boolean;
}

interface Grading {
  readonly facts: ReceiptFacts;
  readonly rows: readonly WorkflowOperationOutcome[];
  readonly executed: boolean;
  readonly mutation: WorkflowReceipt["mutation"];
  readonly hasMismatch: boolean;
  readonly explicitFailure: boolean;
  readonly explicitUnknown: boolean;
}

const POSSIBLE_MUTATION_STATES = ["partial-applied", "mutation-unknown", "mutation-possible"];
const UNVERIFIED_POSTCONDITIONS = ["passed", "applied_unverified", "verification_unavailable", "unknown"];

function possiblyMutated(mutationState: string | undefined): boolean {
  return mutationState !== undefined && POSSIBLE_MUTATION_STATES.includes(mutationState);
}

function executedMutation(facts: ReceiptFacts): WorkflowReceipt["mutation"] {
  if (facts.mayHaveMutated) return "applied";
  if (facts.undoGroups === 0) return "none";
  if (facts.mutationState === "applied") return "applied";
  return possiblyMutated(facts.mutationState) ? "may_have_mutated" : "applied";
}

function receiptMutation(facts: ReceiptFacts): WorkflowReceipt["mutation"] {
  if (facts.status === "executed") return executedMutation(facts);
  return facts.mayHaveMutated || possiblyMutated(facts.mutationState) ? "may_have_mutated" : "none";
}

function outcomeUnknown(facts: ReceiptFacts): boolean {
  return facts.status === "unknown" || (facts.status !== "executed" && facts.mutationState === "unknown");
}

function executionOf(facts: ReceiptFacts, mutation: WorkflowReceipt["mutation"]): WorkflowReceipt["execution"] {
  if (facts.status === "executed") return "executed";
  if (outcomeUnknown(facts)) return "unknown";
  return mutation === "none" ? "rejected_before_apply" : "failed_during_apply";
}

function gradedPostcondition(facts: ReceiptFacts, rows: readonly WorkflowOperationOutcome[]): string {
  if (facts.postcondition !== "applied_unverified" || facts.verificationTrimmed || !allRowsVerified(rows)) return facts.postcondition;
  return facts.steps.some((step) => step.expressionMotionUnverified === true) ? facts.postcondition : "passed";
}

function canVerify(grading: Grading): boolean {
  const { facts, rows, executed, hasMismatch, explicitFailure, explicitUnknown } = grading;
  return executed && gradedPostcondition(facts, rows) === "passed" && allRowsVerified(rows) && !hasMismatch && !explicitFailure && !explicitUnknown && facts.afterFingerprint !== undefined;
}

function canMarkUnverified(grading: Grading): boolean {
  const { facts, executed, hasMismatch, explicitUnknown } = grading;
  return executed && (UNVERIFIED_POSTCONDITIONS.includes(facts.postcondition) || explicitUnknown) && !hasMismatch;
}

function verificationOf(grading: Grading): WorkflowReceipt["verification"] {
  if (canVerify(grading)) return "verified";
  if (canMarkUnverified(grading)) return "applied_unverified";
  return grading.executed || grading.mutation !== "none" ? "failed" : "not_requested";
}

function gradingOf(facts: ReceiptFacts, rows: readonly WorkflowOperationOutcome[]): Grading {
  const reported = facts.verificationState;
  return {
    facts,
    rows,
    executed: facts.status === "executed",
    mutation: receiptMutation(facts),
    hasMismatch: rows.some((row) => row.outcome === "readback_mismatch"),
    explicitFailure: reported === "failed" || reported === "mismatch" || facts.postcondition === "failed",
    explicitUnknown: reported === "unknown" || reported === "applied_unverified",
  };
}

/** The grade of a receipt against its plan, and the rows that grade stands on. */
export function gradeReceipt(input: { readonly plan: ActionPlan; readonly receipt: StoredReceipt; readonly facts: ReceiptFacts; readonly batchId: WorkflowId }): { readonly grade: ReceiptGrade; readonly rows: readonly WorkflowOperationOutcome[] } {
  const { plan, receipt, facts, batchId } = input;
  const graded = operationRows(plan, receipt, batchId);
  const grading = gradingOf(facts, graded);
  const verification = verificationOf(grading);
  const rows = verification === "applied_unverified" ? unconfirmedRows(facts, graded) : graded;
  const grade: ReceiptGrade = { executed: grading.executed, mutation: grading.mutation, verification, execution: executionOf(facts, grading.mutation), hasMismatch: grading.hasMismatch, explicitVerificationFailure: grading.explicitFailure };
  return { grade, rows };
}
