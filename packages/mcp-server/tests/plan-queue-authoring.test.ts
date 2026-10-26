// Proves the ae_queue_* authoring path: staging with checkpoints, per-call splitting and fault reports, duplicate recognition and sealing without handing out the plan id.
import test from "node:test";
import assert from "node:assert/strict";
import { array, boolean, decodeOrThrow, jsonValue, number, object, optional, string } from "@extynt/decode";
import type { Infer, JsonObject } from "@extynt/decode";
import { callTool, PLAN_UNDO_BATCH_SIZE, QUEUE_CHECKPOINT_SIZE } from "../src/index.js";
import { objectAt, stringAt } from "../src/json.js";
import { queueContext, queuedPlan } from "./support/queue-context.js";
import type { QueueContext } from "./support/queue-context.js";
import { payloadOf, storedOperations } from "./support/json-results.js";
import { succeeded } from "./support/plan-views.js";
import type { ToolOutcome } from "./support/plan-views.js";

type QueueTarget = { compositionId: string; layerId: string };

const POSITION = "ADBE Transform Group/ADBE Position";
const OPACITY = "ADBE Transform Group/ADBE Opacity";
const TITLE: QueueTarget = { compositionId: "comp-main", layerId: "layer-title" };

const fixShape = object({ position: number(), positions: optional(array(number())), code: optional(string()), message: optional(string()), instruction: optional(string()) });
const checkpointShape = object({ reviewed: number(), outstanding: array(object({ index: number(), code: string(), message: string(), instruction: string() })) });
const queueReportShape = object({
  queued: optional(number()), accepted: optional(number()), duplicate: optional(boolean()), next: optional(string()), planId: optional(string()),
  notes: optional(array(string())), fix: optional(array(fixShape)), notValidated: optional(object({ from: number(), to: number() })), checkpoint: optional(checkpointShape),
});
type QueueReport = Infer<typeof queueReportShape>;
type QueueFix = Infer<typeof fixShape>;
const finishShape = object({
  sealed: boolean(), operationCount: number(), queued: number(), undoGroups: number(), next: string(),
  planId: optional(jsonValue), plan: optional(jsonValue), presentation: optional(jsonValue), approvalCapability: optional(jsonValue),
});

function nextOf(report: QueueReport): string {
  return report.next ?? "";
}

function firstFix(report: QueueReport): QueueFix {
  const [fix] = report.fix ?? [];
  assert.ok(fix, "the report lists a fix");
  return fix;
}

function queueReportOf(result: ToolOutcome): QueueReport {
  return decodeOrThrow(queueReportShape, succeeded(result).data);
}

function addMarkers(target: QueueTarget, count: number, firstTime = 1): JsonObject[] {
  return Array.from({ length: count }, (_, index) => ({ type: "add_marker", target, time: index + firstTime, comment: String(index + firstTime) }));
}

function renameTitle(index: number): JsonObject {
  return { type: "set_layer_name", target: TITLE, name: `Title ${index}` };
}

function assertQueueOpensWithThreeOperations(context: QueueContext, target: QueueTarget): void {
  const first = queueReportOf(callTool("ae_queue_add", { operations: [
    { type: "create_layer", target, layerType: "shape", name: "Bar" },
    { type: "set_layer_property", target, role: "transform.position", propertyPath: POSITION, value: [960, 900] },
    { type: "ensure_shape_fill", target, groupId: "root", color: [0.1, 0.1, 0.12] },
  ] }, context));
  assert.equal(first.queued, 3);
  assert.equal(first.accepted, 3);
  assert.equal(first.planId, undefined, "the model is never handed the plan id it is filling");
  assert.notEqual(context.queue.planId, null, "the sidecar holds it instead");
  assert.match(first.next ?? "", /ae_queue_finish/);
}

function assertQueueCheckpointIsClean(context: QueueContext, filler: JsonObject[], held: number): void {
  const second = queueReportOf(callTool("ae_queue_add", { operations: filler }, context));
  assert.equal(second.queued, held);
  assert.ok(second.checkpoint, "a queue this long crosses at least one checkpoint");
  assert.equal(second.checkpoint.reviewed, Math.floor(held / QUEUE_CHECKPOINT_SIZE) * QUEUE_CHECKPOINT_SIZE, "the checkpoint lands on the interval, counted over the whole queue");
  assert.deepEqual(second.checkpoint.outstanding, [], "and re-reads the queue: nothing here is outstanding");
}

