/** Undo: a mismatch is final, a long plan reports what is left, and a file or render outside the document is named. */
import { fieldOf, flagOf, listOf, numberOf, readJson, textOf, type JsonObject } from "./http-json.js";
import { claimWork } from "./host-apply.js";
import { mutableSnapshot, queueHarness } from "./sidecar-fixture.js";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("undo: a mismatch is final and explained, never auto-redone; the envelope fingerprint is fresh after waits", async (t) => {
  const harness = await queueHarness(t);
  const { post, agent } = harness;
  const before = await readJson((await post("/v1/snapshots", mutableSnapshot("undo-1"))));
  const planId = String((await agent("ae_prepare_change")).body.data.planId);
  const approving = agent("ae_approve_plan", { planId, waitSeconds: 5 });
  await claimWork(harness);
  const after = await readJson((await post("/v1/snapshots", mutableSnapshot("undo-2", ["layer-1"], "Applied"))));
  assert.match(textOf(after, "fingerprint"), /^fp3-[0-9a-f]{32}$/, "snapshot uploads return the canonical fingerprint for the panel's undo guard");
  await post("/v1/receipts", { planId, operation: "apply_plan", status: "executed", postcondition: "passed", appliedOperations: ["ensure_effect"], mayHaveMutated: true, mutationState: "applied", created: { "__new__:layer0": 42, "not-a-placeholder": "x" } });
  const approved = await approving;
  assert.equal(approved.body.data.status, "verified");
  assert.equal(approved.body.snapshotFingerprint, textOf(after, "fingerprint"));
  assert.deepEqual(fieldOf(approved.body.data, "receipt.created"), { "__new__:layer0": "42" });

  const undoing = agent("ae_undo_plan", { planId, waitSeconds: 5 });
  const undoItem = await claimWork(harness, "undo_plan");
  assert.equal(undoItem?.expectedFingerprint, textOf(after, "fingerprint"));
  assert.equal(undoItem?.restoreFingerprint, textOf(before, "fingerprint"), "undo item carries the pre-apply fingerprint to verify restore");

  await post("/v1/snapshots", mutableSnapshot("undo-3", ["layer-1"], "Something else"));
  await post("/v1/receipts", { planId, operation: "undo_plan", status: "executed", executed: true, method: "edit-undo" });
  const undone = await undoing;
  assert.equal(undone.body.data.status, "undo_unverified");
  assert.equal(fieldOf(undone.body.data, "receipt.undo.restoredPreApplyFingerprint"), false);
  assert.ok(listOf(undone.body.data, "receipt.undo.differences").includes("layer comp-1/layer-1 name"));
  assert.doesNotMatch(JSON.stringify(undone.body.data.receipt), /Shift\+Cmd\+Z/);
});

test("an undo timeout settles the request as unknown instead of leaving it queued", async (t) => {
  const harness = await queueHarness(t);
  const { post, agent } = harness;
  await post("/v1/snapshots", mutableSnapshot("unknown-undo-before"));
  const planId = String((await agent("ae_prepare_change")).body.data.planId);
  const approving = agent("ae_approve_plan", { planId, waitSeconds: 5 });
  const applyItem = await claimWork(harness);
  assert.ok(applyItem);
  await post("/v1/snapshots", mutableSnapshot("unknown-undo-after", ["layer-1"], "Applied"));
  await post("/v1/receipts", { planId, operation: "apply_plan", status: "executed", postcondition: "passed", appliedOperations: ["ensure_effect"], mayHaveMutated: true, mutationState: "applied" });
  await approving;

  const undoing = agent("ae_undo_plan", { planId, waitSeconds: 5 });
  const undoItem = await claimWork(harness, "undo_plan");
  assert.ok(undoItem);
  const accepted = await post("/v1/receipts", { planId, operation: "undo_plan", status: "unknown", executed: false, hostError: { code: "HOST_HOP_TIMED_OUT", message: "The host stopped answering." } });
  assert.equal(accepted.status, 201);
  const settled = await undoing;
  assert.equal(settled.body.data.status, "undo_unverified");
  assert.equal(fieldOf(settled.body.data, "receipt.status"), "unknown");
  assert.match(textOf(settled.body.data, "receipt.undo.action"), /may have run/);
});

