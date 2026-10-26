// Tests that the durable store replays exact state, fails closed on bad files and keeps recovery guards across restarts.

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import test from "node:test";
import type { ActionPlanV2Operation } from "@extynt/action-plan";
import { createPersistentWorkflowStore, WorkflowTransitionError } from "../src/index.js";
import type { WorkflowEvent, WorkflowReceipt } from "../src/index.js";
import { at, authorityEvents, baseEvents, dimensionsFor, digestFor, event, parsedObject, present, receipt } from "./fixtures.js";
import { assertStorageCode, recoveryDisposition, storedGeneration, withStore } from "./store-fixtures.js";

test("persistent store creates its authority file before accepting a job and replays exact state", () => withStore((filePath) => {
  const store = createPersistentWorkflowStore({ filePath });
  assert.equal(store.resumeSupported, true);
  assert.equal(storedGeneration(filePath), 0);
  store.appendBatch(baseEvents());
  const expected = store.getState();
  store.close();

  const restarted = createPersistentWorkflowStore({ filePath });
  assert.deepEqual(restarted.getState(), expected);
  assert.equal(restarted.getState().resumeSupported, true);
  assert.equal(restarted.listEvents("job-1").length, baseEvents().length);
  restarted.close();
}));

test("durable append is idempotent and invalid bundles leave disk and memory unchanged", () => withStore((filePath) => {
  const store = createPersistentWorkflowStore({ filePath });
  const opened = present(baseEvents()[0]);
  store.append(opened);
  const once = readFileSync(filePath, "utf8");
  store.append(opened);
  assert.equal(readFileSync(filePath, "utf8"), once);
  const before = store.serialize();
  assert.throws(() => store.append(present(baseEvents()[2])), WorkflowTransitionError);
  assert.equal(store.serialize(), before);
  assert.equal(readFileSync(filePath, "utf8"), once);
  store.close();
}));

test("terminal history is archived so hundreds of sequential jobs survive restarts", () => withStore((filePath) => {
  let store = createPersistentWorkflowStore({ filePath });
  for (let index = 0; index < 200; index += 1) {
    const jobId = `job-${index}`;
    store.append(event("job.opened", { jobId, engineId: "workflow-v1", title: `Job ${index}`, goalSummary: "Bounded sequential work.", successCriteria: [] }, `${jobId}-open`));
    store.append(event("job.cancelled", { jobId }, `${jobId}-cancel`));
    if (index > 0 && index % 25 === 0) { store.close(); store = createPersistentWorkflowStore({ filePath }); }
  }
  assert.equal(store.getState().activeJobId, null);
  assert.ok(Object.keys(store.getState().jobs).length < 64);
  assert.ok(readFileSync(`${filePath}.archive.jsonl`, "utf8").includes("job-"));
  store.close();
  const restarted = createPersistentWorkflowStore({ filePath });
  restarted.append(event("job.opened", { jobId: "job-after-restart", engineId: "workflow-v1", title: "Still works", goalSummary: "Admission remains available.", successCriteria: [] }, "job-after-restart-open"));
  assert.equal(restarted.getState().activeJobId, "job-after-restart");
  restarted.close();
}));

test("recovery allows only work with no durable claim and preserves duplicate-dispatch guards", () => withStore((filePath) => {
  const queued = createPersistentWorkflowStore({ filePath });
  queued.appendBatch(baseEvents());
  queued.close();
  assert.equal(recoveryDisposition(filePath), "safe_to_resume");

  const claimed = createPersistentWorkflowStore({ filePath });
  claimed.append(event("batch.claimed", { jobId: "job-1", batchId: "batch-1" }, "claim"));
  claimed.close();
  assert.equal(recoveryDisposition(filePath), "blocked_uncertain");
  const restarted = createPersistentWorkflowStore({ filePath });
  assert.throws(() => restarted.append(event("batch.claimed", { jobId: "job-1", batchId: "batch-1" }, "second-claim")), WorkflowTransitionError);
  assert.deepEqual(restarted.getState().activeDispatchLease, { kind: "apply", jobId: "job-1", batchId: "batch-1" });
  restarted.close();
}));

