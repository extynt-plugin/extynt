// Tests that when Layer Styles are unavailable the queue, plan and amend tools turn a drop shadow or glow into the equivalent effect and refuse the rest with the replacement operation.
import test from "node:test";
import assert from "node:assert/strict";
import { array, decodeOrThrow, number, object, optional, string } from "@extynt/decode";
import { callTool } from "../src/index.js";
import { objectAt, stringAt } from "../src/json.js";
import type { JsonObject } from "@extynt/decode";
import { payloadOf, refusalOf, resultData, storedOperations } from "./support/json-results.js";
import { queueContext, queuedPlan } from "./support/queue-context.js";
import type { QueueContext } from "./support/queue-context.js";

const TARGET = { compositionId: "comp-main", layerId: "layer-title" };
const style = (name: string, extra: JsonObject = {}): JsonObject => ({ type: "ensure_layer_style", target: TARGET, style: name, ...extra });
const rename: JsonObject = { type: "set_layer_name", target: TARGET, name: "Title 2" };
const UNAVAILABLE = { layerStyles: "unavailable", requestAsksLayerStyle: false } as const;

const correctedView = object({ accepted: optional(number()), corrected: number(), notes: optional(array(string())), planId: optional(string()) });
const entriesView = object({ entries: array(object({ planType: optional(string()) })) });
const noteView = object({ note: optional(string()) });

const queuedOperation = (context: QueueContext): JsonObject | undefined => storedOperations(queuedPlan(context))[0];

function storedTypes(context: QueueContext, planId: string): ReadonlyArray<string | undefined> {
  return storedOperations(context.plans.get(planId)).map((operation) => stringAt(operation, "type"));
}

test("unavailable commands: a drop shadow the user did not ask for by style is queued as ADBE Drop Shadow and reported as corrected", () => {
  const context = queueContext(UNAVAILABLE);
  const result = callTool("ae_queue_add", { operations: [style("drop-shadow")] }, context);
  assert.equal(result.ok, true, JSON.stringify(result));
  const data = decodeOrThrow(correctedView, payloadOf(result));
  assert.equal(data.accepted, 1);
  assert.equal(data.corrected, 1);
  assert.match(data.notes?.[0] ?? "", /Corrected position 0.*ensure_effect ADBE Drop Shadow/);
  const queued = queuedOperation(context);
  assert.equal(stringAt(queued, "type"), "ensure_effect");
  assert.equal(stringAt(queued, "effectMatchName"), "ADBE Drop Shadow");
  assert.equal(stringAt(objectAt(queued, "target"), "effectPath"), "ADBE Effect Parade/ADBE Drop Shadow");
});

test("unavailable commands: an outer glow becomes ADBE Glo2", () => {
  const context = queueContext(UNAVAILABLE);
  const result = callTool("ae_queue_add", { operations: [style("outer-glow")] }, context);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(stringAt(queuedOperation(context), "effectMatchName"), "ADBE Glo2");
});

test("unavailable commands: when the request may have named Layer Styles the call is refused with the exact replacement op, and nothing is queued", () => {
  for (const extra of [{ requestAsksLayerStyle: true }, {}]) {
    const context = queueContext({ layerStyles: "unavailable", ...extra });
    const error = refusalOf(callTool("ae_queue_add", { operations: [rename, style("drop-shadow")] }, context));
    assert.equal(error.code, "LAYER_STYLES_UNSUPPORTED");
    assert.match(error.message, /Position 1/);
    assert.match(error.message, /"type":"ensure_effect".*"effectMatchName":"ADBE Drop Shadow"/);
    assert.equal(context.plans.size, 0, "the refused call opened no queue");
  }
});

test("unavailable commands: other styles, a style with values, and a style turned off are refused", () => {
  const context = queueContext(UNAVAILABLE);
  assert.match(refusalOf(callTool("ae_queue_add", { operations: [style("stroke")] }, context)).message, /ADBE Stroke or ADBE Fill/);
  const valued = callTool("ae_queue_add", { operations: [style("drop-shadow", { values: { "dropShadow/opacity": 50 } })] }, context);
  assert.match(refusalOf(valued).message, /set_effect_control/);
  assert.equal(callTool("ae_queue_add", { operations: [style("outer-glow", { enabled: false })] }, context).ok, false);
});

test("available or unknown commands: ensure_layer_style is queued as written", () => {
  for (const extra of [{ layerStyles: "available" }, { layerStyles: "unknown" }, {}] as const) {
    const context = queueContext({ ...extra, requestAsksLayerStyle: false });
    const result = callTool("ae_queue_add", { operations: [style("drop-shadow")] }, context);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(stringAt(queuedOperation(context), "type"), "ensure_layer_style");
  }
});