function assertRefusedOperationIsNotQueued(context: QueueContext, held: number): void {
  const fill = (groupId: string): JsonObject => ({ type: "ensure_shape_fill", target: { compositionId: "comp-main", layerId: "__new__:bar" }, groupId, color: [1, 0, 0] });
  const third = queueReportOf(callTool("ae_queue_add", { operations: [fill("nope")] }, context));
  assert.equal(third.queued, held, "nothing was queued from that call");
  assert.equal(third.accepted, 0);
  assert.equal(third.fix?.[0]?.position, 0);
  assert.equal(third.fix?.[0]?.code, "TARGET_NOT_FOUND");
  assert.ok(third.fix?.[0]?.instruction);
  assert.equal(queueReportOf(callTool("ae_queue_add", { operations: [fill("root")] }, context)).accepted, 1);
}

function assertQueueFinishSealsWithoutPlanId(context: QueueContext, held: number): void {
  const finish = decodeOrThrow(finishShape, succeeded(callTool("ae_queue_finish", {}, context)).data);
  assert.equal(finish.sealed, true);
  assert.equal(finish.operationCount, held + 1, "everything queued, including the operation that was refused and then corrected");
  assert.equal(finish.queued, 0);
  assert.equal(finish.undoGroups, Math.ceil((held + 1) / PLAN_UNDO_BATCH_SIZE), "and the undo story is the batch count the panel will apply");
  assert.equal(finish.planId, undefined, "the seal hands back no plan id either");
  assert.equal(finish.plan, undefined, "and not the composed plan, which is addressed by one");
  assert.equal(finish.presentation, undefined, "nor the panel's card material");
  assert.equal(finish.approvalCapability, undefined, "nor the approval capability");
  assert.equal(context.queue.planId, null, "the sidecar still holds the id, and the queue is closed");
  assert.equal(context.plans.size, 1, "the sealed plan is in the store, addressable by the sidecar");
  assert.match(finish.next, /applies it in order/);
  const empty = payloadOf(callTool("ae_queue_finish", {}, context));
  assert.doesNotMatch(stringAt(empty, "next") ?? "", /ae_plan_(add|complete)|ae_amend_plan|ae_recall_plan/, "the answer names only tools the queue's caller has");
}

test("the queue takes operations as they are known, checkpoints, and seals on finish", () => {
  const context = queueContext();
  const target = { compositionId: "comp-main", layerId: "__new__:bar" };
  assertQueueOpensWithThreeOperations(context, target);
  const opener = 3;
  const fillerCount = Math.max(QUEUE_CHECKPOINT_SIZE - opener, PLAN_UNDO_BATCH_SIZE - opener + 1);
  const held = opener + fillerCount;
  assertQueueCheckpointIsClean(context, addMarkers(target, fillerCount), held);
  assertRefusedOperationIsNotQueued(context, held);
  assertQueueFinishSealsWithoutPlanId(context, held);
});

function assertParentingIsAccepted(context: QueueContext, ring: QueueTarget, parent: QueueTarget): void {
  const opened = queueReportOf(callTool("ae_queue_add", { operations: [
    { type: "create_layer", target: ring, layerType: "shape", name: "Ring" },
    { type: "set_layer_property", target: ring, role: "transform.opacity", propertyPath: OPACITY, value: 50 },
    { type: "create_layer", target: parent, layerType: "null", name: "Ring Pivot" },
    { type: "animate_property", target: { ...ring, propertyPath: OPACITY }, role: "transform.opacity", keyframes: [{ time: 0, value: 0 }, { time: 1, value: 100 }] },
  ] }, context));
  assert.equal(opened.accepted, 4, "the keyed write is accepted while authoring");
  assert.ok((opened.notes ?? []).some((note) => /STATIC_WRITE_UNDER_KEYFRAMES|can never verify|keys the same property/i.test(note)), `the interaction is noted when it appears: ${JSON.stringify(opened.notes)}`);
}

