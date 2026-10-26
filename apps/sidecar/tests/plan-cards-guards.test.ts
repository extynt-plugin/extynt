/** Plan cards and the guards around them: notices, bounds, receipts that cannot invent work, status waits, and handoff. */
import type { JsonObject, JsonValue } from "@extynt/decode";
import { runAgent } from "../src/agent.js";
import { withoutThumbnails } from "./host-without-thumbnails.js";
import { fieldOf, listOf, maybeFlagOf, maybeListOf, readJson, recordOf, textOf } from "./http-json.js";
import { authorization, claimResponse, mutableSnapshot, queueHarness, receiptResponse, sidecarFor, token, withVerificationAck, workflowStageStep } from "./sidecar-fixture.js";
import { MockProvider } from "@extynt/llm";
import { MCP_SERVER_VERSION } from "@extynt/mcp-server";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("a long plan stays one card under the id the plan store issued", async () => {

  const operations = Array.from({ length: 30 }, (_, i) => ({ before: `layer ${i}`, after: "opacity 100" }));
  let step = 0;
  const provider = new MockProvider({ script: async () => step++ === 0
    ? { text: "", toolCalls: [{ id: "c1", name: "ae_queue_finish", arguments: {} }], usage: undefined, raw: undefined }
    : { text: "Done.", toolCalls: [], usage: undefined, raw: undefined } });
  const result = await runAgent(provider, {
    requestId: "r1", message: "fade every layer", history: [], briefing: "b",
    callTool: () => ({ ok: true, sealedCard: { planId: "plan-1", presentation: { title: "Fade everything", values: operations, warnings: [] }, plan: { operations: [] } }, data: { sealed: true, operationCount: 30, undoGroups: 2, queued: 0 } }),
  });
  assert.equal(result.plans.length, 1);
  assert.equal(result.plans[0]?.planId, "plan-1");
  assert.equal(result.plans[0]?.operations.length, 30);
  assert.ok(!result.plans.some((plan) => plan.planId.includes("--part")), "no card carries an invented plan id");
});

async function agentPlanCard(card: JsonValue) {

  let step = 0;
  const provider = new MockProvider({ script: async () => step++ === 0
    ? { text: "", toolCalls: [{ id: "c1", name: "ae_queue_finish", arguments: {} }], usage: undefined, raw: undefined }
    : { text: "Done.", toolCalls: [], usage: undefined, raw: undefined } });
  const result = await runAgent(provider, { requestId: "r-card", message: "go", history: [], briefing: "b", callTool: () => ({ ok: true, sealedCard: card, data: { sealed: true, operationCount: 1, undoGroups: 1, queued: 0 } }) });
  return result.plans[0];
}

type PlanCard = NonNullable<Awaited<ReturnType<typeof agentPlanCard>>>;
type PlanNotice = NonNullable<PlanCard["notices"]>[number];

function assertNoticeBounds(note: PlanNotice | undefined): void {
  assert.equal(note?.detail.length, 400, "an over-long detail is bounded");
  assert.ok(note?.detail.endsWith("…"), "the cut is visible");
  assertNoticeLengths(note);
}

function assertNoticeLengths(note: PlanNotice | undefined): void {
  assert.equal(note?.because?.length, 600);
  assert.equal(note?.action?.length, 200);
  assert.deepEqual(note?.operationIndexes, [0, 2], "only finite numbers survive");
  assert.equal(note?.code, "LARGE_PLAN");
}

function assertNoticeFieldsDropped(unverified: PlanNotice | undefined, error: PlanNotice | undefined): void {
  assert.equal("operationIndexes" in (unverified ?? {}), false, "a non-array is dropped, not coerced");
  assert.equal(error?.title, "Two steps set the same key");
}

