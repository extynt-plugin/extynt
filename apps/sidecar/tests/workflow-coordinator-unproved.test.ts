// Test that an applied batch whose read-back could not prove is reported as waiting for its observation.

import assert from "node:assert/strict";
import test from "node:test";
import { WorkflowCoordinator } from "../src/workflow-coordinator.js";
import { at, plan as renamePlan, ready } from "./workflow-coordinator-fixture.js";

test("a stage whose applied batch read-back could not prove is waiting for its observation, not failed: the coordinator names that batch", () => {
  const coordinator = new WorkflowCoordinator({ now: () => at });
  ready(coordinator, renamePlan("plan-1"));
  const jobId = String(coordinator.projection().jobs[0]?.jobId);
  assert.equal(coordinator.unprovedAppliedBatch(jobId), undefined, "nothing is unproved before the receipt");
  coordinator.receipt("plan-1", { planId: "plan-1", status: "executed", postcondition: "applied_unverified", mayHaveMutated: true, mutationState: "applied", afterFingerprint: "snapshot-after" });
  assert.equal(coordinator.unprovedAppliedBatch(jobId)?.verification.state, "applied_unverified");
});
