// Tests that archiving keeps the newest terminal job and compacts older history within the byte budget.

import assert from "node:assert/strict";
import { statSync } from "node:fs";
import test from "node:test";
import { createPersistentWorkflowStore } from "../src/index.js";
import type { WorkflowEvent } from "../src/index.js";
import { archivable, planArchive } from "../src/archive.js";
import type { ArchiveView } from "../src/archive.js";
import { authorityEvents, digestFor, dimensionsFor, event, op, present, receipt } from "./fixtures.js";
import { withStore } from "./store-fixtures.js";

type ArchiveJob = ArchiveView["jobs"][string];
type ArchiveBatch = ArchiveView["batches"][string];

const SETTLED: ArchiveBatch = { lifecycle: "settled", recovery: { dispatch: "idle", state: "available" } };

function archiveJob(index: number, updatedAt: string): ArchiveJob {
  return { jobId: `j${index}`, status: "blocked", updatedAt, batchIds: [`b${index}`] };
}

function openedJobs(count: number, goalSummary: string): WorkflowEvent[] {
  return Array.from({ length: count }, (_, index) => timed(event("job.opened", { jobId: `j${index}`, engineId: "workflow-v1", title: `J${index}`, goalSummary, successCriteria: [] }, `j${index}-open`), index));
}

function viewOf(events: readonly WorkflowEvent[]): ArchiveView {
  const indexes = events.map((_, index) => index);
  return {
    activeJobId: null,
    jobs: Object.fromEntries(indexes.map((index) => [`j${index}`, archiveJob(index, present(events[index]).at)])),
    batches: Object.fromEntries(indexes.map((index) => [`b${index}`, SETTLED])),
  };
}

function timed<T extends WorkflowEvent>(value: T, second: number): T {
  return {
    ...value,
    at: `2026-09-20T12:${String(Math.floor(second / 60)).padStart(2, "0")}:${String(second % 60).padStart(2, "0")}.000Z`,
  };
}

function timedAppliedBlockedJob(jobId: string, idx: number): WorkflowEvent[] {
  const stageId = `stage-${idx}`;
  const batchId = `batch-${idx}`;
  const op1 = op();
  return [
    timed(event("job.opened", { jobId, engineId: "workflow-v1", title: `Job ${idx}`, goalSummary: "Test", successCriteria: [] }, `${jobId}-open`), idx),
    timed(event("stage.opened", { jobId, stageId, title: "Composition", purpose: "Test", successCriteria: [] }, `${stageId}-open`), idx),
    timed(event("batch.proposed", { jobId, stageId, batchId, summary: "Batch", dependencies: [] }, `${batchId}-propose`), idx),
    timed(event("operation.proposed", { jobId, stageId, batchId, ordinal: 0, payload: op1 }, `${batchId}-op-propose`), idx),
    ...authorityEvents(jobId, batchId),
    timed(event("batch.admitted", { jobId, stageId, batchId, digest: digestFor(batchId, { jobId, stageId, payloads: [op1] }), snapshotFingerprint: "snap-1", undoUnitId: `undo-${batchId}`, undoUnitCount: 1, dimensions: dimensionsFor(batchId) }, `${batchId}-admit`), idx),
    timed(event("batch.queued", { jobId, batchId }, `${batchId}-queue`), idx),
    timed(event("batch.claimed", { jobId, batchId }, `${jobId}-claim`), idx),
    timed(event("batch.executing", { jobId, batchId }, `${jobId}-execute`), idx),
    timed(event("batch.receipt", { jobId, batchId, receipt: receipt({ receiptId: `receipt-${idx}`, outcomes: [{ operationId: `${batchId}:op:0`, ordinal: 0, type: "set_layer_name", outcome: "confirmed", mutation: "applied", verification: "verified", mayHaveMutated: true, basis: "fresh-readback", observedFingerprint: "snap-2" }] }) }, `${jobId}-receipt`), idx),
    timed(event("job.blocked", { jobId, reason: "workflow:test" }, `${jobId}-blocked`), idx),
  ];
}