test("a plan card carries classified notices, bounded, and drops a severity it cannot show", async () => {
  const card = await agentPlanCard({
    planId: "plan-notices",
    presentation: {
      title: "Title ident",
      values: [{ before: "layer a", after: "opacity 100" }],
      warnings: ["A long plan: 59 operations."],
      notices: [
        { severity: "note", title: "A long plan", detail: "d".repeat(900), because: "b".repeat(900), action: "a".repeat(500), operationIndexes: [0, 2, Number.NaN, "3"], code: "LARGE_PLAN" },
        { severity: "unverified", title: "Never tested on this build", detail: "Reading it back was not possible.", because: "No evidence was recorded.", action: "Apply, then check the layer.", operationIndexes: "not an array" },
        { severity: "error", title: "Two steps set the same key", detail: "The second write wins." },
        { severity: "fatal", title: "Not a class the panel has", detail: "This entry is dropped." },
        null,
        "junk",
      ],
    },
  });
  const notices = card?.notices ?? [];
  assert.equal(notices.length, 3, "a severity the panel has no icon for is dropped, not guessed at");
  assert.deepEqual(notices.map((notice) => notice.severity), ["note", "unverified", "error"], "order is kept");
  const [note, unverified, error] = notices;
  assertNoticeBounds(note);
  assertNoticeFieldsDropped(unverified, error);

  assert.deepEqual(card?.warnings, ["A long plan: 59 operations."]);
});

test("the card caps notices at eight and operations at 256 on both paths", async () => {
  const notices = Array.from({ length: 12 }, (_, index) => ({ severity: "note", title: `notice ${index}`, detail: "detail" }));
  const values = Array.from({ length: 300 }, (_, index) => ({ before: `layer ${index}`, after: "opacity 100" }));
  const byValues = await agentPlanCard({ planId: "plan-values", presentation: { title: "Values", values, notices, warnings: [] } });
  assert.equal(byValues?.notices?.length, 8);
  assert.deepEqual(byValues?.notices?.map((notice) => notice.title), ["notice 0", "notice 1", "notice 2", "notice 3", "notice 4", "notice 5", "notice 6", "notice 7"]);
  assert.equal(byValues?.operations.length, 256, "a 300-operation plan is not silently cut far below it");

  const byTypes = await agentPlanCard({ planId: "plan-types", presentation: { title: "Types", warnings: [], notices: [] }, plan: { operations: Array.from({ length: 300 }, (_, index) => ({ type: `op_${index}` })) } });
  assert.equal(byTypes?.operations.length, 256);
});

test("a receipt cannot invent an execution for a plan that was never approved or claimed", async (t) => {
  const { post, agent } = await queueHarness(t);
  await post("/v1/snapshots", mutableSnapshot("invent-1"));
  const planId = String((await agent("ae_prepare_change")).body.data.planId);
  const receipt = await post("/v1/receipts", { planId, status: "executed", postcondition: "passed", operation: "apply_plan" });
  assert.equal(receipt.status, 409);
  assert.equal(textOf(await readJson(receipt), "error.code"), "PLAN_NOT_EXECUTING");
  const status = (await agent("ae_get_plan_status", { planId })).body.data;
  assert.equal(status.status, "prepared", "no execution is invented");
  assert.equal(status.receipt, null);
  const undo = await post("/v1/receipts", { planId, operation: "undo_plan", status: "executed", executed: true, method: "edit-undo" });
  assert.equal(undo.status, 409);
  assert.equal(textOf(await readJson(undo), "error.code"), "PLAN_NOT_APPLIED");
  assert.equal((await agent("ae_get_plan_status", { planId })).body.data.status, "prepared", "an undo cannot invent an apply either");
});

