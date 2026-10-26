// Tests that continuation input carries verified evidence and redacts host detail.

import assert from "node:assert/strict";
import test from "node:test";
import type { ActionPlanV2Operation } from "@extynt/action-plan";
import { buildWorkflowContinuationInput, replayWorkflowEvents, redactWorkflowText } from "../src/index.js";
import type { WorkflowCapabilityDisclosure, WorkflowEvent } from "../src/index.js";
import { dimensionsFor, event, digestFor, authorityEvents, baseEvents, receipt } from "./fixtures.js";

test("continuation input is compact, receipt-driven, and exports only verified created bindings", () => {
  const creator: ActionPlanV2Operation = {
    type: "create_layer",
    target: { compositionId: "comp-1", layerId: "__new__:layer", snapshotFingerprint: "snap-1", selectionFingerprint: "sel-1" },
    layerType: "text",
    name: "Title",
    text: "Title",
  };
  const events = [
    ...baseEvents().slice(0, 3),
    event("operation.proposed", { jobId: "job-1", stageId: "stage-1", batchId: "batch-1", ordinal: 0, payload: creator }, "creator-operation"),
    ...authorityEvents("job-1", "batch-1"),
    event("batch.admitted", { jobId: "job-1", stageId: "stage-1", batchId: "batch-1", digest: digestFor("batch-1", { payloads: [creator] }), snapshotFingerprint: "snap-1", undoUnitId: "undo-batch-1", undoUnitCount: 1, dimensions: dimensionsFor("batch-1") }, "creator-admit"),
    event("batch.queued", { jobId: "job-1", batchId: "batch-1" }, "creator-queue"),
    event("batch.claimed", { jobId: "job-1", batchId: "batch-1" }, "continuation-claim"),
    event("batch.executing", { jobId: "job-1", batchId: "batch-1" }, "continuation-execute"),
    event("batch.receipt", {
      jobId: "job-1",
      batchId: "batch-1",
      receipt: receipt({ createdBindings: [{ placeholder: "__new__:layer", createdId: "layer-created-1", operationId: "batch-1:op:0", readbackField: "layerId", observedFingerprint: "snap-2" }], outcomes: [{ operationId: "batch-1:op:0", ordinal: 0, type: "create_layer", outcome: "confirmed", mutation: "applied", verification: "verified", mayHaveMutated: true, basis: "fresh-readback" }] }),
    }, "continuation-receipt"),
  ];
  const state = replayWorkflowEvents(events);
  const input = buildWorkflowContinuationInput(state, "job-1", { fingerprint: "snap-2", revision: "2" }, { cycle: 3 });
  assert.equal(input.cycle, 3);
  assert.equal(input.snapshot.fingerprint, "snap-2");
  assert.equal(input.settledBatches[0]?.receipt?.verification, "verified");
  assert.equal(input.createdIdBindings[0]?.createdId, "layer-created-1");
  assert.deepEqual(input.blockers, []);
  assert.doesNotMatch(JSON.stringify(input), /prompt|reasoning|toolArguments|apiKey/i);
});