test("executing and every non-verified receipt remain blocked after restart", () => {
  const cases: readonly { readonly name: string; readonly value: WorkflowReceipt }[] = [
    { name: "applied-unverified", value: receipt({ receiptId: "unverified", verification: "applied_unverified" }) },
    { name: "failed", value: receipt({ receiptId: "failed", execution: "failed_during_apply", mutation: "may_have_mutated", mayHaveMutated: true, verification: "failed" }) },
    { name: "unknown", value: receipt({ receiptId: "unknown", execution: "unknown", mutation: "unknown", mayHaveMutated: true, verification: "unknown" }) },
  ];
  for (const current of cases) withStore((filePath) => {
    const store = createPersistentWorkflowStore({ filePath });
    store.appendBatch([...baseEvents(), event("batch.claimed", { jobId: "job-1", batchId: "batch-1" }, `${current.name}-claim`), event("batch.executing", { jobId: "job-1", batchId: "batch-1" }, `${current.name}-execute`)]);
    store.close();
    assert.equal(recoveryDisposition(filePath), "blocked_uncertain", `${current.name} executing`);
    const executing = createPersistentWorkflowStore({ filePath });
    executing.append(event("batch.receipt", { jobId: "job-1", batchId: "batch-1", receipt: current.value }, `${current.name}-receipt`));
    executing.close();
    assert.equal(recoveryDisposition(filePath), "blocked_uncertain", `${current.name} receipt`);
  });
});

test("pre-dispatch rejection blocks while cancellation before dispatch is terminal", () => {
  withStore((filePath) => {
    const store = createPersistentWorkflowStore({ filePath });
    store.appendBatch([
      ...baseEvents(),
      event("batch.rejected", { jobId: "job-1", batchId: "batch-1", receipt: receipt({ receiptId: "rejected", execution: "rejected_before_apply", mutation: "none", mayHaveMutated: false, verification: "not_requested" }) }, "rejected"),
    ]);
    store.close();
    assert.equal(recoveryDisposition(filePath), "blocked_uncertain");
  });
  withStore((filePath) => {
    const store = createPersistentWorkflowStore({ filePath });
    store.appendBatch([...baseEvents(), event("batch.cancelRequested", { jobId: "job-1", batchId: "batch-1" }, "cancel")]);
    store.close();
    assert.equal(recoveryDisposition(filePath), "settled");
  });
});

test("verified closure and distinct late reconciliation survive repeated replay", () => withStore((filePath) => {
  const uncertain: WorkflowEvent[] = [
    ...baseEvents(),
    event("batch.claimed", { jobId: "job-1", batchId: "batch-1" }, "claim"),
    event("batch.executing", { jobId: "job-1", batchId: "batch-1" }, "execute"),
    event("batch.receipt", { jobId: "job-1", batchId: "batch-1", receipt: receipt({ receiptId: "lost", execution: "unknown", mutation: "unknown", mayHaveMutated: true, verification: "unknown" }) }, "lost-receipt"),
  ];
  const store = createPersistentWorkflowStore({ filePath });
  store.appendBatch(uncertain);
  store.close();
  const late = createPersistentWorkflowStore({ filePath });
  late.append(event("batch.reconciled", { jobId: "job-1", batchId: "batch-1", priorReceiptId: "lost", receipt: receipt({ receiptId: "late", receivedAt: at }) }, "late-reconciliation"));
  const expected = late.serialize();
  late.close();
  assert.equal(recoveryDisposition(filePath), "settled");
  for (let replay = 0; replay < 3; replay += 1) {
    const restarted = createPersistentWorkflowStore({ filePath });
    assert.equal(restarted.serialize(), expected);
    assert.deepEqual(restarted.getState().batches["batch-1"]?.execution.receiptHistory.map((value) => value.receiptId), ["lost", "late"]);
    restarted.close();
  }
}));

test("corrupt, truncated, and incompatible stores fail closed without replacement", () => {
  const values = [
    { name: "truncated", contents: '{"format":' , code: "CORRUPT_STORAGE" },
    { name: "corrupt", contents: "{}", code: "INCOMPATIBLE_VERSION" },
  ] as const;
  for (const value of values) withStore((filePath) => {
    writeFileSync(filePath, value.contents, "utf8");
    assertStorageCode(() => createPersistentWorkflowStore({ filePath }), value.code);
    assert.equal(readFileSync(filePath, "utf8"), value.contents, value.name);
  });
  withStore((filePath) => {
    const store = createPersistentWorkflowStore({ filePath });
    store.close();
    const incompatible = { ...parsedObject(readFileSync(filePath, "utf8")), storageVersion: 2 };
    writeFileSync(filePath, JSON.stringify(incompatible), "utf8");
    assertStorageCode(() => createPersistentWorkflowStore({ filePath }), "INCOMPATIBLE_VERSION");
  });
});

