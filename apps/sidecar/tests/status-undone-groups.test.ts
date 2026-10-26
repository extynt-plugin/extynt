/** ae_status reports the undo groups a finished undo took back, also for a plan that has a single group. */
import { fieldOf, readJson, textOf } from "./http-json.js";
import { claimWork } from "./host-apply.js";
import { mutableSnapshot, queueHarness } from "./sidecar-fixture.js";
import assert from "node:assert/strict";
import test from "node:test";

test("latestWork counts the one undo group of a fully undone plan", async (t) => {
  const harness = await queueHarness(t);
  const { post, agent } = harness;
  const before = await readJson(await post("/v1/snapshots", mutableSnapshot("undone-1")));
  const planId = String((await agent("ae_prepare_change")).body.data.planId);
  const approving = agent("ae_approve_plan", { planId, waitSeconds: 5 });
  await claimWork(harness);
  await post("/v1/snapshots", mutableSnapshot("undone-2", ["layer-1"], "Applied"));
  await post("/v1/receipts", { planId, operation: "apply_plan", status: "executed", postcondition: "passed", appliedOperations: ["ensure_effect"], mayHaveMutated: true, mutationState: "applied", beforeFingerprint: textOf(before, "fingerprint") });
  await approving;
  const applied = await agent("ae_status");
  assert.equal(fieldOf(applied.body.data, "latestWork.undoneGroups"), 0, "nothing is undone yet");

  const undoing = agent("ae_undo_plan", { planId, waitSeconds: 5 });
  await claimWork(harness, "undo_plan");
  const restored = await readJson(await post("/v1/snapshots", mutableSnapshot("undone-3")));
  assert.equal(textOf(restored, "fingerprint"), textOf(before, "fingerprint"));
  await post("/v1/receipts", { planId, operation: "undo_plan", status: "executed", executed: true, method: "edit-undo" });
  assert.equal((await undoing).body.data.status, "undone");

  const status = await agent("ae_status");
  assert.equal(fieldOf(status.body.data, "latestWork.status"), "undone");
  assert.equal(fieldOf(status.body.data, "latestWork.undoneGroups"), 1);
});