function assertCheckpointFindsLaterFault(context: QueueContext, ring: QueueTarget): void {
  const crossed = queueReportOf(callTool("ae_queue_add", { operations: addMarkers(ring, QUEUE_CHECKPOINT_SIZE - 4) }, context));
  assert.equal(crossed.checkpoint?.reviewed, QUEUE_CHECKPOINT_SIZE);
  const outstanding = crossed.checkpoint?.outstanding ?? [];
  assert.equal(outstanding.length, 1, JSON.stringify(outstanding));
  assert.equal(outstanding[0]?.index, 1, "by queue index, which is what ae_queue_fix takes");
  assert.equal(outstanding[0]?.code, "STATIC_WRITE_UNDER_KEYFRAMES");
  assert.ok(outstanding[0]?.instruction, "and with the fix, not just the fault");
}

test("a checkpoint reports what a later operation made wrong, by queue index", () => {
  const context = queueContext();
  const ring = { compositionId: "comp-main", layerId: "__new__:ring" };
  assertParentingIsAccepted(context, ring, { compositionId: "comp-main", layerId: "__new__:pivot" });
  assertCheckpointFindsLaterFault(context, ring);
});

test("a name nothing declares is reported as that, not blamed on the next operation that mentions it", () => {
  const context = queueContext();
  const count = { compositionId: "comp-main", layerId: "__new__:count" };
  const refused = queueReportOf(callTool("ae_queue_add", { operations: addMarkers(count, 2, 0) }, context));
  const fix = refused.fix ?? [];
  assert.equal(fix.length, 2);
  for (const entry of fix) {
    assert.match(entry.message ?? "", /which no operation in this plan creates/);
    assert.doesNotMatch(entry.message ?? "", /which operation \d+ creates/);
  }
});

const RING: QueueTarget = { compositionId: "comp-main", layerId: "__new__:ring" };

function ringOperations(): JsonObject[] {
  return [
    { type: "create_layer", target: RING, layerType: "shape", name: "Ring" },
    { type: "set_layer_property", target: RING, role: "transform.position", propertyPath: POSITION, value: [960, 540] },
  ];
}

test("a group whose result never came back is safe to send again, unchanged", () => {
  const context = queueContext();
  const first = queueReportOf(callTool("ae_queue_add", { operations: ringOperations() }, context));
  assert.equal(first.accepted, 2);
  assert.equal(first.duplicate, undefined, "the first call is not a duplicate of anything");

  const reordered = [
    { name: "Ring", layerType: "shape", target: { layerId: "__new__:ring", compositionId: "comp-main" }, type: "create_layer" },
    { value: [960, 540], propertyPath: POSITION, role: "transform.position", type: "set_layer_property", target: RING },
  ];
  const repeat = queueReportOf(callTool("ae_queue_add", { operations: reordered }, context));
  assert.equal(repeat.duplicate, true, "recognised as the same call");
  assert.equal(repeat.queued, 2, "and queued once");

  const different = queueReportOf(callTool("ae_queue_add", { operations: [{ type: "set_layer_name", target: RING, name: "Countdown Ring" }] }, context));
  assert.equal(different.duplicate, undefined);
  assert.equal(different.queued, 3);

  const rename: JsonObject = { type: "set_layer_name", target: RING, name: "Ring" };
  assert.equal(queueReportOf(callTool("ae_queue_add", { operations: [rename, rename] }, context)).accepted, 2);
});

test("an operation that omits compositionId means the active composition, which is what the caller was told", () => {
  const context = queueContext();
  const bar = { layerId: "__new__:bar" };
  const data = queueReportOf(callTool("ae_queue_add", { operations: [
    { type: "create_layer", target: bar, layerType: "shape", name: "Bar" },
    { type: "set_layer_property", target: bar, role: "transform.position", propertyPath: POSITION, value: [960, 900] },
  ] }, context));
  assert.equal(data.accepted, 2, "the omission is resolved, not refused");
  assert.equal(data.fix, undefined);
  const operations = storedOperations(queuedPlan(context));
  assert.equal(context.snapshot?.activeCompositionId, "comp-main", "the fixture has an active composition to mean");
  assert.equal(stringAt(objectAt(operations[0], "target"), "compositionId"), "comp-main");
  assert.equal(stringAt(objectAt(operations[1], "target"), "compositionId"), "comp-main");
});

