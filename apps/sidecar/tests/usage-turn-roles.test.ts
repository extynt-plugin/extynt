/** A turn reports everything it cost: the owner's loops, every specialist call (corrections included), and the stages that run after Apply. */
import assert from "node:assert/strict";
import test from "node:test";
import { MockProvider } from "@extynt/llm";
import type { JsonObject } from "@extynt/decode";
import { parseJson, readJson, recordOf, textOf } from "./http-json.js";
import { authorization, claimResponse, designerTurn, mutableSnapshot, pause, receiptResponse, sidecarFor, token, workflowStageStep } from "./sidecar-fixture.js";

const OWNER_USAGE = { inputTokens: 100, outputTokens: 10, totalTokens: 110, cachedInputTokens: 40 };
const SESSION = "33333333-3333-4333-8333-333333333333";

function captureRows(t: test.TestContext): JsonObject[] {
  const rows: JsonObject[] = [];
  t.mock.method(process.stdout, "write", (chunk: string | Uint8Array) => {
    try {
      rows.push(recordOf(parseJson(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8")), ""));
    } catch {
      return true;
    }
    return true;
  });
  return rows;
}

test("a turn that runs a specialist reports the specialist's tokens in its total, and per role", async (t) => {
  let specialistCalls = 0;
  const specialist = new MockProvider({ model: "scene-model", script: (input) => {
    specialistCalls += 1;
    return { ...designerTurn(input), usage: { inputTokens: 1000, outputTokens: 200, cachedInputTokens: 300 } };
  } });
  let ownerCalls = 0;
  const owner = new MockProvider({ script: () => {
    ownerCalls += 1;
    if (ownerCalls === 1) return { text: "", toolCalls: [{ id: "launch", name: "ae_consult_specialist", arguments: { action: "launch", role: "visual-scene", instruction: "Design the scene." } }], usage: OWNER_USAGE };
    if (ownerCalls === 2) return { text: "", toolCalls: [{ id: "wait", name: "ae_consult_specialist", arguments: { action: "wait", role: "visual-scene", waitSeconds: 5 } }], usage: OWNER_USAGE };
    return { text: "Designed.", toolCalls: [], usage: OWNER_USAGE };
  } });
  const sidecar = sidecarFor({ port: 0, token, chatProvider: owner, workflowSpecialistProviders: { "visual-scene": specialist } });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  const base = `http://${address.host}:${address.port}`;
  await fetch(`${base}/v1/ui/prefs`, { method: "PATCH", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify({ askBeforeApplying: "always" }) });
  await fetch(`${base}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(mutableSnapshot("usage-specialist")) });
  const rows = captureRows(t);
  const response = await fetch(`${base}/v1/chat`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify({ requestId: "usage-specialist", message: "design a planet scene", sessionId: SESSION, autoApply: true }) });
  assert.equal(response.status, 200);
  t.mock.restoreAll();

  const turn = rows.find((row) => row.event === "agent.turn" && row.requestId === "usage-specialist");
  assert.ok(turn, "the turn summary is written");
  const scene = recordOf(recordOf(turn, "roles"), "visual-scene");
  assert.equal(specialistCalls, 2, "the designer's build step and its report step");
  assert.equal(scene.calls, 2);
  assert.equal(scene.inputTokens, 2000);
  assert.equal(scene.cachedInputTokens, 600);
  assert.equal(scene.freshInputTokens, 1400);
  assert.equal(scene.outputTokens, 400);
  assert.equal(recordOf(recordOf(turn, "roles"), "main").calls, 4, "the owner is woken once more when the designer reports");
  assert.equal(turn.modelCalls, 6, "owner loops plus every specialist call");
  assert.equal(turn.inputTokens, 2400);
  assert.equal(turn.outputTokens, 440);
  assert.equal(turn.cachedInputTokens, 760);
  assert.equal(turn.freshInputTokens, 1640);
  assert.equal(turn.tokens, 2840);
});

test("a stage that runs after Apply writes its own agent.turn row under the same request id", async (t) => {
  const provider = new MockProvider({ script: (input) => {
    const marker = "WORKFLOW CONTINUATION INPUT";
    if (input.system.includes(marker)) return { text: "Nothing further to inspect.", toolCalls: [], usage: { inputTokens: 70, outputTokens: 7, totalTokens: 77, cachedInputTokens: 10 } };
    const called = input.messages.filter((message) => message.role === "tool").map((message) => message.name);
    if (!called.includes("ae_select_workflow_stage")) return { ...workflowStageStep("usage-cycle", "Rename the layer", ["set_layer_name"]), usage: OWNER_USAGE };
    if (!called.includes("ae_queue_add")) return { text: "", toolCalls: [{ id: "add", name: "ae_queue_add", arguments: { summary: "Rename", operations: [{ type: "set_layer_name", target: { compositionId: "comp-1", layerId: "layer-1" }, name: "Corrected" }] } }], usage: OWNER_USAGE };
    return { text: "", toolCalls: [{ id: "finish", name: "ae_queue_finish", arguments: {} }], usage: OWNER_USAGE };
  } });
  const sidecar = sidecarFor({ port: 0, token, chatProvider: provider });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  const base = `http://${address.host}:${address.port}`;
  const post = <T,>(path: string, body: T) => path === "/v1/receipts" ? receiptResponse(sidecar, body) : fetch(`${base}${path}`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(body) });
  await fetch(`${base}/v1/ui/prefs`, { method: "PATCH", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify({ askBeforeApplying: "always" }) });
  await post("/v1/snapshots", mutableSnapshot("usage-cycle-before"));
  const rows = captureRows(t);
  const initial = await readJson(await post("/v1/chat", { requestId: "usage-cycle", message: "rename this to Corrected", sessionId: SESSION }));
  const planId = textOf(initial, "plans.0.planId");
  const approved = await fetch(`${base}/v1/mcp/tools/call`, { method: "POST", headers: { ...authorization, "content-type": "application/json", "x-ae-client": "agent" }, body: JSON.stringify({ name: "ae_approve_plan", arguments: { planId, acknowledgeUnverified: true, waitSeconds: 0 } }) });
  const approvalId = textOf(await readJson(approved), "data.approval.token");
  await claimResponse(sidecar);
  await post("/v1/pipeline", { event: "apply-begin", detail: `${planId} 1 operations` });
  await post("/v1/snapshots", mutableSnapshot("usage-cycle-after", ["layer-1"], "Original"));
  await post("/v1/receipts", { planId, approvalId, receiptId: "usage-cycle-mismatch", operation: "apply_plan", status: "executed", postcondition: "failed", appliedOperations: ["set_layer_name"], mayHaveMutated: true, mutationState: "applied", verification: { steps: [{ operation: "set_layer_name", observed: false, verificationState: "failed", basis: "layer-name-mismatch", compositionId: "comp-1", layerId: "layer-1", expectedValue: "Corrected", observedValue: "Original" }] } });
  const continued = () => rows.filter((row) => row.event === "agent.turn" && row.continuation === true);
  for (let attempt = 0; attempt < 200 && !continued().length; attempt += 1) await pause(10);
  t.mock.restoreAll();

  const stage = continued()[0];
  assert.ok(stage, "the post-Apply stage wrote an agent.turn row");
  assert.equal(stage.requestId, "usage-cycle");
  assert.equal(stage.modelCalls, 1);
  assert.equal(stage.inputTokens, 70);
  assert.equal(stage.cachedInputTokens, 10);
  assert.equal(stage.freshInputTokens, 60);
  assert.equal(stage.outputTokens, 7);
  assert.equal(recordOf(recordOf(stage, "roles"), "main").calls, 1);
});
