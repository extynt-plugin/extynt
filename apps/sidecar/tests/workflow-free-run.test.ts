/** Free run: a block the model can fix is told to it and the job keeps going; a block it cannot fix still stands. */
import assert from "node:assert/strict";
import test from "node:test";
import { required } from "./workflow-cycle-fixtures.js";
import { readJson, textOf } from "./http-json.js";
import type { WorkflowBatch, WorkflowOperationOutcome } from "@extynt/workflow";
import { unrepairedMessage } from "../src/server-workflow-cycle-batches.js";
import { unresolvedFailures } from "../src/server-workflow-film-gate.js";
import { batchFixture } from "./sidecar-fixture.js";
import { post, rigFor, rigWith, step, toolCalls } from "./single-loop-rig.js";
import { comp, layer } from "./workflow-film-fixtures.js";

const TIMING = { type: "set_layer_timing", target: { compositionId: "comp-1", layerId: "layer-1" }, inPoint: 0, outPoint: 2 };
const STOPPED = "Your cycle ended in prose, so the job is still open";

test("free run: a cycle that ended in prose does not block the job: the next cycle is told why and completes", async (t) => {
  let told = false;
  const rig = await rigWith(t, (input) => {
    told ||= input.messages.some((message) => message.role === "user" && message.content.includes(STOPPED));
    const called = toolCalls(input);
    const adds = called.filter((name) => name === "ae_queue_add").length;
    const finishes = called.filter((name) => name === "ae_queue_finish").length;
    if (told) return called.includes("ae_workflow_complete") ? { text: "Trimmed the title to two seconds.", toolCalls: [] } : step("f-complete", "ae_workflow_complete", {});
    if (adds > finishes) return step("f-finish", "ae_queue_finish", {});
    return adds === 0 ? step("f-add", "ae_queue_add", { summary: "Trim the title", operations: [TIMING] }) : { text: "Trimmed the title.", toolCalls: [] };
  }, "free-run-prose", [["set_layer_timing"], ["set_layer_timing"]], { workflowFreeRun: true });
  const reply = await readJson(await post(rig.base, "/v1/chat", { requestId: "free-run-turn", message: "trim the title to two seconds", history: [], autoApply: true }));
  const jobs = () => Object.values(rig.sidecar.workflowCoordinator.workflowStore.getState().jobs);
  for (let attempt = 0; attempt < 80 && jobs()[0]?.status === "active"; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 25));
  assert.deepEqual(jobs().map((job) => job.status), ["completed"], JSON.stringify(reply));
  assert.equal(told, true, "the next cycle was told its prose ending did not finish the job");
});

test("free run off (the direct default): the same block stands and the job stays blocked", async (t) => {
  const rig = await rigFor(t, (input) => {
    const called = toolCalls(input);
    const adds = called.filter((name) => name === "ae_queue_add").length;
    const finishes = called.filter((name) => name === "ae_queue_finish").length;
    if (adds === 2 && finishes === 2) return { text: "I could not get the timing to stick.", toolCalls: [] };
    return adds > finishes ? step(`o-finish-${adds}`, "ae_queue_finish", {}) : step(`o-add-${adds}`, "ae_queue_add", { summary: "Trim the title", operations: [TIMING] });
  }, "free-run-off", [["set_layer_timing"], ["set_layer_timing"]]);
  rig.mismatch = 2;
  const reply = await readJson(await post(rig.base, "/v1/chat", { requestId: "free-run-off-turn", message: "trim the title to two seconds", history: [], autoApply: true }));
  assert.equal(textOf(reply, "failure.code"), "WORKFLOW_BATCH_BLOCKED", JSON.stringify(reply));
  assert.deepEqual(Object.values(rig.sidecar.workflowCoordinator.workflowStore.getState().jobs).map((job) => job.status), ["blocked"]);
});

const MARKER = { type: "add_marker", target: { compositionId: "comp-1", layerId: "layer-1" }, time: 1, comment: "beat" };

test("free run: newer verified batches do not re-block on an unrepaired read-back mismatch, and it stays listed", async (t) => {
  const rig = await rigWith(t, (input) => {
    const called = toolCalls(input);
    const adds = called.filter((name) => name === "ae_queue_add").length;
    const finishes = called.filter((name) => name === "ae_queue_finish").length;
    if (adds > finishes) return step(`m-finish-${adds}`, "ae_queue_finish", {});
    if (adds === 0) return step("m-add-0", "ae_queue_add", { summary: "Trim the title", operations: [TIMING] });
    if (adds < 3) return step(`m-add-${adds}`, "ae_queue_add", { summary: `Mark beat ${adds}`, operations: [{ ...MARKER, time: adds }] });
    return { text: "Marked the beats.", toolCalls: [] };
  }, "free-run-mismatch", [["set_layer_timing"], ["add_marker"], ["add_marker"]], { workflowFreeRun: true });
  rig.mismatch = 1;
  const reply = await readJson(await post(rig.base, "/v1/chat", { requestId: "free-run-mismatch-turn", message: "trim the title and mark beats", history: [], autoApply: true }));
  const store = rig.sidecar.workflowCoordinator.workflowStore;
  const jobs = () => Object.values(store.getState().jobs);
  for (let attempt = 0; attempt < 120 && rig.applied.length < 3; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(JSON.stringify(reply).includes("WORKFLOW_BATCH_BLOCKED"), false, "the model's newer verified batches did not re-block the job");
  assert.equal(rig.applied.length >= 3, true, `newer verified batches were applied, not re-blocked: ${rig.applied.length}`);
  assert.notEqual(jobs()[0]?.status, "blocked", "the job is not left blocked on the old mismatch");
  const jobId = jobs()[0]?.jobId;
  assert.ok(jobId);
  const flat = comp("comp-1", "Main", 10, [layer("layer-1", "Title", { inPoint: 0, outPoint: 0 })]);
  assert.equal(unresolvedFailures(store.getState(), jobId, { compositions: [flat] }).some((failure) => failure.type === "set_layer_timing"), true, "the mismatch is still listed as unresolved at completion");
});

test("the block on an unrepaired mismatch names the batch, the operations and the repair call", async () => {
  const base = batchFixture("settled");
  const outcome = (type: string, kind: "readback_mismatch" | "confirmed", readback?: { targetLayerId: string }): WorkflowOperationOutcome => ({ operationId: type, ordinal: 0, type, outcome: kind, mutation: "applied", verification: kind === "confirmed" ? "verified" : "failed", mayHaveMutated: true, ...(readback ? { readback } : {}) });
  const receipt = { ...required(base.execution.receipt), outcomes: [outcome("set_layer_timing", "readback_mismatch", { targetLayerId: "layer-3" }), outcome("add_marker", "confirmed")] };
  const batch: WorkflowBatch = { ...base, batchId: "batch-7", execution: { ...base.execution, receipt } };
  const message = unrepairedMessage(batch);
  assert.match(message, /batch-7/);
  assert.match(message, /set_layer_timing on layer layer-3/);
  assert.doesNotMatch(message, /add_marker/);
  assert.match(message, /ae_queue_add and ae_queue_finish/);
  assert.match(message, /no repair was queued/);
});
