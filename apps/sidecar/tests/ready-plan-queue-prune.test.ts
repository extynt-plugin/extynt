/** The ready-plan queue limit guards pending plans only; finished ones are dropped at queue time. */
import assert from "node:assert/strict";
import test from "node:test";
import { nativeRig, type NativeRig } from "./native-rig.js";
import { storedPlanFixture } from "./sidecar-fixture.js";

function fill(rig: NativeRig, count: number, finish: "receipt" | "terminal" | "pending"): void {
  for (let n = 0; n < count; n += 1) {
    const planId = `fake-${finish}-${n}`;
    const record = storedPlanFixture(planId, finish === "terminal" ? "applied" : "prepared", finish === "receipt" ? { receipt: { status: "applied" } } : {});
    rig.sidecar.plans.set(planId, record);
    rig.sidecar.readyPlans.push({ planId, batch: n + 1, jobId: null, jobBatch: null, operations: 1, undoGroups: 0, completedAt: new Date().toISOString(), deliveredAt: null, requestId: "turn-1", autoApply: false });
  }
}

for (const finish of ["receipt", "terminal"] as const) {
  test(`a full queue of ${finish} plans does not refuse the next plan`, async (t) => {
    const rig = await nativeRig(t);
    const planId = await rig.proposeRename();
    fill(rig, rig.sidecar.readyPlanQueueLimit, finish);
    const queued = rig.sidecar.queueReadyPlan({ planId, operationCount: 1 }, { requestId: "turn-1", autoApply: false });
    assert.equal(queued.queued, true, JSON.stringify(queued));
    assert.deepEqual(rig.sidecar.readyPlans.map((entry) => entry.planId), [planId]);
  });
}

test("a full queue of genuinely pending plans still refuses the next plan", async (t) => {
  const rig = await nativeRig(t);
  const planId = await rig.proposeRename();
  fill(rig, rig.sidecar.readyPlanQueueLimit, "pending");
  const queued = rig.sidecar.queueReadyPlan({ planId, operationCount: 1 }, { requestId: "turn-1", autoApply: false });
  assert.equal(queued.queued, false);
  assert.equal(rig.sidecar.readyPlans.length, rig.sidecar.readyPlanQueueLimit);
});
