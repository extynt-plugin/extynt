// Tests that batch admission binds verified dimensions, operation payloads and digests, and rejects oversized or malformed input.

import test from "node:test";
import assert from "node:assert/strict";
import type { ActionPlanV2Operation } from "@extynt/action-plan";
import { applyWorkflowEvent, classifyWorkflowPolicy, replayWorkflowEvents, validateAdmissionDimensions } from "../src/index.js";
import type { JsonValue } from "@extynt/decode";
import { op, dimensionsFor, event, digestFor, baseEvents, executingState, present, receipt, throwsCode } from "./fixtures.js";
import { validateOperationPayloads } from "../src/admission-validation.js";

test("admission requires verified independent dimensions, verified dependencies, valid operations, and a bound digest", () => {
  const proposed = replayWorkflowEvents(baseEvents().slice(0, 11));
  const admission = present(baseEvents()[11], "the admission event");
  throwsCode(() => applyWorkflowEvent(proposed, Object.assign({}, admission, { dimensions: { ...dimensionsFor("batch-1"), hostCapability: { ...dimensionsFor("batch-1").hostCapability, state: "unknown" } } })), "INVALID_EVENT");
  throwsCode(() => applyWorkflowEvent(proposed, Object.assign({}, admission, { digest: "not-the-canonical-digest" })), "INVALID_EVENT");
  const rawOperation: ActionPlanV2Operation = Object.assign({}, op(), { unexpected: "raw-field" });
  const rawProposed = replayWorkflowEvents([
    ...baseEvents().slice(0, 3),
    event("operation.proposed", { jobId: "job-1", stageId: "stage-1", batchId: "batch-1", ordinal: 0, payload: rawOperation }, "raw-operation"),
  ]);
  throwsCode(() => applyWorkflowEvent(rawProposed, Object.assign({}, admission, { digest: digestFor("batch-1", { payloads: [rawOperation] }) })), "INVALID_EVENT");
});

test("recursive and oversized JSON payloads are rejected before signing or cloning", () => {
  const deep = Array.from({ length: 20 }).reduce<JsonValue>((inner) => ({ next: inner }), {});
  throwsCode(() => applyWorkflowEvent(replayWorkflowEvents(baseEvents().slice(0, 3)), event("operation.proposed", { jobId: "job-1", stageId: "stage-1", batchId: "batch-1", ordinal: 0, payload: Object.assign({}, op(), { nested: deep }) }, "deep-operation")), "LIMIT_EXCEEDED");
  throwsCode(() => applyWorkflowEvent(replayWorkflowEvents([]), event("job.opened", { jobId: "big-job", engineId: "workflow-v1", title: "x".repeat(257), goalSummary: "goal", successCriteria: [] }, "oversized-job")), "INVALID_EVENT");
});

test("blocked owners cannot open or dispatch more work, and UTF-8 bounds are byte based", () => {
  const blocked = applyWorkflowEvent(executingState(), event("batch.receipt", { jobId: "job-1", batchId: "batch-1", receipt: receipt({ receiptId: "blocked", verification: "failed", verificationBasis: "readback", observedFingerprint: "bad" }) }, "blocked-event"));
  throwsCode(() => applyWorkflowEvent(blocked, event("stage.opened", { jobId: "job-1", stageId: "stage-new", title: "new", purpose: "new", successCriteria: [] }, "blocked-stage")), "ILLEGAL_TRANSITION");
  throwsCode(() => applyWorkflowEvent(replayWorkflowEvents([]), event("job.opened", { jobId: "unicode", engineId: "workflow-v1", title: "é".repeat(200), goalSummary: "goal", successCriteria: [] }, "unicode-job")), "INVALID_EVENT");
});

test("dimension facts enforce honest automatic-policy combinations", () => {
  const facts = { schemaValue: { state: "valid", evidenceId: "schema-1", basis: "validator" }, targetDependency: { state: "resolved", evidenceId: "target-1", basis: "resolver" }, hostCapability: { state: "supported", evidenceId: "host-1", basis: "capability" }, verificationCapability: { state: "exact", evidenceId: "verify-1", basis: "readback" }, mutationBehavior: { state: "destructive", evidenceId: "mutation-1", basis: "plan" }, recovery: { state: "fully_undoable", evidenceId: "recovery-1", basis: "undo" }, policy: { decision: "automatic", evidenceId: "policy-1", basis: "policy" } } as const;
  throwsCode(() => validateAdmissionDimensions(facts), "INVALID_EVENT");
  validateAdmissionDimensions({ ...facts, mutationBehavior: { ...facts.mutationBehavior, state: "ensuring" } });
});

test("policy classification keeps automatic, manual-only, probationary, and blocked facts distinct", () => {
  const safe = dimensionsFor("policy-safe");
  assert.deepEqual(classifyWorkflowPolicy(safe), { policyClass: "automatic", approvalRequired: false, reasons: [] });
  assert.equal(classifyWorkflowPolicy({ ...safe, policy: { ...safe.policy, decision: "manual" } }).policyClass, "manual-only");
  assert.equal(classifyWorkflowPolicy({ ...safe, hostCapability: { ...safe.hostCapability, state: "probationary" } }).policyClass, "probationary");
  const blocked = classifyWorkflowPolicy({ ...safe, targetDependency: { ...safe.targetDependency, state: "unknown" } });
  assert.equal(blocked.policyClass, "blocked");
  assert.match(blocked.reasons.join(" "), /unresolved/i);
});

test("intrinsically unobservable work is manual-only, never automatic", () => {
  const safe = dimensionsFor("unobservable");
  const manual = { ...safe, verificationCapability: { ...safe.verificationCapability, state: "intrinsically_unobservable" as const }, policy: { ...safe.policy, decision: "manual" as const } };
  validateAdmissionDimensions(manual);
  assert.equal(classifyWorkflowPolicy(manual).policyClass, "manual-only");
  const automatic = { ...manual, policy: { ...manual.policy, decision: "automatic" as const } };
  throwsCode(() => validateAdmissionDimensions(automatic), "INVALID_EVENT");
  assert.equal(classifyWorkflowPolicy(automatic).policyClass, "manual-only");
});

test("admission dimensions reject every malformed runtime enum before policy branching", () => {
  for (const [dimension, key] of [["mutationBehavior", "state"], ["recovery", "state"], ["policy", "decision"]] as const) {
    const valid = dimensionsFor("enum-check");
    const malformed = { ...valid, [dimension]: { ...valid[dimension], [key]: "not-a-real-enum" } };
    throwsCode(() => validateAdmissionDimensions(malformed), "INVALID_EVENT");
  }
});

test("workflow admission accepts project operations without layer targets", () => {
  const create = { type: "create_composition" as const, newCompositionId: "__new__:scene", snapshotFingerprint: "snapshot-1", selectionFingerprint: "selection-1", name: "Midnight Tram", width: 1080, height: 1080, durationSeconds: 7, frameRate: 30 };
  validateOperationPayloads([create], "snapshot-1");
  throwsCode(() => validateOperationPayloads([{ ...create, selectionFingerprint: "stale-selection" }, { ...create, newCompositionId: "__new__:other", selectionFingerprint: "selection-1" }], "snapshot-1"), "INVALID_EVENT");
});