test("a long plan undone one group at a time reports what is left instead of claiming it is undone", async (t) => {
  const harness = await queueHarness(t);
  const { post, agent } = harness;
  await post("/v1/snapshots", mutableSnapshot("batch-1"));
  const planId = String((await agent("ae_prepare_change")).body.data.planId);
  const approving = agent("ae_approve_plan", { planId, waitSeconds: 5 });
  await claimWork(harness);
  await post("/v1/snapshots", mutableSnapshot("batch-2", ["layer-1"], "Applied"));

  await post("/v1/receipts", { planId, operation: "apply_plan", status: "executed", postcondition: "passed", appliedOperations: ["ensure_effect"], mayHaveMutated: true, mutationState: "applied", undoGroups: 3, batchSize: 25 });
  const approved = await approving;
  assert.equal(approved.body.data.status, "verified");

  const undoing = agent("ae_undo_plan", { planId, scope: "last", waitSeconds: 5 });
  const undoItem = await claimWork(harness, "undo_plan");
  assert.equal(undoItem?.times, 1, "the card asked for the last step, so one undo is queued");
  assert.equal(undoItem?.scope, "last");
  assert.match(String(undoItem?.undoGroup), /\(3\/3\)$/, "the group named is the newest one");
  await post("/v1/snapshots", mutableSnapshot("batch-3", ["layer-1"], "After one undo"));
  await post("/v1/receipts", { planId, operation: "undo_plan", status: "executed", executed: true, method: "edit-undo", times: 1 });
  const partial = await undoing;
  assert.equal(partial.body.data.status, "partially_undone", "two groups are still applied, so this is not undone");
  assert.equal(numberOf(partial.body.data, "receipt.undo.remaining"), 2);
  assert.equal(numberOf(partial.body.data, "receipt.undo.undone"), 1);
  assert.equal(flagOf(partial.body.data, "receipt.undo.restoredPreApplyFingerprint"), false);
  assert.match(String(fieldOf(partial.body.data, "receipt.undo.action")), /2 of 3 left/);
  assert.equal(numberOf(partial.body.data, "receipt.times"), 1);
});

test("undoing a plan that wrote a file says the file is still there", async (t) => {
  const harness = await queueHarness(t);
  const { post, agent } = harness;
  const before = await readJson((await post("/v1/snapshots", mutableSnapshot("render-undo-1"))));
  const outputPath = join(homedir(), "extynt-undo-left-behind.mov");
  const proposed = await agent("ae_propose_plan", { summary: "Render it", operations: [{ type: "render_composition", compositionId: "comp-1", outputPath, destinationPolicy: "explicit-local-path", executeAuthorization: "RENDER_NOW" }] });
  assert.equal(proposed.body.ok, true, JSON.stringify(proposed.body).slice(0, 300));
  const planId = String(proposed.body.data.planId);

  assert.equal(listOf(proposed.body.data, "presentation.notices").some((notice) => fieldOf(notice, "code") === "NOT_UNDOABLE"), true, "a render says nothing takes it back");

  const approving = agent("ae_approve_plan", { planId, waitSeconds: 5 });
  await claimWork(harness);
  await post("/v1/receipts", { planId, operation: "apply_plan", status: "executed", postcondition: "passed", appliedOperations: ["render_composition"], mayHaveMutated: true, mutationState: "applied", beforeFingerprint: textOf(before, "fingerprint"), afterFingerprint: textOf(before, "fingerprint") });
  assert.equal((await approving).body.data.status, "verified");

  const undoing = agent("ae_undo_plan", { planId, waitSeconds: 5 });
  await claimWork(harness, "undo_plan");
  await post("/v1/receipts", { planId, operation: "undo_plan", status: "executed", executed: true, method: "edit-undo", times: 1 });
  const undone = await undoing;

  assert.equal(undone.body.data.status, "undone");
  assert.equal(flagOf(undone.body.data, "receipt.undo.restoredPreApplyFingerprint"), true);
  assert.deepEqual(fieldOf(undone.body.data, "receipt.undo.leftBehind"), ["render_composition"]);
  assert.match(String(fieldOf(undone.body.data, "receipt.undo.leftBehindNote")), /does not remove a file or stop a render/);
});