test("a call larger than one undo batch is split internally and queues every operation", () => {
  const context = queueContext();
  const ticks = { compositionId: "comp-main", layerId: "__new__:ticks" };
  const oversized = [{ type: "create_layer", target: ticks, layerType: "shape", name: "Ticks" }, ...addMarkers(ticks, 30)];
  assert.ok(oversized.length > PLAN_UNDO_BATCH_SIZE, "the fixture must exceed one undo batch");
  const queued = queueReportOf(callTool("ae_queue_add", { operations: oversized }, context));
  assert.equal(queued.accepted, oversized.length, "every operation in the oversized call is queued");
  assert.equal(queued.queued, oversized.length);
});

test("a call with one refused operation keeps its independent operations and owes only the refused one", () => {
  const context = queueContext();
  const good = Array.from({ length: PLAN_UNDO_BATCH_SIZE }, (_, index) => renameTitle(index));
  const bad: JsonObject = { type: "ensure_shape_fill", target: TITLE, groupId: "nope", color: [1, 0, 0] };
  const report = queueReportOf(callTool("ae_queue_add", { operations: [...good, bad] }, context));
  assert.equal(report.accepted, good.length, "every operation that validated is staged; only the refused one is owed");
  assert.equal(report.queued, good.length);
  assert.equal(storedOperations(queuedPlan(context)).length, good.length, "the plan holds the staged operations");
  assert.equal(report.fix?.[0]?.position, PLAN_UNDO_BATCH_SIZE, "the position is in the caller's own indexing, not the chunk's");
  assert.deepEqual(report.fix?.[0]?.positions, [PLAN_UNDO_BATCH_SIZE], "and it is the only position this fault covers");
  assert.equal(report.notValidated, undefined, "the refused operation was the call's last, so nothing after it was left unvalidated");
  assert.match(report.next ?? "", new RegExp(`${good.length} of ${good.length + 1} operations staged`));
  assert.match(report.next ?? "", new RegExp(`Resend ONLY position ${PLAN_UNDO_BATCH_SIZE}, corrected`));
  assert.match(report.next ?? "", /do not resend the other/);
});

function capturedCountdownOperations(target: QueueTarget): JsonObject[] {
  const effectPath = "ADBE Effect Parade/ADBE Gaussian Blur 2";
  const marker = (time: number): JsonObject => ({ type: "add_marker", target: TITLE, time, comment: String(time) });
  const blurControl = (index: number): JsonObject => ({ type: "set_effect_control", effectMatchName: "ADBE Gaussian Blur 2", value: index + 1, target: { ...target, effectPath, propertyPath: `${effectPath}/ADBE Gaussian Blur 2-0001` } });
  return [
    ...Array.from({ length: 5 }, (_, index) => marker(index)),
    { type: "create_layer", target, layerType: "shape", name: "Ring" },
    { type: "ensure_effect", capabilityId: "adobe.gaussian-blur", effectMatchName: "ADBE Gaussian Blur 2", effectPath, enabled: "yes", target },
    ...Array.from({ length: 30 }, (_, index) => blurControl(index)),
    ...Array.from({ length: 49 }, (_, index) => marker(index + 37)),
  ];
}

