/** A queue call that leaves nothing to fix seals itself: finish on ae_queue_add, the default on ae_queue_design. */
import type { JsonObject } from "@extynt/decode";
import assert from "node:assert/strict";
import test from "node:test";
import { fieldOf, maybeListOf, recordOf } from "./http-json.js";
import { mutableSnapshot, seedDesign, sidecarFor, token } from "./sidecar-fixture.js";
import { MockProvider } from "@extynt/llm";
import { WORKFLOW_OWNER } from "../src/workflow-orchestration.js";

const rename = (name: string, layerId = "layer-1") => ({ type: "set_layer_name", target: { compositionId: "comp-1", layerId }, name });
const turn = { requestId: "self-seal", message: "rename it", history: [], autoApply: false };

function panelSidecar(id: string) {
  const sidecar = sidecarFor({ token, quietAgentLog: true });
  sidecar.latest = { snapshot: mutableSnapshot(id), receivedAt: "2026-09-24T15:00:00.000Z", bytes: 1 };
  return sidecar;
}

const dataOf = <T>(result: T): JsonObject => recordOf(result, "data");

test("ae_queue_add with finish:true seals a clean batch and returns the receipt in the same answer", async () => {
  const sidecar = panelSidecar("self-seal-add");
  const result = await sidecar.runAgentTool("ae_queue_add", { summary: "Rename", operations: [rename("Hero")], finish: true }, turn, {});
  assert.equal(result.ok, true);
  assert.ok(dataOf(result).sealed, "the answer carries the seal's own answer");
  assert.equal(sidecar.openQueuePlanId, null, "the queue is closed");
  assert.equal(maybeListOf(result, "embeddedSeals")?.length, 1, "the loop is told a seal ran");
});

test("ae_queue_add without finish leaves the batch open", async () => {
  const sidecar = panelSidecar("self-seal-open");
  const result = await sidecar.runAgentTool("ae_queue_add", { summary: "Rename", operations: [rename("Hero")] }, turn, {});
  assert.equal(result.ok, true);
  assert.equal(dataOf(result).sealed, undefined);
  assert.ok(sidecar.openQueuePlanId, "still open");
});

test("ae_queue_add with finish:true does not seal an answer that names operations to fix", async () => {
  const sidecar = panelSidecar("self-seal-refused");
  const result = await sidecar.runAgentTool("ae_queue_add", { summary: "Rename", operations: [rename("Hero"), rename("Ghost", "layer-missing")], finish: true }, turn, {});
  const text = JSON.stringify(result);
  assert.doesNotMatch(text, /"sealed"/, text);
  assert.equal(fieldOf(result, "embeddedSeals"), undefined);
  assert.equal(sidecar.openQueuePlanId === null && result.ok, false, "the queue was not closed over the missing position");
});

function designJob(id: string) {
  const sidecar = sidecarFor({ token, chatProvider: new MockProvider({ answer: "ok" }), quietAgentLog: true });
  sidecar.latest = { snapshot: mutableSnapshot(id), receivedAt: "2026-09-24T15:00:00.000Z", bytes: 1 };
  const input = { requestId: id, message: "A planet", history: [], autoApply: false, workflowJobId: id, workflowGoalSummary: "A planet", workflowRole: WORKFLOW_OWNER };
  return { sidecar, input };
}

test("ae_queue_design seals by default, and finish:false keeps the batch open", async () => {
  for (const finish of [undefined, false]) {
    const { sidecar, input } = designJob(`self-seal-design-${String(finish)}`);
    seedDesign(sidecar, `self-seal-design-${String(finish)}`);
    const built = await sidecar.runAgentTool("ae_queue_design", finish === undefined ? {} : { finish }, input, {});
    assert.equal(built.ok, true, JSON.stringify(built));
    if (finish === undefined) { assert.ok(dataOf(built).sealed, JSON.stringify(built)); assert.equal(sidecar.openQueuePlanId, null); }
    else { assert.equal(dataOf(built).sealed, undefined); assert.ok(sidecar.openQueuePlanId); }
  }
});