test("undoing a plan that only queued a render does not say it left something outside", async (t) => {
  const harness = await queueHarness(t);
  const { post, agent } = harness;
  const before = await readJson((await post("/v1/snapshots", mutableSnapshot("render-queue-undo-1"))));
  const outputPath = join(homedir(), "extynt-undo-queue-only.mov");

  const proposed = await agent("ae_propose_plan", { summary: "Queue it", operations: [{ type: "render_composition", compositionId: "comp-1", outputPath, destinationPolicy: "explicit-local-path" }] });
  assert.equal(proposed.body.ok, true, JSON.stringify(proposed.body).slice(0, 300));
  const planId = String(proposed.body.data.planId);
  assert.equal(listOf(proposed.body.data, "presentation.notices").some((notice) => fieldOf(notice, "code") === "NOT_UNDOABLE"), false, "queueing is not the case that writes a file");

  const approving = agent("ae_approve_plan", { planId, waitSeconds: 5 });
  await claimWork(harness);
  await post("/v1/receipts", { planId, operation: "apply_plan", status: "executed", postcondition: "passed", appliedOperations: ["render_composition"], mayHaveMutated: true, mutationState: "applied", beforeFingerprint: textOf(before, "fingerprint"), afterFingerprint: textOf(before, "fingerprint") });
  assert.equal((await approving).body.data.status, "verified");

  const undoing = agent("ae_undo_plan", { planId, waitSeconds: 5 });
  await claimWork(harness, "undo_plan");
  await post("/v1/receipts", { planId, operation: "undo_plan", status: "executed", executed: true, method: "edit-undo", times: 1 });
  const undone = await undoing;

  assert.equal(undone.body.data.status, "undone");
  assert.equal(flagOf(undone.body.data, "receipt.undo.restoredPreApplyFingerprint"), true);
  assert.equal(fieldOf(undone.body.data, "receipt.undo.leftBehind"), undefined);
  assert.equal(fieldOf(undone.body.data, "receipt.undo.leftBehindNote"), undefined);
  assert.doesNotMatch(JSON.stringify(undone.body.data.receipt), /wrote something outside/);
});

async function failedApply(t: Parameters<typeof queueHarness>[0], receipt: JsonObject) {
  const harness = await queueHarness(t);
  await harness.post("/v1/snapshots", mutableSnapshot("failed-undo-1"));
  const planId = String((await harness.agent("ae_prepare_change")).body.data.planId);
  const approving = harness.agent("ae_approve_plan", { planId, waitSeconds: 5 });
  await claimWork(harness);
  await harness.post("/v1/receipts", { planId, operation: "apply_plan", status: "rejected", hostError: { code: "SCENE_EDIT_TIME_REMAPPED", message: "SCENE_EDIT_TIME_REMAPPED" }, ...receipt });
  await approving;
  const undone = await harness.agent("ae_undo_plan", { planId, waitSeconds: 1 });
  return { undone, next: (await harness.claim()).item };
}

test("undoing a failed plan that changed nothing never presses the host undo", async (t) => {
  const { undone, next } = await failedApply(t, { postcondition: "not_run", mayHaveMutated: false, mutationState: "not-applied", rollback: "none" });
  assert.equal(undone.body.ok, false);
  assert.equal(undone.body.error?.code, "UNDO_NOT_APPLICABLE");
  assert.match(String(undone.body.error?.message), /Nothing to undo: this plan changed nothing/);
  assert.equal(next, null, "no undo item reached the host, so Edit > Undo cannot take back an earlier plan");
});

test("undoing a failed plan whose mutation is unknown refuses and points to Edit > Undo", async (t) => {
  const { undone, next } = await failedApply(t, { postcondition: "partial_mutation_possible", mayHaveMutated: true, mutationState: "mutation-unknown", rollback: "After Effects Undo required" });
  assert.equal(undone.body.ok, false);
  assert.equal(undone.body.error?.code, "UNDO_MUTATION_UNKNOWN");
  assert.match(String(undone.body.error?.message), /Edit > Undo/);
  assert.equal(next, null);
});