test("a call that fails inside its first chunk reports what was validated and what was never looked at", () => {
  const context = queueContext();
  const operations = capturedCountdownOperations(RING);
  assert.equal(operations.length, 86, "the fixture is the captured call's size: far past one staging chunk");
  const report = queueReportOf(callTool("ae_queue_add", { operations }, context));
  assert.equal(report.accepted, 55, "the markers and the layer are independent of the impossible effect, so they are staged");
  assert.equal(report.queued, 55);
  assert.equal(report.fix?.length, 1, "one fault, not one entry per operation that referenced it");
  const fix = firstFix(report);
  assert.equal(fix.position, 6);
  assert.equal(fix.code, "INVALID_OPERATION");
  assert.deepEqual(fix.positions, [6]);
  assert.equal(report.notValidated, undefined, "every chunk was validated, so nothing is left unlooked-at");
  assert.match(nextOf(report), /55 of 86 operations staged/);
  assert.match(nextOf(report), /Resend ONLY position 6 \(and their dependents 7–36, which follow from it/, "the controls past the failed chunk are held back too, and named");
  assert.ok(JSON.stringify(report.fix).length < 1500, `the fix list fits in context: ${JSON.stringify(report.fix).length} characters`);
});

test("one fault repeated across a call is one entry naming every position", () => {
  const context = queueContext();
  const target = { compositionId: "comp-main", layerId: "__new__:bg" };
  const faulty = [2, 5, 8, 11, 14, 17, 20, 23, 40];
  const operations: JsonObject[] = [
    { type: "create_layer", target, layerType: "shape", name: "BG" },
    ...Array.from({ length: 98 }, (_, index): JsonObject => (faulty.includes(index + 1)
      ? { type: "create_shape_group", target, newGroupId: `__new__:g${index + 1}`, name: `G${index + 1}`, fill: "red" }
      : { type: "add_marker", target, time: index + 1, comment: String(index + 1) })),
  ];
  const report = queueReportOf(callTool("ae_queue_add", { operations }, context));
  assert.equal(report.fix?.length, 1, "eight copies of one sentence are one fault");
  const fix = firstFix(report);
  assert.equal(fix.code, "UNKNOWN_FIELD");
  assert.deepEqual(fix.positions, faulty, "every position it covers is listed, the ninth included: the rest of the call is validated too");
  assert.match(fix.message ?? "", /Unknown field: fill/);
  assert.equal(report.notValidated, undefined);
  assert.match(nextOf(report), /90 of 99 operations staged/);
  assert.match(nextOf(report), /Resend ONLY positions 2, 5, 8, 11, 14, 17, 20, 23, 40,/);
});

test("a refused multi-chunk call keeps its prefix, and resending the whole call is recognised rather than queued twice", () => {
  const context = queueContext();
  const call = Array.from({ length: 65 }, (_, index) => (index === 30 ? { ...renameTitle(index), bogus: true } : renameTitle(index)));
  const report = queueReportOf(callTool("ae_queue_add", { operations: call }, context));
  assert.equal(report.accepted, 64, "everything but the refused operation is staged");
  assert.equal(report.queued, 64);
  assert.equal(report.duplicate, undefined);
  assert.match(report.next ?? "", /Resend ONLY position 30/);
  const repeated = queueReportOf(callTool("ae_queue_add", { operations: call }, context));
  assert.equal(repeated.duplicate, true, "the whole call sent again is recognised");
  assert.equal(repeated.queued, 64, "and does not queue the staged part a second time");
  assert.match(repeated.next ?? "", /Resend ONLY position 30/, "and the answer repeats what is still owed");
});

test("queueing an effect at a path the layer already holds says it reuses that effect and names the path that would add a new one", () => {
  const context = queueContext();
  const ensure = (effectPath: string): JsonObject => ({ type: "ensure_effect", target: { ...TITLE, effectPath }, capabilityId: "adobe.gaussian-blur", effectMatchName: "ADBE Gaussian Blur 2", effectPath });
  const reused = queueReportOf(callTool("ae_queue_add", { operations: [ensure("ADBE Effect Parade/ADBE Gaussian Blur 2")] }, context));
  const notes = reused.notes ?? [];
  assert.ok(notes.some((note) => note.includes("reuses") && note.includes("ADBE Effect Parade/ADBE Gaussian Blur 2#2")), `the note names the second-instance path: ${JSON.stringify(notes)}`);
  const added = queueReportOf(callTool("ae_queue_add", { operations: [ensure("ADBE Effect Parade/ADBE Gaussian Blur 2#2")] }, context));
  assert.equal((added.notes ?? []).some((note) => note.includes("reuses")), false, "a new instance's path is not a reuse");
});
