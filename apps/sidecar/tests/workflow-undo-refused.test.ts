/** A workflow refusal of an undo puts the plan back to its applied status and queues nothing for the panel. */
import assert from "node:assert/strict";
import test from "node:test";
import { type JsonValue } from "@extynt/decode";
import { fieldOf, maybeTextOf, readJson, recordOf } from "./http-json.js";
import { authorization, claimOver, mutableSnapshot, receiptResponse, sidecarFor, token, withVerificationAck } from "./sidecar-fixture.js";

test("a refused workflow undo restores the applied status and queues no undo_plan item", async (t) => {
  const sidecar = sidecarFor({ port: 0, token, panelSessionId: "panel-undo-refused", quietAgentLog: true });
  const address = await sidecar.start(); t.after(() => sidecar.stop());
  const base = `http://${address.host}:${address.port}`;
  const post = (path: string, body: JsonValue | ReturnType<typeof mutableSnapshot>) => fetch(`${base}${path}`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(body) });
  const agent = async (name: string, args: Readonly<Record<string, JsonValue>> = {}) => recordOf(await readJson((await fetch(`${base}/v1/mcp/tools/call`, { method: "POST", headers: { ...authorization, "content-type": "application/json", "X-AE-Client": "agent" }, body: JSON.stringify({ name, arguments: { waitSeconds: 0, ...withVerificationAck(name, args) } }) }))), "");
  const claim = () => fieldOf(claimOver(sidecar).body, "item");

  await post("/v1/snapshots", mutableSnapshot("start", ["layer-1"], "Start"));
  const created = await agent("ae_plan_create", { summary: "Rename the layer" });
  const planId = String(fieldOf(created, "data.planId"));
  await agent("ae_plan_add", { planId, operations: [{ type: "set_layer_name", target: { compositionId: "comp-1", layerId: "layer-1" }, name: "One" }] });
  const sealed = await agent("ae_plan_complete", { planId });
  const approved = await agent("ae_approve_plan", { planId });
  assert.equal(fieldOf(claim(), "planId"), planId);
  await post("/v1/snapshots", mutableSnapshot("applied", ["layer-1"], "One"));
  await receiptResponse(sidecar, { planId, approvalId: fieldOf(approved, "data.approval.token"), operation: "apply_plan", status: "executed", postcondition: "passed", appliedOperations: ["set_layer_name"], mayHaveMutated: true, mutationState: "applied", beforeFingerprint: String(fieldOf(sealed, "data.plan.snapshotFingerprint")), undoGroups: 1, afterFingerprint: "after-one" });
  const applied = maybeTextOf(await agent("ae_get_plan_status", { planId }), "data.status");
  assert.equal(applied, "verified");

  const coordinator = sidecar.workflowCoordinator;
  coordinator.hasPlan = (id: string) => id === planId;
  coordinator.markDivergence = () => undefined;
  coordinator.requestUndo = () => { throw new Error("workflow refuses this undo"); };
  await agent("ae_undo_plan", { planId });

  assert.equal(maybeTextOf(await agent("ae_get_plan_status", { planId }), "data.status"), applied, "a refused undo must not leave the plan at undo_requested");
  assert.equal(claim(), null, "a refused undo queues nothing for the panel");
});
