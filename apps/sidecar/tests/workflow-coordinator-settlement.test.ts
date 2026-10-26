// Tests that completion proposals are goal-bound and reducer-committed, and that cancellation keeps a valid late receipt.

import assert from "node:assert/strict";
import test from "node:test";
import type { WorkflowCompletionProposal } from "@extynt/workflow";
import { WorkflowCoordinator } from "../src/workflow-coordinator.js";
import type { CompletionFailure, CompletionResult } from "../src/workflow-coordinator-completion.js";
import { present } from "./agent-test-support.js";
import { at, authority, plan, ready, verifiedReceipt } from "./workflow-coordinator-fixture.js";

function refusal(result: CompletionResult): CompletionFailure {
  if (result.ok) throw new Error("expected the completion proposal to be refused");
  return result;
}

test("completion proposals are typed, goal-bound, and reducer-committed only when every criterion is satisfied", () => {
  const coordinator = new WorkflowCoordinator({ now: () => at });
  const seed = "completion-goal-seed";
  const jobId = coordinator.openJob(seed, "Original user goal: rename the title layer; token=do-not-leak");
  const value = plan("completion-batch");
  assert.equal(coordinator.admitPlan(value, { jobId: seed, goalSummary: "Misleading model plan summary", undoGroups: 1, authority }).ok, true);
  coordinator.queue(value.planId);
  coordinator.bindApproval(value.planId, authority.policyApprovalId, value.snapshotFingerprint);
  coordinator.claim(value.planId);
  coordinator.executing(value.planId);
  coordinator.receipt(value.planId, { ...verifiedReceipt("completion-receipt"), planId: value.planId });
  coordinator.completeStageForContinuation(jobId);
  const continuation = coordinator.continuation(jobId, { fingerprint: "snapshot-after-completion-receipt", revision: "2" }, 1);
  assert.doesNotMatch(present(coordinator.workflowStore.getState().jobs[jobId], "job").goalSummary, /do-not-leak/i, "the reducer-retained original goal is redacted before admission");
  assert.equal(continuation.goalSummary.includes("Original user goal"), true);
  assert.equal(continuation.goalSummary.includes("do-not-leak"), false);
  const unbound: WorkflowCompletionProposal = { goalDigest: "0".repeat(64), criterionIds: ["not-declared"], evidence: [] };
  const unsupported = coordinator.proposeCompletion(jobId, unbound);
  assert.equal(refusal(unsupported).code, "COMPLETION_UNSUPPORTED");
  const message = (proposal: WorkflowCompletionProposal, snapshot = continuation.snapshot): string => refusal(coordinator.proposeCompletion(jobId, proposal, snapshot)).message;
  const settled = present(continuation.settledBatches[0], "settled batch");
  const row = { criterionId: "goal-observed", reference: { kind: "batch_receipt" as const, batchId: settled.batchId, receiptId: present(settled.receipt ?? undefined, "receipt").receiptId }, satisfiedAt: at.toISOString() };
  const bound = (evidence: WorkflowCompletionProposal["evidence"]): WorkflowCompletionProposal => ({ goalDigest: continuation.goalDigest, criterionIds: ["goal-observed"], evidence });
  const refusals: Array<[WorkflowCompletionProposal, RegExp, { fingerprint: string; revision: string }?]> = [[{ ...unbound, goalDigest: "" }, /goalDigest is missing or not 64 lowercase hex/], [unbound, /goalDigest does not match this job's retained original goal/], [bound([{ ...row, reference: { kind: "batch_receipt", batchId: "not an id", receiptId: "not an id" } }]), /evidence\.reference must be/], [bound([row]), /the newest receipt you cited.*most recent verified batch receipt/, { fingerprint: "snapshot-after-a-later-batch", revision: "3" }]];
  for (const [proposal, expected, snapshot] of refusals) assert.match(message(proposal, snapshot), expected);
  const incomplete: WorkflowCompletionProposal = { goalDigest: continuation.goalDigest, criterionIds: ["goal-observed"], evidence: [] };
  const unsatisfied = coordinator.proposeCompletion(jobId, incomplete, continuation.snapshot);
  assert.equal(refusal(unsatisfied).code, "COMPLETION_UNSATISFIED");
  const accepted = coordinator.proposeCompletion(jobId, { goalDigest: continuation.goalDigest, criterionIds: ["goal-observed"], evidence: [{ criterionId: "goal-observed", reference: { kind: "batch_receipt", batchId: settled.batchId, receiptId: "completion-receipt" }, satisfiedAt: at.toISOString() }] }, continuation.snapshot);
  assert.deepEqual(accepted, { ok: true });
  assert.equal(coordinator.workflowStore.getState().jobs[jobId]?.status, "completed");
});

test("cancellation before dispatch and during dispatch preserve a valid late receipt", () => {
  const before = new WorkflowCoordinator({ now: () => at });
  const queued = plan("cancel-before");
  assert.equal(before.admitPlan(queued, { jobId: "job-1", undoGroups: 1, authority }).ok, true);
  before.queue(queued.planId);
  before.cancelJob(present(before.jobIdForPlan(queued.planId) ?? undefined, "job id"));
  assert.equal(before.batchForPlan(queued.planId)?.lifecycle, "cancelled");
  const during = new WorkflowCoordinator({ now: () => at });
  const claimed = plan("cancel-during");
  ready(during, claimed);
  const jobId = present(during.jobIdForPlan(claimed.planId) ?? undefined, "job id");
  during.cancelJob(jobId);
  during.receipt(claimed.planId, verifiedReceipt("receipt-late-after-cancel"));
  const state = during.workflowStore.getState();
  assert.equal(state.jobs[jobId]?.status, "cancelled");
  assert.equal(during.batchForPlan(claimed.planId)?.lifecycle, "settled");
  assert.equal(during.batchForPlan(claimed.planId)?.verification.state, "verified");
  assert.equal(state.activeJobId, null, "the late receipt releases the host lease but cannot reopen the cancelled job");
});
