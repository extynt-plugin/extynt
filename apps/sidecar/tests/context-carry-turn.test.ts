/** A follow-up turn reads the carried summary in the trailing live-state message, with the cached prefix unchanged. */
import assert from "node:assert/strict";
import test from "node:test";
import { MockProvider, splitTransient, type AgentStepInput } from "@extynt/llm";
import { authorization, chatTurn, claimResponse, mutableSnapshot, queueFinishStep, queueRename, receiptResponse, sidecarFor, token, workflowStageStep } from "./sidecar-fixture.js";
import { readJson, textOf } from "./http-json.js";
import { type JsonValue } from "@extynt/decode";

type Sidecar = ReturnType<typeof sidecarFor>;
type Address = Awaited<ReturnType<Sidecar["start"]>>;

const CONTINUATION_MARK = "WORKFLOW CONTINUATION INPUT";
const post = (base: string, path: string, body: JsonValue | ReturnType<typeof mutableSnapshot>, extra: Record<string, string> = {}) => fetch(`${base}${path}`, { method: "POST", headers: { ...authorization, "content-type": "application/json", ...extra }, body: JSON.stringify(body) });
const liveText = (input: AgentStepInput): string => splitTransient(input.messages).transient.map((message) => (typeof message.content === "string" ? message.content : "")).join("\n");

function carryProvider(seen: AgentStepInput[]): MockProvider {
  return new MockProvider({ script: (input: AgentStepInput) => {
    seen.push(input);
    if (input.system.includes(CONTINUATION_MARK)) return { text: "Done.", toolCalls: [] };
    const called = input.messages.filter((message) => message.role === "tool").map((message) => message.name);
    if (input.tools?.some((tool) => tool.name === "ae_select_workflow_stage") && !called.includes("ae_select_workflow_stage")) return workflowStageStep("carry");
    if (!called.includes("ae_queue_add")) return queueRename("carry", "Hero");
    if (!called.includes("ae_queue_finish")) return queueFinishStep("carry");
    return { text: "Done.", toolCalls: [] };
  } });
}

async function applyRename(sidecar: Sidecar, address: Address): Promise<void> {
  const base = `http://${address.host}:${address.port}`;
  await fetch(`${base}/v1/ui/prefs`, { method: "PATCH", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify({ askBeforeApplying: "always" }) });
  await post(base, "/v1/snapshots", mutableSnapshot("carry-before"));
  const [firstPlan] = (await chatTurn(address, "rename this to Hero")).plans;
  assert.ok(firstPlan, "the first turn proposed a plan");
  const { planId } = firstPlan;
  const approved = await post(base, "/v1/mcp/tools/call", { name: "ae_approve_plan", arguments: { planId, acknowledgeUnverified: true, waitSeconds: 0 } }, { "x-ae-client": "agent" });
  const approvalId = textOf(await readJson(approved), "data.approval.token");
  await claimResponse(sidecar);
  await post(base, "/v1/pipeline", { event: "apply-begin", detail: `${planId} 1 operations` });
  await post(base, "/v1/snapshots", mutableSnapshot("carry-after", ["layer-1"], "Hero"));
  const receipt = await receiptResponse(sidecar, { planId, approvalId, receiptId: "carry-verified", operation: "apply_plan", status: "executed", postcondition: "passed", appliedOperations: ["set_layer_name"], mayHaveMutated: true, mutationState: "applied", verification: { state: "exact", basis: "server fresh read", targetFound: true, steps: [{ verificationState: "exact", operation: "set_layer_name", layerId: "layer-1", expected: "Hero", observed: "Hero" }] } });
  assert.equal(receipt.status, 201);
}

async function followUp(base: string): Promise<Response> {
  const message = "now make it fade out";
  let raw = await post(base, "/v1/chat", { requestId: "chat-follow", message, history: [] });
  for (let attempt = 0; attempt < 80 && raw.status === 409; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    raw = await post(base, "/v1/chat", { requestId: `chat-follow-${attempt}`, message, history: [] });
  }
  return raw;
}

function assertCarriedTurn(seen: readonly AgentStepInput[]): void {
  const continuation = seen.filter((input) => input.system.includes(CONTINUATION_MARK));
  const [firstContinuation] = continuation;
  const lastContinuation = continuation.at(-1);
  assert.ok(firstContinuation && lastContinuation, "the receipt-driven continuation ran");
  assert.match(liveText(firstContinuation), /Carried project context/);
  assert.match(liveText(firstContinuation), /layer-1/);
  const turn = seen.slice(seen.indexOf(lastContinuation) + 1);
  const [head] = turn;
  assert.ok(head);
  assert.match(liveText(head), /Carried project context/);
  assert.match(liveText(head), /layer-1/);
  assert.match(liveText(head), /Last plan: applied and verified/);
  assert.doesNotMatch(head.system, /Carried project context/);
  for (const step of turn) {
    assert.equal(step.system, head.system);
    assert.equal(JSON.stringify(step.tools), JSON.stringify(head.tools));
  }
}

test("a follow-up turn gets the carried summary with the changed layer id, and system and tools do not move", async (t) => {
  const seen: AgentStepInput[] = [];
  const sidecar = sidecarFor({ port: 0, token, chatProvider: carryProvider(seen), quietAgentLog: true });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  await applyRename(sidecar, address);
  assert.ok(!seen.some((input) => /Carried project context/.test(liveText(input)) && !input.system.includes(CONTINUATION_MARK)), "no summary before any batch exists");
  const raw = await followUp(`http://${address.host}:${address.port}`);
  assert.equal(raw.status, 200, await raw.clone().text());
  assertCarriedTurn(seen);
});
