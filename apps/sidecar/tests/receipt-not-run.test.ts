/** A receipt that says nothing ran is final for its batch, even though the panel's own pre-apply check cannot carry the approval id. */
import { fieldOf, maybeTextOf, readJson, recordOf, textOf, type JsonObject } from "./http-json.js";
import { authorization, chatTurn, claimResponse, mutableSnapshot, pause, receiptResponse, sidecarFor, token, withVerificationAck, workflowStageStep } from "./sidecar-fixture.js";
import { MockProvider } from "@extynt/llm";
import type { ReadOnlySidecar } from "../src/server.js";
import assert from "node:assert/strict";
import test from "node:test";

const json = { ...authorization, "content-type": "application/json" };

const sealOnce = (waitSeconds: number) => new MockProvider({ script: (input) => {
  const called = input.messages.filter((message) => message.role === "tool").map((message) => message.name);
  if (input.messages.some((message) => message.role === "user" && message.content.includes("Continue this workflow"))) return { text: "Nothing ran.", toolCalls: [] };
  if (!called.includes("ae_select_workflow_stage")) return workflowStageStep("seal");
  if (!called.includes("ae_queue_add")) return { text: "", toolCalls: [{ id: "a1", name: "ae_queue_add", arguments: { summary: "Rename", operations: [{ type: "set_layer_name", target: { compositionId: "comp-1", layerId: "layer-1" }, name: "Hero" }] } }] };
  if (!called.includes("ae_queue_finish")) return { text: "", toolCalls: [{ id: "a2", name: "ae_queue_finish", arguments: { waitSeconds } }] };
  return { text: "Done.", toolCalls: [] };
} });

async function panelRefusesBatch(sidecar: ReadOnlySidecar, base: string, receipt: (planId: string) => JsonObject): Promise<{ planId: string; status: number; body: JsonObject }> {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const ready = await readJson(await fetch(`${base}/v1/chat/plans/ready`, { headers: authorization }));
    const planId = maybeTextOf(ready, "plans.0.planId");
    if (planId) {
      const approved = await readJson(await fetch(`${base}/v1/mcp/tools/call`, { method: "POST", headers: json, body: JSON.stringify({ name: "ae_approve_plan", arguments: withVerificationAck("ae_approve_plan", { planId }) }) }));
      assert.equal(textOf(approved, "data.status"), "approved");
      assert.equal(textOf(await readJson(claimResponse(sidecar)), "item.planId"), planId);
      const response = await receiptResponse(sidecar, receipt(planId));
      return { planId, status: response.status, body: recordOf(await response.json(), "") };
    }
    await pause(10);
  }
  throw new Error("the panel was never handed the batch");
}

const notRun = (planId: string) => ({ planId, operation: "apply_plan", status: "rejected", postcondition: "not_run", appliedOperations: [], mayHaveMutated: false, mutationState: "not-applied", hostError: { code: "SELECTION_CHANGED", message: "The selected layers changed after this plan was made, so nothing was run." } });

async function start(t: { after: (fn: () => void) => void }) {
  const sidecar = sidecarFor({ port: 0, token, chatProvider: sealOnce(6), quietAgentLog: true });
  const address = await sidecar.start(); t.after(() => sidecar.stop());
  const base = `http://${address.host}:${address.port}`;
  await fetch(`${base}/v1/snapshots`, { method: "POST", headers: json, body: JSON.stringify(mutableSnapshot("probe-not-run")) });
  return { sidecar, address, base };
}

const planStatus = async (base: string, planId: string): Promise<string> => textOf(await readJson(await fetch(`${base}/v1/mcp/tools/call`, { method: "POST", headers: json, body: JSON.stringify({ name: "ae_get_plan_status", arguments: { planId } }) })), "data.status");

test("a not-run receipt without the approval id is accepted: the plan fails and the seal stops waiting", async (t) => {
  const h = await start(t);
  const refusing = panelRefusesBatch(h.sidecar, h.base, notRun);
  const startedAt = Date.now();
  const reply = await chatTurn(h.address, "rename this to Hero", [], { autoApply: true });
  const { planId, status, body } = await refusing;
  assert.equal(status, 201, JSON.stringify(body));
  assert.equal(await planStatus(h.base, planId), "failed", "the receipt is the final word on the batch");
  assert.equal(reply.ok, true);
  const statusBody = await readJson(await fetch(`${h.base}/v1/mcp/tools/call`, { method: "POST", headers: json, body: JSON.stringify({ name: "ae_get_plan_status", arguments: { planId } }) }));
  assert.equal(fieldOf(statusBody, "data.awaitingHostApply"), false); assert.equal(textOf(statusBody, "data.postcondition"), "not_run");
  assert.ok(Date.now() - startedAt < 5_500, "the seal did not wait out its allowance for a batch that was refused");
  const listed = recordOf(await readJson(await fetch(`${h.base}/v1/mcp/tools/call`, { method: "POST", headers: json, body: JSON.stringify({ name: "ae_list_plans", arguments: {} }) })), "");
  assert.doesNotMatch(JSON.stringify(listed), /"status":"approved"/, "no plan is left approved");
});

test("an executed receipt still needs the approval id, and so does a not-run receipt that carries a wrong one", async (t) => {
  const h = await start(t);
  const executed = (planId: string) => ({ planId, operation: "apply_plan", status: "executed", postcondition: "applied_unverified", appliedOperations: ["set_layer_name"], mayHaveMutated: true, mutationState: "applied", undoGroups: 1 });
  const first = panelRefusesBatch(h.sidecar, h.base, executed);
  await chatTurn(h.address, "rename this to Hero", [], { autoApply: true });
  const forged = await first;
  assert.equal(forged.status, 409);
  assert.equal(textOf(forged.body, "error.code"), "APPROVAL_MISMATCH");
  assert.equal(await planStatus(h.base, forged.planId), "approved", "a receipt that claims work without the capability changes nothing");
  const wrong = await receiptResponse(h.sidecar, { ...notRun(forged.planId), approvalId: "not-the-token" });
  assert.equal(wrong.status, 409, "a supplied approval id must still match");
});