test("a genuine receipt is recorded when a cancel raced the apply it could not stop", async (t) => {
  const { post, agent, claim, sidecar } = await queueHarness(t);
  withoutThumbnails(sidecar);
  await post("/v1/snapshots", mutableSnapshot("race-1"));
  const planId = String((await agent("ae_prepare_change")).body.data.planId);
  assert.equal((await agent("ae_approve_plan", { planId })).body.ok, true);
  assert.equal((await claim()).item?.planId, planId, "the panel claimed the apply before the cancel landed");
  assert.equal((await agent("ae_cancel_plan", { planId })).body.data?.status, "cancelled");
  const receipt = await post("/v1/receipts", { planId, operation: "apply_plan", status: "executed", postcondition: "passed", appliedOperations: ["ensure_effect"], mayHaveMutated: true, mutationState: "applied" });
  assert.equal(receipt.status, 201, "the host really ran the plan, so its receipt is the outcome");
  assert.equal(maybeFlagOf(await readJson(receipt), "receipt.cancelledDuringApply"), true, "the receipt records that the cancel raced the apply");
  const status = (await agent("ae_get_plan_status", { planId })).body.data;
  assert.equal(status.status, "verified");
  assert.equal(fieldOf(status, "receipt.planId"), planId);
});

test("approving or cancelling a plan wakes an explicit status wait instead of sleeping out its deadline", async (t) => {
  const { post, agent } = await queueHarness(t);
  await post("/v1/snapshots", mutableSnapshot("wake-1"));
  const planId = String((await agent("ae_prepare_change")).body.data.planId);
  const started = Date.now();
  const waiting = agent("ae_get_plan_status", { planId, waitSeconds: 3 });
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal((await agent("ae_approve_plan", { planId })).body.ok, true);
  const woken = await waiting;
  assert.equal(woken.body.data.status, "approved");
  assert.ok(Date.now() - started < 1500, `the waiter slept ${Date.now() - started}ms for a status that changed in ~200ms`);
  const second = String((await agent("ae_prepare_change")).body.data.planId);
  const cancelStarted = Date.now();
  const cancelWait = agent("ae_get_plan_status", { planId: second, waitSeconds: 3 });
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal((await agent("ae_cancel_plan", { planId: second })).body.data?.status, "cancelled");
  assert.equal((await cancelWait).body.data.status, "cancelled");
  assert.ok(Date.now() - cancelStarted < 1500, `the waiter slept ${Date.now() - cancelStarted}ms for a cancel`);
});

test("the plan store is bounded but never evicts work the queue still needs", async (t) => {
  const sidecar = withoutThumbnails(sidecarFor({ port: 0, token, panelSessionId: "panel-bound", stateDirectory: mkdtempSync(join(tmpdir(), "ae-bound-")) }));
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  const base = `http://${address.host}:${address.port}`;
  const post = <T,>(path: string, body: T) => fetch(`${base}${path}`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(body) });
  const agent = async (name: string, args: JsonObject = {}) => recordOf(await readJson((await fetch(`${base}/v1/mcp/tools/call`, { method: "POST", headers: { ...authorization, "content-type": "application/json", "X-AE-Client": "agent", "X-AE-Client-Version": MCP_SERVER_VERSION }, body: JSON.stringify({ name, arguments: { waitSeconds: 0, ...withVerificationAck(name, args) } }) }))), "");
  await post("/v1/snapshots", mutableSnapshot("bound-1"));
  const queued = String(fieldOf(await agent("ae_prepare_change"), "data.planId"));
  const approval = await agent("ae_approve_plan", { planId: queued });
  assert.equal(approval.ok, true);
  for (let index = 0; index < 300; index += 1) assert.equal((await agent("ae_prepare_change")).ok, true, `prepare ${index} succeeded`);
  const plans = sidecar.plans;
  assert.ok(plans instanceof Map, "the sidecar exposes a plan store");
  assert.ok(plans.size <= 256, `the plan store grew to ${plans.size} records`);
  assert.ok(plans.has(queued), "a plan the mailbox still has to claim is never evicted");
  const claimed = await readJson(claimResponse(sidecar));
  assert.equal(fieldOf(claimed, "item.planId"), queued, "the queued command is still claimable");
  assert.equal((await receiptResponse(sidecar, { planId: queued, approvalId: fieldOf(approval, "data.approval.token"), status: "executed", postcondition: "passed", operation: "apply_plan", appliedOperations: ["ensure_effect"], mayHaveMutated: true, mutationState: "applied" })).status, 201, "the claimed plan still records its receipt");
});

