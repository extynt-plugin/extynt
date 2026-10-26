/** A batch too big for one undo group comes back to the model as a fixable tool error and the turn goes on. */
import assert from "node:assert/strict";
import test from "node:test";
import { MockProvider, type AgentStepInput, type AgentStepResult } from "@extynt/llm";
import type { ActionPlan } from "@extynt/action-plan";
import { WorkflowCoordinator } from "../src/workflow-coordinator.js";
import { authorization, chatTurn, mutableSnapshot, sidecarFor, token } from "./sidecar-fixture.js";

const KEYFRAMES = Array.from({ length: 1_000 }, (_, index) => ({ time: index / 100, value: [index, index] }));
const heavy = (propertyPath: string, role: string) => ({ type: "animate_property", target: { compositionId: "comp-1", layerId: "layer-1", propertyPath }, role, keyframes: KEYFRAMES });
const HEAVY = [heavy("ADBE Transform Group/ADBE Position", "transform.position"), heavy("ADBE Transform Group/ADBE Anchor Point", "transform.anchorPoint"), heavy("ADBE Transform Group/ADBE Scale", "transform.scale")];

const RENAME = { type: "set_layer_name", target: { compositionId: "comp-1", layerId: "layer-1" }, name: "Outline" };

test("an oversized batch is refused while its queue is open, and the model's smaller batch seals in the same turn", async (t) => {
  const provider = new MockProvider({ script: (input: AgentStepInput): AgentStepResult => {
    const called = input.messages.filter((message) => message.role === "tool").map((message) => message.name);
    const adds = called.filter((name) => name === "ae_queue_add").length;
    if (adds === 0) return { text: "", toolCalls: [{ id: "add", name: "ae_queue_add", arguments: { summary: "Draw the outline", operations: HEAVY } }] };
    if (adds === 1) return { text: "", toolCalls: [{ id: "small", name: "ae_queue_add", arguments: { summary: "Name the layer", operations: [RENAME] } }] };
    if (!called.includes("ae_queue_finish")) return { text: "", toolCalls: [{ id: "finish", name: "ae_queue_finish", arguments: {} }] };
    return { text: "Queued the smaller batch.", toolCalls: [] };
  } });
  const sidecar = sidecarFor({ port: 0, token, chatProvider: provider, quietAgentLog: true });
  const address = await sidecar.start(); t.after(() => sidecar.stop());
  await fetch(`http://${address.host}:${address.port}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(mutableSnapshot("oversized-batch")) });
  const result = await chatTurn(address, "draw this outline on the selected layer");
  assert.deepEqual(result.tools.map((tool) => [tool.name, tool.ok, tool.code]), [["ae_queue_add", false, "OPERATION_TOO_HEAVY"], ["ae_queue_add", true, undefined], ["ae_queue_finish", true, undefined]]);
  assert.equal(result.outcome, "planned", JSON.stringify(result));
  assert.equal(result.plans.length, 1, "only the smaller batch was sealed");
});

const EASES = [0, 1, 2].map(() => ({ speed: 0, influence: 50 }));
const AUTHORITY = { hostProfileId: "profile-fixture", hostBasis: "complete fixture host profile", hostSupported: true, verificationBasis: "sealed action-plan verification report", exactVerification: true, targetResolved: true, policyApprovalId: "approval-ref:fixture" } as const;

test("admission answers a batch past the JSON node bound with a refusal, not an exception", () => {
  const at = new Date("2026-09-20T12:00:00.000Z");
  const coordinator = new WorkflowCoordinator({ now: () => at });
  const target = { compositionId: "comp-1", layerId: "layer-1", propertyPath: "ADBE Transform Group/ADBE Position", snapshotFingerprint: "snapshot-before", selectionFingerprint: "selection-1" };
  const keyframes = Array.from({ length: 300 }, (_, index) => ({ time: index / 100, value: [index, index], ease: { in: EASES, out: EASES } }));
  const plan: ActionPlan = { schemaVersion: "0.2", planId: "heavy", snapshotFingerprint: "snapshot-before", selectionFingerprint: "selection-1", freshness: { revision: "1", capturedAt: at.toISOString() }, summary: "Heavy easing", requiresApproval: true, operations: [{ type: "animate_property", target, role: "transform.position", keyframes }] };
  const result = coordinator.admitPlan(plan, { jobId: "job-1", undoGroups: 1, authority: AUTHORITY });
  assert.equal(result.ok, false);
  assert.equal(result.ok ? undefined : result.code, "LIMIT_EXCEEDED");
});
