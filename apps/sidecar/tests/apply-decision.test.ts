/** The sidecar owns each sealed batch's apply decision: the panel's toggle, a review the user asked for, and a hold the agent placed. */
import { fieldOf, readJson, recordsOf, textOf, type JsonObject } from "./http-json.js";
import { uiStoreFor } from "../src/ui-store.js";
import { authorization, chatTurn, claimResponse, mutableSnapshot, pause, receiptResponse, sidecarFor, token, workflowStageStep } from "./sidecar-fixture.js";
import { MockProvider } from "@extynt/llm";
import type { AgentStepInput } from "@extynt/llm";
import { present } from "./present.js";
import assert from "node:assert/strict";
import test from "node:test";

const CONTINUATION_MARKER = "WORKFLOW CONTINUATION INPUT";

const renameProvider = (name: string, review?: boolean) => new MockProvider({ script: (input) => {
  const called = input.messages.filter((message) => message.role === "tool").map((message) => message.name);
  if (!called.includes("ae_select_workflow_stage")) return workflowStageStep("decision");
  if (!called.includes("ae_queue_add")) return { text: "", toolCalls: [{ id: "add", name: "ae_queue_add", arguments: { summary: "Rename", operations: [{ type: "set_layer_name", target: { compositionId: "comp-1", layerId: "layer-1" }, name }] } }] };
  if (!called.includes("ae_queue_finish")) return { text: "", toolCalls: [{ id: "finish", name: "ae_queue_finish", arguments: { waitSeconds: 10, ...(review === undefined ? {} : { review }) } }] };
  return { text: "", toolCalls: [] };
} });

interface StickyStage { stage: string; summary: string; name: string; finish: JsonObject }

const STICKY_STAGES: Record<"first" | "second", StickyStage> = {
  first: { stage: "first", summary: "First", name: "Hero", finish: { review: true } },
  second: { stage: "second", summary: "Second", name: "Zero", finish: {} },
};

const stickyStep = (input: AgentStepInput, stage: StickyStage) => {
  const called = input.messages.filter((message) => message.role === "tool").map((message) => message.name);
  if (!called.includes("ae_select_workflow_stage")) return workflowStageStep(stage.stage);
  if (!called.includes("ae_queue_add")) return { text: "", toolCalls: [{ id: "add", name: "ae_queue_add", arguments: { summary: stage.summary, operations: [{ type: "set_layer_name", target: { compositionId: "comp-1", layerId: "layer-1" }, name: stage.name }] } }] };
  if (!called.includes("ae_queue_finish")) return { text: "", toolCalls: [{ id: "finish", name: "ae_queue_finish", arguments: stage.finish }] };
  return { text: "", toolCalls: [] };
};