test("closed stores reject all further authority access", () => withStore((filePath) => {
  const store = createPersistentWorkflowStore({ filePath });
  store.close();
  assertStorageCode(() => store.getState(), "STORE_CLOSED");
  assertStorageCode(() => store.appendBatch([]), "STORE_CLOSED");
}));

test("provider-cycle position is reducer-owned, monotonic, bounded, and durable", () => withStore((filePath) => {
  const store = createPersistentWorkflowStore({ filePath });
  store.append(present(baseEvents()[0]));
  store.append(event("job.providerCycleClosed", { jobId: "job-1", cycle: 1 }, "cycle-1"));
  store.append(event("job.providerCycleClosed", { jobId: "job-1", cycle: 2 }, "cycle-2"));
  assert.throws(() => store.append(event("job.providerCycleClosed", { jobId: "job-1", cycle: 4 }, "cycle-skip")), WorkflowTransitionError);
  store.close();
  const restarted = createPersistentWorkflowStore({ filePath });
  assert.equal(restarted.loadJob("job-1").providerCycle, 2);
  assert.throws(() => restarted.append(event("job.providerCycleClosed", { jobId: "job-1", cycle: 2 }, "cycle-repeat")), WorkflowTransitionError);
  restarted.appendBatch(Array.from({ length: 1_022 }, (_, index) => event("job.providerCycleClosed", { jobId: "job-1", cycle: index + 3 }, `cycle-${index + 3}`)));
  assert.equal(restarted.loadJob("job-1").providerCycle, 1_024);
  assert.throws(() => restarted.append(event("job.providerCycleClosed", { jobId: "job-1", cycle: 1_025 }, "cycle-overflow")), WorkflowTransitionError);
  restarted.append(event("job.blocked", { jobId: "job-1", reason: "cycle-limit" }, "cycle-limit"));
  assert.equal(restarted.loadJob("job-1").blocker, "cycle-limit");
  restarted.close();
}));

test("a terminal job records the provider cycle that produced its terminal event", () => withStore((filePath) => {
  const store = createPersistentWorkflowStore({ filePath });
  store.append(present(baseEvents()[0]));
  store.append(event("job.cancelled", { jobId: "job-1" }, "terminal-cancel"));
  store.append(event("job.providerCycleClosed", { jobId: "job-1", cycle: 1 }, "terminal-cycle"));
  store.close();
  const restarted = createPersistentWorkflowStore({ filePath });
  assert.equal(restarted.loadJob("job-1").status, "cancelled");
  assert.equal(restarted.loadJob("job-1").providerCycle, 1);
  restarted.close();
}));

test("a blocked receipt still records the provider cycle that produced it", () => withStore((filePath) => {
  const store = createPersistentWorkflowStore({ filePath });
  store.appendBatch([
    ...baseEvents(),
    event("batch.claimed", { jobId: "job-1", batchId: "batch-1" }, "blocked-cycle-claim"),
    event("batch.executing", { jobId: "job-1", batchId: "batch-1" }, "blocked-cycle-execute"),
    event("batch.receipt", { jobId: "job-1", batchId: "batch-1", receipt: receipt({ verification: "applied_unverified" }) }, "blocked-cycle-receipt"),
    event("job.providerCycleClosed", { jobId: "job-1", cycle: 1 }, "blocked-cycle-close"),
  ]);
  assert.equal(store.loadJob("job-1").status, "blocked");
  assert.equal(store.loadJob("job-1").providerCycle, 1);
  store.close();
  const restarted = createPersistentWorkflowStore({ filePath });
  assert.equal(restarted.loadJob("job-1").providerCycle, 1);
  restarted.close();
}));

