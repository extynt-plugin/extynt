// Tests the in-memory store, including its event-log limit.

import assert from "node:assert/strict";
import test from "node:test";
import { createInMemoryWorkflowStore, MAX_WORKFLOW_EVENT_LOG_BYTES, WorkflowTransitionError } from "../src/index.js";
import type { WorkflowEvent, WorkflowStore } from "../src/index.js";
import { at, dimensionsFor, event, baseEvents, throwsCode } from "./fixtures.js";

function appendExpectingLogFull(store: WorkflowStore, next: WorkflowEvent): boolean {
  const before = store.getState();
  try {
    store.append(next);
  } catch (error) {
    assert(error instanceof WorkflowTransitionError && error.code === "EVENT_LOG_FULL");
    assert.deepEqual(store.getState(), before);
    return true;
  }
  return false;
}

function capacityOpen(jobId: string): WorkflowEvent[] {
  return [
    event("job.opened", { jobId, engineId: "workflow-v1", title: "Capacity", goalSummary: "Fill the bounded event log", successCriteria: [] }, `${jobId}-open`),
    event("stage.opened", { jobId, stageId: `${jobId}-stage`, title: "Capacity", purpose: "Capacity test", successCriteria: [] }, `${jobId}-stage-open`),
  ];
}

function capacityObservation(jobId: string, index: number): WorkflowEvent {
  return event("observation.recorded", { jobId, evidence: { evidenceId: `${jobId}-evidence-${index}`, jobId, kind: "structural", basis: "x".repeat(900), recordedAt: at } }, `${jobId}-observation-${index}`);
}

test("WorkflowStore append is transactional when the bounded event log is full", () => {
  const store = createInMemoryWorkflowStore(capacityOpen("log-job"));
  let rejected = false;
  for (let index = 0; index < 20_000 && !rejected; index += 1) rejected = appendExpectingLogFull(store, capacityObservation("log-job", index));
  assert.equal(rejected, true);
});

test("one active job has room for a whole film: a megabyte of authoring is far inside the bound", () => {
  const store = createInMemoryWorkflowStore(capacityOpen("film-job"));
  const megabyteOfEvents = Math.ceil(1_024 * 1_024 / 1_000);
  for (let index = 0; index < megabyteOfEvents; index += 1) store.append(capacityObservation("film-job", index));
  assert.equal(store.listEvents("film-job").length, megabyteOfEvents + 2);
  assert.ok(MAX_WORKFLOW_EVENT_LOG_BYTES >= 8 * 1_024 * 1_024);
});

test("appendBatch is atomic for mid-bundle invalidity and event-log capacity", () => {
  const store = createInMemoryWorkflowStore();
  const before = store.serialize();
  throwsCode(() => store.appendBatch([...baseEvents().slice(0, -2), event("batch.admitted", { jobId: "job-1", stageId: "stage-1", batchId: "batch-1", digest: "wrong", snapshotFingerprint: "snap-1", undoUnitId: "undo-batch-1", undoUnitCount: 1, dimensions: dimensionsFor("batch-1") }, "bad-admit")]), "INVALID_EVENT");
  assert.equal(store.serialize(), before);
  assert.equal(store.listEvents("job-1").length, 0);

  const bounded = createInMemoryWorkflowStore();
  const oversizedBundle: WorkflowEvent[] = capacityOpen("job-cap");
  const pastTheBound = Math.ceil(MAX_WORKFLOW_EVENT_LOG_BYTES / 1_000);
  for (let index = 0; index < pastTheBound; index += 1) oversizedBundle.push(capacityObservation("job-cap", index));
  const capacityBefore = bounded.serialize();
  throwsCode(() => bounded.appendBatch(oversizedBundle), "EVENT_LOG_FULL");
  assert.equal(bounded.serialize(), capacityBefore);
  assert.equal(bounded.listEvents("job-cap").length, 0);
});