const post = <T>(base: string, path: string, body: T, headers: Record<string, string> = {}) => fetch(`${base}${path}`, { method: "POST", headers: { ...authorization, "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const readyEntries = async (base: string): Promise<JsonObject[]> => recordsOf(await readJson(await fetch(`${base}/v1/chat/plans/ready`, { headers: authorization })), "plans");

async function startWith(t: test.TestContext, provider: MockProvider, probe: string): Promise<{ sidecar: ReturnType<typeof sidecarFor>; address: { host: string; port: number }; base: string }> {
  const sidecar = sidecarFor({ port: 0, token, chatProvider: provider, quietAgentLog: true });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  const base = `http://${address.host}:${address.port}`;
  await post(base, "/v1/snapshots", mutableSnapshot(probe));
  return { sidecar, address, base };
}

test("a sealed batch carries the sidecar's apply decision, and the agent can narrow it but never widen it", async (t) => {
  const cases: Array<{ ask: "risky" | "always"; review?: boolean; expected: boolean; why: string }> = [
    { ask: "risky", expected: true, why: "the preference lets a reversible edit through and nothing held the batch" },
    { ask: "always", expected: false, why: "the preference asks about every plan" },
    { ask: "always", review: false, expected: false, why: "the agent cannot grant what the preference withheld" },
    { ask: "risky", review: true, expected: false, why: "the agent held the batch for review" },
  ];
  for (const entry of cases) {
    const { sidecar, address, base } = await startWith(t, renameProvider("Hero", entry.review), `probe-decision-${cases.indexOf(entry)}`);
    uiStoreFor(sidecar).patchPrefs({ askBeforeApplying: entry.ask });
    const reply = await chatTurn(address, "rename this to Hero");
    assert.equal(reply.outcome, "planned", JSON.stringify(reply));
    const ready = await readyEntries(base);
    assert.equal(fieldOf(ready[0], "autoApply"), entry.expected, `the ready batch: ${entry.why}`);
    assert.equal(reply.plans[0]?.autoApply, entry.expected, `and the reply card says the same: ${entry.why}`);
    if (!entry.expected) assert.match(reply.answer, /press Apply/, "a batch that waits for the user is never described as applied");
  }
});

test("a batch nobody commits without a click is not waited on, even with the host online", async (t) => {
  for (const [review, ask] of [[true, "risky"], [false, "always"]] as const) {
    const { sidecar, address, base } = await startWith(t, renameProvider("Hero", review), `probe-held-wait-${ask}`);
    uiStoreFor(sidecar).patchPrefs({ askBeforeApplying: ask });
    const startedAt = Date.now();
    const reply = await chatTurn(address, "rename this to Hero");
    const elapsed = Date.now() - startedAt;
    assert.equal(reply.outcome, "planned");
    assert.equal(fieldOf((await readyEntries(base))[0], "autoApply"), false, `held: review ${String(review)}, preference ${ask}`);
    assert.ok(elapsed < 5_000, `the reply carries the card instead of spending the 10-second wait on an apply that needs the user (took ${elapsed} ms)`);
  }
});

test("a review hold covers every later batch of its request, and the continuation is briefed as manual", async (t) => {
  let continuationSystem = "";
  const provider = new MockProvider({ script: (input) => {
    const continuing = input.system.includes(CONTINUATION_MARKER);
    if (continuing) continuationSystem = input.system;
    return stickyStep(input, continuing ? STICKY_STAGES.second : STICKY_STAGES.first);
  } });
  const { sidecar, address, base } = await startWith(t, provider, "probe-hold-sticky");
  const reply = await chatTurn(address, "rename this to Hero, then to Zero");
  const planId = present(reply.plans[0], "the first plan").planId;
  assert.equal(fieldOf((await readyEntries(base))[0], "autoApply"), false, "the first batch is held for the user");

  const approved = await readJson(await post(base, "/v1/mcp/tools/call", { name: "ae_approve_plan", arguments: { planId, acknowledgeUnverified: true, waitSeconds: 0 } }, { "x-ae-client": "agent" }));
  claimResponse(sidecar);
  assert.equal((await post(base, "/v1/pipeline", { event: "apply-begin", detail: `${planId} 1 operations` })).status, 200);
  await post(base, "/v1/snapshots", mutableSnapshot("probe-hold-after-apply", ["layer-1"], "Hero"));
  const receipt = await receiptResponse(sidecar, { planId, approvalId: textOf(approved, "data.approval.token"), receiptId: "hold-first", operation: "apply_plan", status: "executed", postcondition: "passed", appliedOperations: ["set_layer_name"], mayHaveMutated: true, mutationState: "applied", verification: { state: "exact", basis: "server fixture readback", steps: [{ operation: "set_layer_name", verificationState: "exact", observed: true, basis: "server fixture readback" }] } });
  assert.equal(receipt.status, 201);

  let second: JsonObject | undefined;
  for (let attempt = 0; attempt < 200 && !second; attempt += 1) {
    second = (await readyEntries(base))[0];
    if (!second) await pause(25);
  }
  assert.ok(second, "the continuation sealed the next batch");
  assert.notEqual(fieldOf(second, "planId"), planId);
  assert.equal(fieldOf(second, "autoApply"), false, "a batch sealed without review is still held: the hold covers the request");
  assert.match(continuationSystem, /autoApply: OFF/, "and the continuation was told the user applies each batch");
});