function creatorEvents(): WorkflowEvent[] {
  const creator: ActionPlanV2Operation = {
    type: "create_layer",
    target: { compositionId: "comp-1", layerId: "__new__:layer", snapshotFingerprint: "snap-1", selectionFingerprint: "sel-1" },
    layerType: "text",
    name: "Title",
    text: "Title",
  };
  const creatorReceipt = receipt({
    createdBindings: [{ placeholder: "__new__:layer", createdId: "layer-created-1", operationId: "batch-1:op:0", readbackField: "layerId", observedFingerprint: "snap-2" }],
    outcomes: [{ operationId: "batch-1:op:0", ordinal: 0, type: "create_layer", outcome: "confirmed", mutation: "applied", verification: "verified", mayHaveMutated: true, observedFingerprint: "snap-2" }],
  });
  return [
    ...baseEvents().slice(0, 3),
    event("operation.proposed", { jobId: "job-1", stageId: "stage-1", batchId: "batch-1", ordinal: 0, payload: creator }, "creator-operation"),
    ...authorityEvents("job-1", "batch-1"),
    event("batch.admitted", { jobId: "job-1", stageId: "stage-1", batchId: "batch-1", digest: digestFor("batch-1", { payloads: [creator] }), snapshotFingerprint: "snap-1", undoUnitId: "undo-batch-1", undoUnitCount: 1, dimensions: dimensionsFor("batch-1") }, "creator-admit"),
    event("batch.queued", { jobId: "job-1", batchId: "batch-1" }, "creator-queue"),
    event("batch.claimed", { jobId: "job-1", batchId: "batch-1" }, "creator-claim"),
    event("batch.executing", { jobId: "job-1", batchId: "batch-1" }, "creator-execute"),
    event("batch.receipt", { jobId: "job-1", batchId: "batch-1", receipt: creatorReceipt }, "creator-receipt"),
    event("batch.undoRequested", { jobId: "job-1", batchId: "batch-1", expectedFingerprint: "snap-2" }, "creator-undo"),
  ];
}

test("verified creator bindings and undo snapshot lineage cross the disk boundary", () => withStore((filePath) => {
  const store = createPersistentWorkflowStore({ filePath });
  store.appendBatch(creatorEvents());
  store.close();
  const restarted = createPersistentWorkflowStore({ filePath });
  const batch = present(restarted.getState().batches["batch-1"]);
  assert.ok(batch.execution.receipt);
  assert.ok(batch.execution.receipt.createdBindings);
  assert.equal(batch.execution.receipt.createdBindings[0]?.createdId, "layer-created-1");
  assert.deepEqual(batch.recovery.lineage, { targetBatchId: "batch-1", undoUnitId: "undo-batch-1", expectedFingerprint: "snap-2", restoredFingerprint: null });
  assert.equal(restarted.recovery().batches[0]?.disposition, "safe_to_resume");
  restarted.append(event("batch.undoClaimed", { jobId: "job-1", batchId: "batch-1" }, "creator-undo-claim"));
  restarted.close();
  assert.equal(recoveryDisposition(filePath), "blocked_uncertain");
  const undo = createPersistentWorkflowStore({ filePath });
  undo.append(event("batch.undoExecuting", { jobId: "job-1", batchId: "batch-1" }, "creator-undo-execute"));
  undo.append(event("batch.undoReceipt", { jobId: "job-1", batchId: "batch-1", receipt: { receiptId: "creator-undo-receipt", status: "executed", receivedAt: at, restoredFingerprint: "snap-1", verification: "restored" } }, "creator-undo-receipt-event"));
  undo.close();
  const restored = createPersistentWorkflowStore({ filePath });
  const restoredBatch = restored.getState().batches["batch-1"];
  assert.ok(restoredBatch);
  assert.ok(restoredBatch.recovery.lineage);
  assert.ok(restoredBatch.execution.receipt);
  assert.ok(restoredBatch.execution.receipt.createdBindings);
  assert.equal(restoredBatch.recovery.lineage.restoredFingerprint, "snap-1");
  assert.equal(restoredBatch.execution.receipt.createdBindings[0]?.createdId, "layer-created-1");
  restored.close();
}));

