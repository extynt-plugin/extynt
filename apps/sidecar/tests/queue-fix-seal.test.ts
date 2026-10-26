/** ae_queue_fix must not present the open batch to the user: only the seal does, through queueReadyPlan and the auto-apply decision. */
import assert from "node:assert/strict";
import test from "node:test";
import { mutableSnapshot, sidecarFor, token } from "./sidecar-fixture.js";
import { MockProvider } from "@extynt/llm";
import { WORKFLOW_OWNER } from "../src/workflow-orchestration.js";
import { present } from "./present.js";

const rename = (name: string, layerId = "layer-1") => ({ type: "set_layer_name", target: { compositionId: "comp-1", layerId }, name });

function ownerJob(id: string) {
  const sidecar = sidecarFor({ token, chatProvider: new MockProvider({ answer: "ok" }), quietAgentLog: true });
  sidecar.latest = { snapshot: mutableSnapshot(id), receivedAt: "2026-09-24T15:00:00.000Z", bytes: 1 };
  const input = { requestId: id, message: "Rename", history: [], autoApply: true, workflowJobId: id, workflowGoalSummary: "Rename", workflowRole: WORKFLOW_OWNER };
  return { sidecar, input };
}

test("queue_add then queue_fix leaves a draft; the seal is queued and decided for auto-apply", async () => {
  const { sidecar, input } = ownerJob("fix-seal");
  assert.equal((await sidecar.runAgentTool("ae_queue_add", { summary: "Rename", operations: [rename("Hero")] }, input, {})).ok, true);
  const planId = present(sidecar.openQueuePlanId);
  const fixed = await sidecar.runAgentTool("ae_queue_fix", { edits: [{ op: "replace", index: 0, operation: rename("Villain") }] }, input, {});
  assert.equal(fixed.ok, true, JSON.stringify(fixed));
  const record = present(sidecar.plans.get(planId));
  assert.equal(record.status, "draft", "a batch being filled is never offered for Apply");
  assert.equal(record.approvalCapability, undefined);
  assert.equal(sidecar.readyPlans.length, 0, "nothing is queued before the seal");
  const sealed = await sidecar.runAgentTool("ae_queue_finish", {}, input, {});
  assert.equal(sealed.ok, true, JSON.stringify(sealed));
  const entry = sidecar.readyPlans.find((candidate) => candidate.planId === planId);
  assert.ok(entry, "the seal went through queueReadyPlan");
  assert.equal(entry.autoApply, true, "the job's own work auto-applies");
  assert.equal(sidecar.openQueuePlanId, null);
});

test("a batch the user already applied is a closed batch, not a repeatable PLAN_NOT_EDITABLE", async () => {
  const { sidecar, input } = ownerJob("fix-closed");
  await sidecar.runAgentTool("ae_queue_add", { summary: "Rename", operations: [rename("Hero")] }, input, {});
  const planId = present(sidecar.openQueuePlanId);
  present(sidecar.plans.get(planId)).status = "applied";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const finished = await sidecar.runAgentTool("ae_queue_finish", {}, input, {});
    assert.equal(finished.ok, true, JSON.stringify(finished));
    if (attempt === 0) assert.match(JSON.stringify(finished), new RegExp(`plan ${planId}`));
  }
  assert.equal(sidecar.openQueuePlanId, null);
  const added = await sidecar.runAgentTool("ae_queue_add", { summary: "Again", operations: [rename("Next")] }, input, {});
  assert.equal(added.ok, true, JSON.stringify(added));
  assert.ok(sidecar.openQueuePlanId && sidecar.openQueuePlanId !== planId, "a fresh batch");
});