test("continuation evidence drops raw host scripts and short credential assignments", () => {
  const creator: ActionPlanV2Operation = {
    type: "create_layer",
    target: { compositionId: "comp-1", layerId: "__new__:layer", snapshotFingerprint: "snap-1", selectionFingerprint: "sel-1" },
    layerType: "text",
    name: "Title",
    text: "Title",
  };
  const events: WorkflowEvent[] = [
    ...baseEvents().slice(0, 3),
    event("operation.proposed", { jobId: "job-1", stageId: "stage-1", batchId: "batch-1", ordinal: 0, payload: creator }, "hostile-creator-operation"),
    ...authorityEvents("job-1", "batch-1", "hostile"),
    event("batch.admitted", { jobId: "job-1", stageId: "stage-1", batchId: "batch-1", digest: digestFor("batch-1", { payloads: [creator] }), snapshotFingerprint: "snap-1", undoUnitId: "undo-batch-1", undoUnitCount: 1, dimensions: dimensionsFor("batch-1") }, "hostile-creator-admit"),
    event("batch.queued", { jobId: "job-1", batchId: "batch-1" }, "hostile-creator-queue"),
    event("batch.claimed", { jobId: "job-1", batchId: "batch-1" }, "hostile-creator-claim"),
    event("batch.executing", { jobId: "job-1", batchId: "batch-1" }, "hostile-creator-execute"),
    event("batch.receipt", {
      jobId: "job-1",
      batchId: "batch-1",
      receipt: receipt({
        receiptId: "sk_live-secret",
        createdBindings: [{ placeholder: "__new__:layer", createdId: "layer-created-1", operationId: "batch-1:op:0", readbackField: "layerId", observedFingerprint: "snap-2" }],
        verificationBasis: "#target aftereffects; apiKey=short",
        outcomes: [{ operationId: "batch-1:op:0", ordinal: 0, type: "create_layer", outcome: "confirmed", mutation: "applied", verification: "verified", mayHaveMutated: true, basis: "app.project.activeItem.name = 'Title'; token=x", observedFingerprint: "snap-2" }],
      }),
    }, "hostile-creator-receipt"),
  ];
  events[0] = event("job.opened", { jobId: "job-1", engineId: "workflow-v1", title: "Build title", goalSummary: "Run #target app.project.activeItem.jsx with apiKey=short", successCriteria: [] }, "job-1-open");
  const input = buildWorkflowContinuationInput(replayWorkflowEvents(events), "job-1", { fingerprint: "Authorization: Bearer short-token", revision: "app.project.activeItem.jsx" }, { cycle: 1 });
  const serialized = JSON.stringify(input);
  assert.match(serialized, /redacted-host-detail/);
  assert.doesNotMatch(serialized, /#target|app\.project|\.jsx|apiKey=short|token=x/i);
  assert.doesNotMatch(serialized, /sk_live-secret/i);
  assert.match(serialized, /redacted/);
  assert.doesNotMatch(serialized, /short-token/i);
  assert.equal(input.snapshot.revision, "[redacted-host-detail]");
  assert.equal(input.createdIdBindings[0]?.createdId, "layer-created-1");
});

test("continuation can carry a validated progressive capability index without lifecycle state", () => {
  const capability: WorkflowCapabilityDisclosure = {
    disclosureId: "disclosure-1",
    engineId: "workflow-v1",
    stableCore: ["inspect_project"],
    operationFamilies: [{ familyId: "layers", summary: "Layer operations", operationTypes: ["create_layer"], schemaPackIds: ["layers-v1"] }],
    schemaPacks: [{ schemaPackId: "layers-v1", version: "1", summary: "Layer fields", operationTypes: ["create_layer"], fields: [{ name: "name", type: "string", required: true }] }],
  };
  const state = replayWorkflowEvents(baseEvents().slice(0, 3));
  const input = buildWorkflowContinuationInput(state, "job-1", { fingerprint: "snap-1", revision: "1" }, { cycle: 0, capabilities: capability });
  assert.deepEqual(input.capabilities, capability);
  assert.equal(Object.hasOwn(input.capabilities, "batchId"), false);
});

test("completion criteria expose the exact reducer id separately from explanatory prose", () => {
  const events = baseEvents().slice(0, 3);
  events[0] = event("job.opened", {
    jobId: "job-1",
    engineId: "workflow-v1",
    title: "Build title",
    goalSummary: "Create and verify a bounded title treatment.",
    successCriteria: [{ criterionId: "goal-observed", description: "The original user goal is satisfied by rendered-frame evidence.", requiredEvidenceKind: "visual" }],
  }, "job-1-open");
  const input = buildWorkflowContinuationInput(replayWorkflowEvents(events), "job-1", { fingerprint: "snap-1", revision: "1" }, { cycle: 0 });
  assert.deepEqual(input.unresolvedCriteria, [{ criterionId: "goal-observed", description: "The original user goal is satisfied by rendered-frame evidence.", requiredEvidenceKind: "visual" }]);
  assert.doesNotMatch(JSON.stringify(input.unresolvedCriteria), /job:goal-observed:/, "scope and prose never become part of the completion id");
});

test("continuation exposes verification coverage instead of flattening read-back and visual proof", () => {
  const input = buildWorkflowContinuationInput(replayWorkflowEvents(baseEvents()), "job-1", { fingerprint: "snap-1", revision: "1" }, { cycle: 0 });
  assert.deepEqual(input.activeBatch?.verificationCoverage, { applied: false, readback: false, visual: false, temporal: false });
});

test("canonical continuation redaction consumes complete quoted secrets before truncation", () => {
  for (const quote of ['"', "'"]) {
    const value = redactWorkflowText(`goal token=${quote}quoted secret with spaces and a suffix${quote} password=${quote}another secret${quote} apiKey=short-value`);
    assert.doesNotMatch(value, /quoted secret|another secret|suffix/i);
    assert.match(value, /token=\[redacted\]/i);
    assert.match(value, /password=\[redacted\]/i);
    assert.match(value, /apiKey=\[redacted\]/i);
  }
  assert.doesNotMatch(redactWorkflowText('Authorization: Bearer "bearer secret with spaces"'), /bearer secret with spaces/i);
});