function dependentEvents(includeAdmission: boolean): WorkflowEvent[] {
  const payload: ActionPlanV2Operation = {
    type: "set_layer_name",
    target: { compositionId: "comp-1", layerId: "layer-1", snapshotFingerprint: "snap-2", selectionFingerprint: "sel-1" },
    name: "Dependent",
  };
  const proposal: WorkflowEvent[] = [
    event("batch.proposed", { jobId: "job-1", stageId: "stage-1", batchId: "batch-2", summary: "Use verified output", dependencies: ["batch-1"] }, "batch-2-propose"),
    event("operation.proposed", { jobId: "job-1", stageId: "stage-1", batchId: "batch-2", ordinal: 0, payload }, "batch-2-operation"),
    ...authorityEvents("job-1", "batch-2", "batch-2", "snap-2"),
  ];
  if (!includeAdmission) return proposal;
  return [...proposal,
    event("batch.admitted", { jobId: "job-1", stageId: "stage-1", batchId: "batch-2", digest: digestFor("batch-2", { payloads: [payload], snapshotFingerprint: "snap-2", dependencies: ["batch-1"] }), snapshotFingerprint: "snap-2", undoUnitId: "undo-batch-2", undoUnitCount: 1, dimensions: dimensionsFor("batch-2") }, "batch-2-admit"),
    event("batch.queued", { jobId: "job-1", batchId: "batch-2" }, "batch-2-queue"),
  ];
}

test("verified replay unlocks dependent admission and queueing", () => withStore((filePath) => {
  const store = createPersistentWorkflowStore({ filePath });
  store.appendBatch([
    ...baseEvents(),
    event("batch.claimed", { jobId: "job-1", batchId: "batch-1" }, "dependency-claim"),
    event("batch.executing", { jobId: "job-1", batchId: "batch-1" }, "dependency-execute"),
    event("batch.receipt", { jobId: "job-1", batchId: "batch-1", receipt: receipt() }, "dependency-receipt"),
  ]);
  store.close();
  const restarted = createPersistentWorkflowStore({ filePath });
  restarted.appendBatch(dependentEvents(true));
  assert.equal(restarted.getState().batches["batch-2"]?.lifecycle, "queued");
  restarted.close();
}));

test("failed and uncertain replay cannot unlock a dependent batch", () => {
  const unsafeReceipts = [
    receipt({ receiptId: "dependency-failed", execution: "failed_during_apply", mutation: "may_have_mutated", mayHaveMutated: true, verification: "failed" }),
    receipt({ receiptId: "dependency-unknown", execution: "unknown", mutation: "unknown", mayHaveMutated: true, verification: "unknown" }),
  ];
  for (const unsafeReceipt of unsafeReceipts) withStore((filePath) => {
    const store = createPersistentWorkflowStore({ filePath });
    store.appendBatch([
      ...baseEvents(),
      ...dependentEvents(false),
      event("batch.claimed", { jobId: "job-1", batchId: "batch-1" }, `${unsafeReceipt.receiptId}-claim`),
      event("batch.executing", { jobId: "job-1", batchId: "batch-1" }, `${unsafeReceipt.receiptId}-execute`),
      event("batch.receipt", { jobId: "job-1", batchId: "batch-1", receipt: unsafeReceipt }, `${unsafeReceipt.receiptId}-receipt`),
    ]);
    store.close();
    const restarted = createPersistentWorkflowStore({ filePath });
    const admission = present(dependentEvents(true).at(-2));
    assert.throws(() => restarted.append(admission), WorkflowTransitionError);
    assert.equal(restarted.getState().batches["batch-2"]?.lifecycle, "proposed");
    restarted.close();
  });
});

test("duplicate receipt identity remains idempotent and conflicting evidence fails after restart", () => withStore((filePath) => {
  const settledReceipt = receipt({ receiptId: "durable-receipt" });
  const receiptEvent = event("batch.receipt", { jobId: "job-1", batchId: "batch-1", receipt: settledReceipt }, "durable-receipt-event");
  const store = createPersistentWorkflowStore({ filePath });
  store.appendBatch([...baseEvents(), event("batch.claimed", { jobId: "job-1", batchId: "batch-1" }, "durable-claim"), event("batch.executing", { jobId: "job-1", batchId: "batch-1" }, "durable-execute"), receiptEvent]);
  store.close();
  const restarted = createPersistentWorkflowStore({ filePath });
  restarted.append(receiptEvent);
  restarted.append(event("batch.receipt", { jobId: "job-1", batchId: "batch-1", receipt: settledReceipt }, "duplicate-delivery"));
  assert.equal(restarted.getState().batches["batch-1"]?.execution.receiptHistory.length, 1);
  const conflicting = receipt({ receiptId: "durable-receipt", verificationBasis: "conflicting-readback" });
  assert.throws(() => restarted.append(event("batch.receipt", { jobId: "job-1", batchId: "batch-1", receipt: conflicting }, "conflicting-delivery")), WorkflowTransitionError);
  restarted.close();
}));
