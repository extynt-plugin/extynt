/** What a continuation cycle is told it is for, and what the user reads while it runs (slice H2). */
import assert from "node:assert/strict";
import test from "node:test";
import { WORKFLOW_SCHEMA_VERSION, type WorkflowContinuationInput } from "@extynt/workflow";
import { appliedUnverifiedMessage } from "../src/server-workflow-cycle-batches.js";
import { workflowCycleInput, type WorkflowCycleTurnInput } from "../src/server-workflow-cycle-brief.js";
import { hasPendingCoverage, coverageRefusal, takePendingCoverage } from "../src/request-coverage.js";
import { mutableSnapshot, sidecarFor, token } from "./sidecar-fixture.js";
import { workflowCycleContract } from "../src/workflow-contract.js";

const UNPROVEN_VISUAL: WorkflowContinuationInput = {
  schemaVersion: WORKFLOW_SCHEMA_VERSION, jobId: "job-1", goalSummary: "Build rings", goalDigest: "digest", stageId: "stage-1", stageStatus: "active", cycle: 1, batchCount: 1,
  snapshot: { fingerprint: "fp-1", revision: null }, activeBatch: null, createdIdBindings: [], unresolvedCriteria: [], blockers: [], limits: { maxStages: 4, maxBatches: 8, maxOperations: 64 },
  settledBatches: [{ batchId: "batch-1", stageId: "stage-1", lifecycle: "settled", execution: "executed", mutation: "applied", verification: "applied_unverified", verificationCoverage: { applied: true, readback: false, visual: false, temporal: false }, receipt: null }],
};
const turn: WorkflowCycleTurnInput["turn"] = { requestId: "req-1", message: "Build rings", history: [], autoApply: true };
const cycleOf = (extra: Partial<WorkflowCycleTurnInput>) => workflowCycleInput({ turn, seed: "seed-1", cycle: 1, goal: "Build rings with a repeater", continuation: UNPROVEN_VISUAL, orchestration: undefined, admissionRefusal: undefined, ...extra });

test("a continuation with nothing missing and an unproven picture is the read-only observation pass, and says so", () => {
  const input = cycleOf({});
  assert.equal(input.workflowObservationOnly, true);
  assert.match(input.message, /read-only capture\/observation pass/);
  assert.match(workflowCycleContract(input) ?? "", /OBSERVATION CONTRACT/);
});

test("a continuation that carries a coverage refusal is a build cycle, never observation-only, and says what it is for", () => {
  const input = cycleOf({ coverage: ["a shape Repeater"] });
  assert.equal(input.workflowObservationOnly, undefined, "the flag is not set for a cycle that mutates");
  assert.doesNotMatch(input.message, /read-only/);
  assert.match(input.message, /This is a build cycle: queue the missing features/);
  assert.match(input.message, /ae_workflow_complete with no arguments/, "completion is the one instruction; no manual capture");
  assert.match(input.message, /do not capture or observe frames just to complete/);
  assert.doesNotMatch(workflowCycleContract(input) ?? "", /OBSERVATION CONTRACT/);
});

test("a repair continuation is named as a repair cycle", () => {
  const input = cycleOf({ continuation: null, admissionRefusal: { planId: "plan-1", code: "LIMIT_EXCEEDED", message: "too big" } });
  assert.match(input.message, /This is a repair cycle/);
});

test("the contract no longer tells the model to capture a frame before animating or to complete", () => {
  const contract = workflowCycleContract({ workflowJobId: "seed-1", workflowCycle: 1 }) ?? "";
  assert.match(contract, /never capture just to complete/);
  assert.match(contract, /the sidecar measured a frame of the built scene/);
  assert.doesNotMatch(contract, /after its receipt, capture a frame/);
});

test("the text the user reads while an unverified stage continues matches the cycle that follows", () => {
  assert.match(appliedUnverifiedMessage({ execution: { receipt: null } }, false), /read-only visual observation/);
  assert.doesNotMatch(appliedUnverifiedMessage({ execution: { receipt: null } }, true), /read-only/);
  assert.match(appliedUnverifiedMessage({ execution: { receipt: null } }, true), /bounded build batch/);
});

test("a pending coverage refusal can be peeked without being handed over", () => {
  const sidecar = sidecarFor({ port: 0, token, quietAgentLog: true });
  sidecar.latest = { snapshot: mutableSnapshot("h2-peek"), receivedAt: "2026-09-24T00:00:00.000Z", bytes: 1 };
  const snapshot = sidecar.normalizedLatest();
  assert.ok(snapshot);
  const jobId = "job-peek-h2";
  assert.equal(hasPendingCoverage(jobId), false);
  coverageRefusal(jobId, "add a repeater on the rings", snapshot, []);
  assert.equal(hasPendingCoverage(jobId), true, "peeking sees the refusal");
  assert.equal(hasPendingCoverage(jobId), true, "and does not consume it");
  assert.ok(takePendingCoverage(jobId), "the cycle still receives it");
  assert.equal(hasPendingCoverage(jobId), false);
});