test("unavailable commands: the search leaves Layer Styles out and the description says they are unavailable", () => {
  const context = queueContext({ layerStyles: "unavailable" });
  const found = decodeOrThrow(entriesView, payloadOf(callTool("ae_search_native_operations", { query: "layer style drop shadow glow stroke bevel" }, context)));
  assert.ok(!found.entries.some((entry) => entry.planType === "ensure_layer_style"));
  const described = decodeOrThrow(noteView, payloadOf(callTool("ae_describe_native_operation", { id: "ensure_layer_style" }, context)));
  assert.match(described.note ?? "", /^UNAVAILABLE in this After Effects session/);
  const live = decodeOrThrow(noteView, payloadOf(callTool("ae_describe_native_operation", { id: "ensure_layer_style" }, queueContext({ layerStyles: "available" }))));
  assert.equal(live.note, undefined);
});

test("unavailable commands, ae_queue_fix: a replace of a drop shadow becomes the effect, and a refused edit changes nothing", () => {
  const context = queueContext(UNAVAILABLE);
  assert.equal(callTool("ae_queue_add", { operations: [rename, rename] }, context).ok, true);
  const planId = queuedPlan(context).plan.planId;
  const fixed = callTool("ae_queue_fix", { edits: [{ op: "replace", index: 1, operation: style("drop-shadow") }, { op: "remove", index: 0 }] }, context);
  assert.equal(fixed.ok, true, JSON.stringify(fixed));
  assert.deepEqual(storedTypes(context, planId), ["ensure_effect"]);
  const refused = callTool("ae_queue_fix", { edits: [{ op: "insert", index: 0, operation: style("stroke") }] }, context);
  assert.equal(refusalOf(refused).code, "LAYER_STYLES_UNSUPPORTED");
  assert.deepEqual(storedTypes(context, planId), ["ensure_effect"]);
});

test("unavailable commands, ae_plan_add: the batch is converted and reported, and another style is refused", () => {
  const context = queueContext(UNAVAILABLE);
  const planId = stringAt(payloadOf(callTool("ae_plan_create", { summary: "Shadow" }, context)), "planId");
  assert.ok(planId);
  const added = callTool("ae_plan_add", { planId, operations: [style("outer-glow")] }, context);
  assert.equal(added.ok, true, JSON.stringify(added));
  const data = decodeOrThrow(correctedView, payloadOf(added));
  assert.equal(data.corrected, 1);
  assert.match(data.notes?.[0] ?? "", /ensure_effect ADBE Glo2/);
  assert.deepEqual(storedTypes(context, planId), ["ensure_effect"]);
  assert.equal(refusalOf(callTool("ae_plan_add", { planId, operations: [style("stroke")] }, context)).code, "LAYER_STYLES_UNSUPPORTED");
});

test("unavailable commands, ae_propose_plan: the plan holds the effect, and a request that named Layer Styles is refused with the replacement", () => {
  const context = queueContext(UNAVAILABLE);
  const proposed = callTool("ae_propose_plan", { summary: "Shadow the title", operations: [style("drop-shadow")] }, context);
  assert.equal(proposed.ok, true, JSON.stringify(proposed));
  const data = decodeOrThrow(correctedView, payloadOf(proposed));
  assert.equal(data.corrected, 1);
  assert.deepEqual(storedTypes(context, data.planId ?? ""), ["ensure_effect"]);
  const asked = callTool("ae_propose_plan", { summary: "Shadow the title", operations: [style("drop-shadow")] }, queueContext({ layerStyles: "unavailable", requestAsksLayerStyle: true }));
  assert.match(refusalOf(asked).message, /"effectMatchName":"ADBE Drop Shadow"/);
});

test("unavailable commands, ae_amend_plan: an edit that writes a Layer Style is settled like the queue's", () => {
  const context = queueContext(UNAVAILABLE);
  const proposed = callTool("ae_propose_plan", { summary: "Rename", operations: [rename] }, context);
  assert.equal(proposed.ok, true);
  const planId = stringAt(resultData(proposed), "planId");
  assert.ok(planId);
  const amended = callTool("ae_amend_plan", { planId, edits: [{ op: "replace", index: 0, operation: style("drop-shadow") }] }, context);
  assert.equal(amended.ok, true, JSON.stringify(amended));
  assert.deepEqual(storedTypes(context, planId), ["ensure_effect"]);
});
