/** The MCP plan surface: stateless discovery, the edit workflow, and the mailbox an agent approval is handed over through. */
import type { JsonObject } from "@extynt/decode";
import { SIDECAR_VERSION } from "../src/server-contracts.js";
import { fieldOf, listOf, maybeRecordOf, readJson, recordOf, textOf } from "./http-json.js";
import { withoutThumbnails } from "./host-without-thumbnails.js";
import { authorization, claimOver, claimResponse, mutableSnapshot, receiptResponse, sidecarFor, sidecarForPlugin, token, validSnapshot, withVerificationAck } from "./sidecar-fixture.js";
import { MCP_SERVER_VERSION, planOperationCount } from "@extynt/mcp-server";
import assert from "node:assert/strict";
import test from "node:test";
import { present } from "./present.js";

test("exposes stateless MCP discovery/calls and sanitized export", async (t) => {
  const sidecar = sidecarForPlugin({ port: 0, token });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  const tools = await fetch(`http://${address.host}:${address.port}/v1/mcp/tools`, { headers: authorization });
  assert.equal(tools.status, 200);
  assert.ok(listOf(await readJson(tools), "tools").some((tool) => fieldOf(tool, "name") === "ae_search_capabilities"));
  const noSnapshot = await fetch(`http://${address.host}:${address.port}/v1/mcp/tools/call`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify({ name: "ae_status" }) });
  assert.equal(noSnapshot.status, 200);
  const status = await readJson(noSnapshot);

  assert.equal(textOf(status, "data.version"), SIDECAR_VERSION);
  assert.equal(textOf(status, "data.mcpServerVersion"), MCP_SERVER_VERSION);
  assert.equal(fieldOf(status, "data.snapshot"), null);
  assert.equal(textOf(status, "data.pipeline.panel"), "offline");
  await fetch(`http://${address.host}:${address.port}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(validSnapshot) });
  const exportResponse = await fetch(`http://${address.host}:${address.port}/v1/diagnostics/export`, { headers: authorization });
  const exported = await readJson(exportResponse);
  assert.equal(exportResponse.status, 200);
  assert.equal(textOf(exported, "snapshot.requestId"), "probe-1");
  assert.equal(textOf(exported, "host.appVersion"), "26.2.1");
  assert.match(textOf(exported, "inventory.fingerprint"), /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(exported).includes(token), false);
});