test("planArchive returns oldest archivable jobs beyond retention", () => {
  const events = openedJobs(7, "Test");
  const view = viewOf(events);
  const result = planArchive(view, events);
  assert.deepEqual(Array.from(result).sort(), ["j0", "j1", "j2"], "archives oldest three when byte budget is tiny");

  assert.equal(archivable(view, "j0"), true, "j0 is archivable");
  const queuedView: ArchiveView = { ...view, batches: { ...view.batches, b4: { lifecycle: "queued", recovery: { dispatch: "idle", state: "available" } } } };
  assert.equal(archivable(queuedView, "j4"), false, "job with queued batch is not archivable");

  const activeView: ArchiveView = { ...view, activeJobId: "j3" };
  assert.equal(archivable(activeView, "j3"), false, "active job is never archivable");

  const activeJobView: ArchiveView = { ...view, jobs: { ...view.jobs, j6: { ...archiveJob(6, present(events[6]).at), status: "active" } } };
  assert.equal(archivable(activeJobView, "j6"), false, "job with status active is not archivable");

  const tiedView: ArchiveView = { ...view, jobs: { ...view.jobs, j5: archiveJob(5, present(events[6]).at), j6: archiveJob(6, present(events[6]).at) } };
  const tieResult = planArchive(tiedView, [...events, ...events]);
  assert.ok(!Array.from(tieResult).includes("j6"), "newer job with later event index is not archived when bytes are tiny");
});

test("planArchive archives multiple jobs to fit byte budget", () => {
  const events = openedJobs(5, "x".repeat(30000));
  const result = planArchive(viewOf(events), events);
  assert.ok(result.size > 1, "archives more than the oldest one when byte budget requires it");
});

test("planArchive with few archivable jobs never adds undefined", () => {
  const events = openedJobs(2, "x".repeat(100000));
  const result = planArchive(viewOf(events), events);
  assert.deepEqual([...result], ["j0"], "the older job is archived; the newest is always kept");
  assert.ok([...result].every((id) => typeof id === "string"), "set contains only string ids, never undefined");
});

test("store archives 7 of 12 jobs with timestamps, keeping the newest 4 plus one active opening", () => withStore((filePath) => {
  const store = createPersistentWorkflowStore({ filePath });
  for (let idx = 0; idx < 12; idx += 1) {
    store.appendBatch(timedAppliedBlockedJob(`job-applied-${idx}`, idx));
  }
  const remainingJobs = Object.keys(store.getState().jobs);
  assert.equal(remainingJobs.length, 5, `exactly 5 jobs remain (4 blocked + 1 for internal state): ${remainingJobs.join(", ")}`);
  assert.ok(remainingJobs.includes("job-applied-11"), "newest job job-applied-11 is present");
  assert.ok(!remainingJobs.includes("job-applied-0"), "oldest job job-applied-0 is absent");
  store.close();
}));

test("store keeps large jobs under file size limit", () => withStore((filePath) => {
  const store = createPersistentWorkflowStore({ filePath });
  for (let idx = 0; idx < 30; idx += 1) {
    store.appendBatch(timedAppliedBlockedJob(`job-large-${idx}`, idx));
    const fileSizeBytes = statSync(filePath).size;
    assert.ok(fileSizeBytes < 200 * 1024, `file size ${fileSizeBytes} stays under 200 KB after job ${idx}`);
  }
  store.append(event("job.opened", { jobId: "job-final", engineId: "workflow-v1", title: "Final", goalSummary: "After large jobs", successCriteria: [] }, "job-final-open"));
  assert.equal(store.getState().activeJobId, "job-final");
  store.close();
}));


test("planArchive never archives the newest terminal job, however far over budget it is", () => {
  const events: WorkflowEvent[] = [
    { ...event("job.opened", { jobId: "j0", engineId: "workflow-v1", title: "Old", goalSummary: "old", successCriteria: [] }, "old-open"), at: "2026-10-14T00:00:00.000Z" },
    { ...event("job.opened", { jobId: "j1", engineId: "workflow-v1", title: "New", goalSummary: "x".repeat(200 * 1024), successCriteria: [] }, "new-open"), at: "2026-10-14T01:00:00.000Z" },
  ];
  const result = planArchive(viewOf(events), events);
  assert.equal(result.has("j1"), false, "the blocked job a retry or continue picks up stays in the live store");
  assert.equal(result.has("j0"), true, "older history still goes to the archive to make room");
});
