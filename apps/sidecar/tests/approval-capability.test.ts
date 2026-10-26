/** Approval capabilities: what a token binds to, when a plan is stale, and how an approval is claimed, compiled, and rebound. */
import type { JsonObject } from "@extynt/decode";
import { fieldOf, listOf, parseJson, readJson, recordOf, textOf } from "./http-json.js";
import { authorization, claimResponse, hostCensus, mutableSnapshot, receiptResponse, queueHarness, sidecarFor, token, withVerificationAck } from "./sidecar-fixture.js";
import { withoutThumbnails } from "./host-without-thumbnails.js";
import { MCP_SERVER_VERSION } from "@extynt/mcp-server";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("queued agent plans approved against a snapshot that an earlier apply changed are rejected at claim time", async (t) => {
  const sidecar = withoutThumbnails(sidecarFor({ port: 0, token, panelSessionId: "panel-stale-mailbox", now: () => new Date("2026-09-11T12:00:00.000Z") }));
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  const base = `http://${address.host}:${address.port}`;
  const call = async (name: string, args: JsonObject = {}) => {
    const response = await fetch(`${base}/v1/mcp/tools/call`, { method: "POST", headers: { ...authorization, "content-type": "application/json", "X-AE-Client": "agent" }, body: JSON.stringify({ name, arguments: { waitSeconds: 0, ...withVerificationAck(name, args) } }) });
    return recordOf(await readJson(response), "");
  };
  const postSnapshot = (requestId: string, name: string) => fetch(`${base}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(mutableSnapshot(requestId, ["layer-1"], name)) });
  await postSnapshot("probe-before", "Original");
  const first = String(fieldOf(await call("ae_prepare_change"), "data.planId"));
  const second = String(fieldOf(await call("ae_prepare_change"), "data.planId"));
  assert.equal((await call("ae_approve_plan", { planId: first })).ok, true);
  assert.equal((await call("ae_approve_plan", { planId: second })).ok, true);
  const claimed = await readJson(claimResponse(sidecar));
  assert.equal(fieldOf(claimed, "item.planId"), first);

  await postSnapshot("probe-after", "Changed by first plan");
  const stale = await readJson(claimResponse(sidecar));
  assert.equal(fieldOf(stale, "item"), null);
  const status = await call("ae_get_plan_status", { planId: second });
  assert.equal(fieldOf(status, "data.status"), "failed"); assert.equal(fieldOf(status, "data.receipt.error.code"), "STALE_SNAPSHOT"); assert.equal(fieldOf(status, "data.receipt.mayHaveMutated"), false);
});

test("approval capabilities never expose the sidecar bearer token as the panel session id", async (t) => {
  const sidecar = sidecarFor({ port: 0, token, now: () => new Date("2026-09-11T12:00:00.000Z") });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  const base = `http://${address.host}:${address.port}`;
  await fetch(`${base}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(mutableSnapshot("probe-token")) });
  const prepared = await (await fetch(`${base}/v1/mcp/tools/call`, { method: "POST", headers: { ...authorization, "content-type": "application/json", "X-AE-Client": "agent" }, body: JSON.stringify({ name: "ae_prepare_change", arguments: {} }) })).text();
  assert.equal(prepared.includes(token), false);
  const planId = textOf(parseJson(prepared), "data.planId");
  const approved = await (await fetch(`${base}/v1/mcp/tools/call`, { method: "POST", headers: { ...authorization, "content-type": "application/json", "X-AE-Client": "agent" }, body: JSON.stringify({ name: "ae_approve_plan", arguments: { planId, waitSeconds: 0, acknowledgeUnverified: true } }) })).text();
  assert.equal(approved.includes(token), false);
  assert.equal(approved.includes("\"plan\":{"), false, "agent approvals do not echo the full plan");
});

test("agent approve waits for the panel receipt, and undo is guarded, queued, and verified", async (t) => {
  const sidecar = withoutThumbnails(sidecarFor({ port: 0, token, panelSessionId: "panel-wait" }));
  const address = await sidecar.start(); t.after(() => sidecar.stop());
  const base = `http://${address.host}:${address.port}`;
  const post = <T>(path: string, body: T) => fetch(`${base}${path}`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(body) });
  const agent = async (name: string, args: JsonObject) => recordOf(await readJson((await fetch(`${base}/v1/mcp/tools/call`, { method: "POST", headers: { ...authorization, "content-type": "application/json", "X-AE-Client": "agent" }, body: JSON.stringify({ name, arguments: withVerificationAck(name, args) }) }))), "");
  const claim = async () => { for (let attempt = 0; attempt < 100; attempt += 1) { const item = fieldOf(await readJson(claimResponse(sidecar)), "item"); if (item) return item; await new Promise((resolve) => setTimeout(resolve, 20)); } throw new Error("no mailbox item"); };
  await post("/v1/snapshots", mutableSnapshot("wait-1"));
  const prepared = await agent("ae_prepare_change", {});
  const planId = String(fieldOf(prepared, "data.planId")), before = String(fieldOf(prepared, "data.plan.snapshotFingerprint"));

  const applying = (async () => { const item = await claim(); const approvalId = String(fieldOf(item, "approval.token")); await post("/v1/snapshots", mutableSnapshot("wait-2", ["layer-1"], "Renamed")); await receiptResponse(sidecar, { planId, approvalId, status: "executed", operation: "apply_plan", postcondition: "passed", beforeFingerprint: before, appliedOperations: ["ensure_effect"], mayHaveMutated: true, mutationState: "applied" }); return item; })();
  const approved = await agent("ae_approve_plan", { planId, waitSeconds: 5 });
  await applying;
  assert.equal(fieldOf(approved, "data.status"), "verified", "one approve call returns the settled plan instead of a poll loop");
  assert.equal(fieldOf(approved, "data.receipt.postcondition"), "passed");

  await post("/v1/snapshots", mutableSnapshot("wait-3", ["layer-1"], "User edit"));
  const refused = await agent("ae_undo_plan", { planId, waitSeconds: 0 });
  assert.equal(refused.ok, false); assert.equal(fieldOf(refused, "error.code"), "UNDO_PROJECT_CHANGED");

  await post("/v1/snapshots", mutableSnapshot("wait-4", ["layer-1"], "Renamed"));
  const undoReceiptBody = { planId, receiptId: "undo-retry-1", operation: "undo_plan", status: "executed", executed: true, method: "exact-undo-label" };
  const undoing = (async () => { const item = await claim(); assert.equal(fieldOf(item, "kind"), "undo_plan"); assert.match(String(fieldOf(item, "undoGroup")), /^extynt — /); await post("/v1/snapshots", mutableSnapshot("wait-5")); await receiptResponse(sidecar, undoReceiptBody); })();
  const undone = await agent("ae_undo_plan", { planId, waitSeconds: 5 });
  await undoing;
  assert.equal(fieldOf(undone, "data.status"), "undone");
  assert.equal(fieldOf(undone, "data.receipt.undo.restoredPreApplyFingerprint"), true);
  assert.equal((await receiptResponse(sidecar, undoReceiptBody)).status, 200);
  assert.equal((await receiptResponse(sidecar, { ...undoReceiptBody, method: "different-method" })).status, 409);
  const reapprove = await agent("ae_approve_plan", { planId, waitSeconds: 0 });
  assert.equal(fieldOf(reapprove, "error.code"), "PLAN_UNDONE");
});

test("an approval whose command cannot compile fails loudly instead of sticking at approved", async (t) => {
  const { post, agent } = await queueHarness(t);
  await post("/v1/snapshots", mutableSnapshot("q-1"));
  const planId = String((await agent("ae_prepare_change")).body.data.planId);

  await post("/v1/snapshots", mutableSnapshot("q-2", []));
  const approved = await agent("ae_approve_plan", { planId });
  assert.equal(approved.status, 422);
  assert.equal(approved.body.error?.code, "STALE_SELECTION");
  assert.equal((await agent("ae_get_plan_status", { planId })).body.data.status, "prepared", "never reported as approved");
});

test("an agent approval refuses a plan whose graph changed after it was prepared, and never reports it approved", async (t) => {
  const { post, agent } = await queueHarness(t);
  await post("/v1/snapshots", mutableSnapshot("g-1"));
  const planId = String((await agent("ae_prepare_change")).body.data.planId);

  await post("/v1/snapshots", mutableSnapshot("g-2", ["layer-1"], "Changed before approval"));
  const approved = await agent("ae_approve_plan", { planId });
  assert.equal(approved.status, 422);
  assert.equal(approved.body.error?.code, "STALE_SNAPSHOT");
  assert.equal((await agent("ae_get_plan_status", { planId })).body.data.status, "prepared", "never reported as approved");
});

test("plans approved back-to-back rebase over earlier queued agent plans, but not over direct edits", async (t) => {
  const { post, agent, claim, sidecar } = await queueHarness(t);
  withoutThumbnails(sidecar);
  await post("/v1/snapshots", mutableSnapshot("chain-1"));
  const first = String((await agent("ae_prepare_change")).body.data.planId);
  const second = String((await agent("ae_prepare_change")).body.data.planId);
  const third = String((await agent("ae_prepare_change")).body.data.planId);
  for (const planId of [first, second, third]) assert.equal((await agent("ae_approve_plan", { planId })).body.ok, true);
  assert.equal((await agent("ae_get_plan_status", { planId: third })).body.data.queuePosition, 3);

  const firstItem = await claim();
  assert.equal(firstItem.item?.planId, first);
  const before = String(fieldOf(firstItem.item, "plan.snapshotFingerprint"));
  await post("/v1/snapshots", mutableSnapshot("chain-2", ["layer-1"], "After first plan"));
  await post("/v1/receipts", { planId: first, approvalId: fieldOf(firstItem.item, "approval.token"), operation: "apply_plan", status: "executed", postcondition: "passed", beforeFingerprint: before, appliedOperations: ["ensure_effect"], mayHaveMutated: true, mutationState: "applied" });

  const secondItem = await claim();
  assert.equal(secondItem.item?.planId, second, "the drift is explained by the first plan's receipt");
  assert.notEqual(fieldOf(secondItem.item, "plan.snapshotFingerprint"), before);
  assert.equal(fieldOf(secondItem.item, "command.operation"), "apply_plan");
  const status = await agent("ae_get_plan_status", { planId: second });
  assert.deepEqual(status.body.data.rebased, { overPlans: [first] });

  await post("/v1/snapshots", mutableSnapshot("chain-3", ["layer-1"], "User renamed it"));
  await post("/v1/receipts", { planId: second, approvalId: fieldOf(secondItem.item, "approval.token"), operation: "apply_plan", status: "executed", postcondition: "passed", appliedOperations: ["ensure_effect"], mayHaveMutated: true, mutationState: "applied" });
  await post("/v1/snapshots", mutableSnapshot("chain-4", ["layer-1"], "User renamed it again"));
  assert.equal((await claim()).item, null);
  const rejected = (await agent("ae_get_plan_status", { planId: third })).body.data;
  assert.equal(fieldOf(rejected, "status"), "failed"); assert.equal(fieldOf(rejected, "receipt.error.code"), "STALE_SNAPSHOT"); assert.equal(fieldOf(rejected, "receipt.mayHaveMutated"), false);
});

test("agent calls from a stale MCP process carry a version-skew warning", async (t) => {
  const { post, agent } = await queueHarness(t);
  await post("/v1/snapshots", mutableSnapshot("skew-1"));
  const warning = String((await agent("ae_get_current_context", {}, {})).body.warning);
  assert.match(warning, /^VERSION_SKEW: the agent's extynt MCP server is .+ but this sidecar is /);
  assert.match(warning, /Quit and reopen the agent app/);
  assert.equal(warning.includes("0.4.3"), false, "no legacy version literal");
  assert.equal((await agent("ae_get_current_context")).body.warning, undefined);
});

test("apply_preset: agents address presets by id, only the claimed panel command carries the path, and a vanished preset fails at approval", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "ae-presets-")); mkdirSync(join(root, "Behaviors"), { recursive: true });
  const presetFile = join(root, "Behaviors", "Wiggle Position.ffx"); writeFileSync(presetFile, "ffx");
  const sidecar = withoutThumbnails(sidecarFor({ port: 0, token, panelSessionId: "panel-presets", stateDirectory: mkdtempSync(join(tmpdir(), "ae-preset-state-")), presetRoots: [{ path: root, alias: "user-presets" }], effectControlEvidence: { effects: {} } }));
  const address = await sidecar.start(); t.after(() => sidecar.stop());
  const base = `http://${address.host}:${address.port}`;
  const post = <T>(path: string, body: T) => fetch(`${base}${path}`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(body) });
  const agent = async (name: string, args: JsonObject = {}) => { const response = await fetch(`${base}/v1/mcp/tools/call`, { method: "POST", headers: { ...authorization, "content-type": "application/json", "X-AE-Client": "agent", "X-AE-Client-Version": MCP_SERVER_VERSION }, body: JSON.stringify({ name, arguments: { waitSeconds: 0, ...withVerificationAck(name, args) } }) }); const text = await response.text(); return { status: response.status, text, body: recordOf(parseJson(text), "") }; };
  assert.equal((await post("/v1/host-census", hostCensus(3))).status, 201);
  await post("/v1/snapshots", mutableSnapshot("preset-1"));
  const found = await agent("ae_search_host_capabilities", { query: "Wiggle", kinds: ["preset"] });
  const presetId = String(fieldOf(found.body, "data.entries.0.id"));
  assert.match(presetId, /^preset:user-presets:[0-9a-f]{20}$/);
  assert.equal(found.text.includes(root), false, "search never exposes the preset path");
  const operations = [
    { type: "apply_preset", target: { compositionId: "comp-1", layerId: "layer-1" }, presetId },
    { type: "ensure_layer_style", target: { compositionId: "comp-1", layerId: "layer-1" }, style: "stroke" },
  ];
  const proposed = await agent("ae_propose_plan", { summary: "Preset and stroke", operations });
  assert.equal(proposed.body.ok, true, JSON.stringify(proposed.body.error));
  const planId = String(fieldOf(proposed.body, "data.planId"));
  const approved = await agent("ae_approve_plan", { planId });
  assert.equal(approved.body.ok, true, JSON.stringify(approved.body.error));
  assert.equal(approved.text.includes(root), false, "the approval response never carries the path");
  const claimed = await readJson(claimResponse(sidecar));
  const command = listOf(claimed, "item.command.operations");
  assert.equal(fieldOf(command[0], "presetPath"), presetFile);
  assert.deepEqual({ ...recordOf(command[1], "") }, { operation: "ensure_layer_style", compositionId: "comp-1", layerId: "layer-1", style: "stroke", styleMatchName: "frameFX/enabled", menu: "Stroke", commandId: 9008, enabled: true });
  await receiptResponse(sidecar, { planId, operation: "apply_plan", status: "rejected", postcondition: "not_run", mayHaveMutated: false, mutationState: "not-applied", appliedOperations: [], error: { code: "PRESET_APPLY_FAILED", message: "test" } });

  const second = await agent("ae_propose_plan", { summary: "Preset again", operations: operations.slice(0, 1) });
  rmSync(presetFile);
  const refused = await agent("ae_approve_plan", { planId: String(fieldOf(second.body, "data.planId")) });
  assert.equal(fieldOf(refused.body, "error.code"), "PRESET_NOT_FOUND");
  const unknown = await agent("ae_propose_plan", { summary: "Unknown preset", operations: [{ ...operations[0], presetId: "preset:user-presets:ffffffffffffffffffff" }] });
  assert.equal(fieldOf(unknown.body, "error.code"), "PRESET_NOT_FOUND");
  const pathLike = await agent("ae_propose_plan", { summary: "Path preset", operations: [{ ...operations[0], presetId: presetFile }] });
  assert.equal(fieldOf(pathLike.body, "error.code"), "INVALID_VALUE");
});
