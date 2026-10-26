// An over-full queue call starts the next batch instead of being refused.
import { authorization, chatTurn, mutableSnapshot, sidecarForPlugin, token } from "./sidecar-fixture.js";
import { rollOverFullBatch } from "../src/server-workflow-batch-rollover.js";
import { MockProvider } from "@extynt/llm";
import assert from "node:assert/strict";
import test from "node:test";

const operation = (name: string) => ({ type: "set_layer_name", target: { compositionId: "comp-1", layerId: "layer-1" }, name });
const stageCall = { id: "stage", name: "ae_select_workflow_stage", arguments: { summary: "Rename the selected layer", operationTypes: ["set_layer_name"] } };

async function runShape(t: test.TestContext, sizes: number[]) {
  const provider = new MockProvider({ script: (input) => {
    const called = input.messages.filter((message) => message.role === "tool").map((message) => message.name);
    const adds = called.filter((name) => name === "ae_queue_add").length;
    if (!called.includes("ae_select_workflow_stage")) return { text: "", toolCalls: [stageCall] };
    if (adds < sizes.length) return { text: "", toolCalls: [{ id: `add-${adds}`, name: "ae_queue_add", arguments: { summary: "Renames", operations: Array.from({ length: sizes[adds] ?? 0 }, (_, index) => operation(`Draft ${adds}-${index}`)) } }] };
    if (!called.includes("ae_queue_finish")) return { text: "", toolCalls: [{ id: "finish", name: "ae_queue_finish", arguments: {} }] };
    return { text: "Done.", toolCalls: [] };
  } });
  Object.assign(provider.config, { reasoningEffort: "high" as const });
  const sidecar = sidecarForPlugin({ port: 0, token, chatProvider: provider, quietAgentLog: true });
  const address = await sidecar.start(); t.after(() => sidecar.stop());
  await fetch(`http://${address.host}:${address.port}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(mutableSnapshot("workflow-rollover")) });
  const result = await chatTurn(address, "rename this to Hero, as the first part of a larger cleanup");
  return { ...result, seen: (provider.stepInputs.at(-1)?.messages ?? []).filter((message) => message.role === "tool" && message.name === "ae_queue_add").map((message) => message.content) };
}

test("a call that overflows the open batch but fits an empty one seals the open batch and queues into the next", async (t) => {
  const result = await runShape(t, [3, 25]);
  const adds = result.tools.filter((tool) => tool.name === "ae_queue_add");
  assert.equal(adds.length, 2, JSON.stringify(result.tools));
  assert.ok(adds.every((tool) => tool.ok), "neither add is refused");
  assert.ok(!result.tools.some((tool) => tool.code === "WORKFLOW_BATCH_BOUND"), "no batch-bound refusal");
  assert.match(result.seen[1] ?? "", /Sealed the 3 queued operations as batch \d+ \(applying\); queued these 25 as batch \d+\./, "one sentence says what the sidecar did");
});

test("a call larger than an empty batch is still refused", async (t) => {
  const result = await runShape(t, [3, 26]);
  assert.ok(result.tools.some((tool) => tool.name === "ae_queue_add" && tool.code === "WORKFLOW_BATCH_BOUND"));
});

test("a seal that is refused leaves the batch-bound refusal to stand", async () => {
  const ran: string[] = [];
  const deps = { state: { openQueuePlanId: "p", plans: new Map([["p", { plan: { operations: Array.from({ length: 3 }, () => operation("x")) } }]]) } };
  const input = { workflowJobId: "job" };
  const call = { name: "ae_queue_add", args: { operations: Array.from({ length: 25 }, () => operation("y")) }, input };
  const rolled = await rollOverFullBatch(deps, call, async (name) => { ran.push(name); return { ok: false, error: { code: "PLAN_PROBLEMS", message: "outstanding" } }; });
  assert.deepEqual(ran, ["ae_queue_finish"]);
  assert.deepEqual(rolled, {}, "nothing rolled; the ordinary boundary then refuses the call");
});