test("routes the first-class edit workflow through authenticated stateless MCP calls", async (t) => {
  const sidecar = withoutThumbnails(sidecarFor({ port: 0, token, panelSessionId: "panel-flow", now: () => new Date("2026-09-11T12:00:00.000Z") }));
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  const call = async (name: string, args: JsonObject = {}) => {
    const response = await fetch(`http://${address.host}:${address.port}/v1/mcp/tools/call`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify({ name, arguments: withVerificationAck(name, args) }) });
    return { status: response.status, body: recordOf(await readJson(response), "") };
  };
  await fetch(`http://${address.host}:${address.port}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(mutableSnapshot("probe-workflow")) });
  const prepared = await call("ae_prepare_change");
  assert.equal(prepared.status, 200);
  const planId = String(fieldOf(prepared.body, "data.planId"));
  assert.match(planId, /^edit-/);
  assert.equal(fieldOf((await call("ae_present_plan", { planId })).body, "data.status"), "presented");
  const approved = await call("ae_approve_plan", { planId });
  assert.equal(approved.status, 200);
  const claimed = claimOver(sidecar).body;
  assert.equal(fieldOf(claimed, "item.command.operation"), "apply_plan");
  const receipt = await receiptResponse(sidecar, { planId, approvalId: fieldOf(approved.body, "data.approval.token"), status: "executed", postcondition: "passed", operation: "apply_plan" });
  assert.equal(receipt.status, 201);
  assert.equal(fieldOf((await call("ae_get_plan_status", { planId })).body, "data.status"), "verified");
  assert.equal((await call("ae_get_receipt", { planId })).body.ok, true);
});

test("every approval queues a bounded one-shot mailbox item the host claims", async (t) => {
  const sidecar = withoutThumbnails(sidecarFor({ port: 0, token, panelSessionId: "panel-mailbox", now: () => new Date("2026-09-11T12:00:00.000Z") }));
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  const call = async (name: string, args: JsonObject = {}, agent = false) => {
    const response = await fetch(`http://${address.host}:${address.port}/v1/mcp/tools/call`, { method: "POST", headers: { ...authorization, "content-type": "application/json", ...(agent ? { "X-AE-Client": "agent" } : {}) }, body: JSON.stringify({ name, arguments: agent ? { waitSeconds: 0, ...withVerificationAck(name, args) } : withVerificationAck(name, args) }) });
    return { status: response.status, body: recordOf(await readJson(response), "") };
  };
  await fetch(`http://${address.host}:${address.port}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(mutableSnapshot("probe-mailbox")) });

  const agentPrepared = await call("ae_prepare_change");
  const agentPlanId = String(fieldOf(agentPrepared.body, "data.planId"));
  const agentApproved = await call("ae_approve_plan", { planId: agentPlanId }, true);
  assert.equal(agentApproved.status, 200);
  assert.equal(fieldOf(agentApproved.body, "data.mailbox.queued"), true);
  assert.equal("command" in (maybeRecordOf(agentApproved.body, "data") ?? {}), false);
  const firstClaim = claimResponse(sidecar);
  assert.equal(firstClaim.status, 200);
  const firstItem = fieldOf(await readJson(firstClaim), "item");
  assert.equal(fieldOf(firstItem, "planId"), agentPlanId);
  assert.equal(fieldOf(firstItem, "command.operation"), "apply_plan");
  assert.equal(fieldOf(claimOver(sidecar).body, "item"), null, "an item is claimed once");
  assert.equal((await receiptResponse(sidecar, { planId: agentPlanId, approvalId: fieldOf(firstItem, "approval.token"), operation: "apply_plan", status: "executed", postcondition: "passed", appliedOperations: ["ensure_effect"], mayHaveMutated: true, mutationState: "applied" })).status, 201);

  const panelPrepared = await call("ae_prepare_change");
  const panelPlanId = String(fieldOf(panelPrepared.body, "data.planId"));
  const panelApproved = await call("ae_approve_plan", { planId: panelPlanId });
  assert.equal(panelApproved.status, 200);
  assert.equal(fieldOf(claimOver(sidecar).body, "item.planId"), panelPlanId, "a panel approval is queued for the host the same way");

  for (let index = 0; index < 32; index += 1) {
    const prepared = await call("ae_prepare_change");
    const approved = await call("ae_approve_plan", { planId: String(fieldOf(prepared.body, "data.planId")) }, true);
    assert.equal(approved.status, 200);
  }
  const overflowPrepared = await call("ae_prepare_change");
  const overflow = await call("ae_approve_plan", { planId: String(fieldOf(overflowPrepared.body, "data.planId")) }, true);
  assert.equal(overflow.status, 429);
});

test("an external client cannot call the in-panel turn's queue", async (t) => {
  const sidecar = sidecarFor({ port: 0, token, quietAgentLog: true });
  const address = await sidecar.start(); t.after(() => sidecar.stop());
  const base = `http://${address.host}:${address.port}`;
  await fetch(`${base}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(mutableSnapshot("probe-queue-slots")) });
  const rename = (name: string) => ({ type: "set_layer_name", target: { compositionId: "comp-1", layerId: "layer-1" }, name });
  const external = async (name: string, args: JsonObject) => readJson(await fetch(`${base}/v1/mcp/tools/call`, { method: "POST", headers: { ...authorization, "content-type": "application/json", "X-AE-Client": "agent" }, body: JSON.stringify({ name, arguments: args }) }));

  const panelTurn = { requestId: "panel-queue", message: "rename it", history: [], autoApply: false };
  assert.equal((await sidecar.runAgentTool("ae_queue_add", { summary: "Panel rename", operations: [rename("Panel")] }, panelTurn, {})).ok, true);
  const panelQueue = sidecar.openQueuePlanId;
  assert.ok(panelQueue, "the in-panel turn has an open queue");

  assert.equal(fieldOf(await external("ae_queue_add", { summary: "External rename", operations: [rename("External")] }), "error.code"), "PANEL_AGENT_ONLY");
  const withoutClientHeader = await fetch(`${base}/v1/mcp/tools/call`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify({ name: "ae_queue_add", arguments: { summary: "External rename", operations: [rename("External")] } }) });
  assert.equal(fieldOf(await readJson(withoutClientHeader), "error.code"), "PANEL_AGENT_ONLY");
  assert.equal(sidecar.externalQueuePlanId, null);
  assert.equal(sidecar.openQueuePlanId, panelQueue, "and the in-panel turn's handle was not moved");
  assert.equal(planOperationCount(present(sidecar.plans.get(panelQueue))), 1, "nothing the external client sent landed in the in-panel plan");

  assert.equal(fieldOf(await external("ae_queue_finish", {}), "error.code"), "PANEL_AGENT_ONLY");
  assert.equal(sidecar.openQueuePlanId, panelQueue, "an external seal cannot close the in-panel turn's queue");
  assert.equal(sidecar.externalQueuePlanId, null);
});