test("a panel event with no code and message is refused instead of fabricating a host failure", async (t) => {
  const { post, agent, claim } = await queueHarness(t);
  await post("/v1/snapshots", mutableSnapshot("event-1"));
  await claim();
  const empty = await post("/v1/panel/events", {});
  assert.equal(empty.status, 422);
  assert.equal(textOf(await readJson(empty), "error.code"), "INVALID_PANEL_EVENT");
  const refreshing = agent("ae_refresh_snapshot", { waitSeconds: 1 });
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal((await post("/v1/panel/events", {})).status, 422);
  const result = (await refreshing).body;
  assert.notEqual(result.data.status, "failed", "an event with no error information is not a host failure");
  assert.equal(result.error, undefined);
  assert.equal(fieldOf((await agent("ae_status")).body, "data.pipeline.lastError"), undefined);

  assert.equal((await post("/v1/panel/events", { code: "PANEL_EXCEPTION", message: "Panel raised /Users/test/private" })).status, 201);
  assert.deepEqual(fieldOf((await agent("ae_status")).body, "data.pipeline.lastError"), { code: "PANEL_EXCEPTION", message: "Panel raised [path]" });
});

test("a completed plan is handed to the panel once, in order, and only after the batch in flight settles", async (t) => {

  const step = (id: string, name: string, args: JsonObject) => ({ id, name, arguments: args });

  const provider = new MockProvider({ script: (input) => {
    const called = input.messages.filter((message) => message.role === "tool").map((message) => message.name);
    if (!called.includes("ae_select_workflow_stage")) return workflowStageStep("batches");
    if (!called.includes("ae_queue_add")) return { text: "", toolCalls: [step("c1", "ae_queue_add", { summary: "Two-step rename", operations: [{ type: "set_layer_name", target: { compositionId: "comp-1", layerId: "layer-1" }, name: "Hero" }] })] };
    if (!called.includes("ae_queue_finish")) return { text: "", toolCalls: [step("c2", "ae_queue_finish", {})] };
    return { text: "Sealed it. Say the word for the next part.", toolCalls: [] };
  } });
  const sidecar = sidecarFor({ port: 0, token, chatProvider: provider, quietAgentLog: true });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  const base = `http://${address.host}:${address.port}`;
  await fetch(`${base}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(mutableSnapshot("probe-batches")) });
  const response = await fetch(`${base}/v1/chat`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify({ requestId: "chat-batches", message: "rename this in two steps" }) });
  const body = await readJson(response);

  assert.equal(response.status, 200);
  assert.equal(maybeListOf(body, "plans")?.length, 1, JSON.stringify(body).slice(0, 300));

  const first = await readJson(await fetch(`${base}/v1/chat/plans/ready`, { headers: authorization }));
  assert.equal(listOf(first, "plans").length, 1, "the sealed plan is offered to the panel");
  assert.equal(fieldOf(first, "plans.0.planId"), fieldOf(body, "plans.0.planId"));
  assert.equal(fieldOf(first, "plans.0.operations"), 1);
  const second = await readJson(await fetch(`${base}/v1/chat/plans/ready`, { headers: authorization }));
  assert.equal(listOf(second, "plans").length, 0, "and never offered twice: the panel cannot acknowledge, so the handoff is one-shot");

  const quiet = new MockProvider({ answer: "Nothing to do." });
  const quietSidecar = sidecarFor({ port: 0, token, chatProvider: quiet, quietAgentLog: true });
  const quietAddress = await quietSidecar.start();
  t.after(() => quietSidecar.stop());
  const quietBase = `http://${quietAddress.host}:${quietAddress.port}`;
  await fetch(`${quietBase}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(mutableSnapshot("probe-quiet")) });
  await fetch(`${quietBase}/v1/chat`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify({ requestId: "chat-quiet", message: "hello" }) });
  const none = await readJson(await fetch(`${quietBase}/v1/chat/plans/ready`, { headers: authorization }));
  assert.equal(listOf(none, "plans").length, 0, "a turn that sealed nothing offers nothing, whatever the store holds");
});
