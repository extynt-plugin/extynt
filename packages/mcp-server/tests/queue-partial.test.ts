// Tests that ae_queue_add stages the independent operations of a call, reports the refused ones and their dependents by position, and completes on a corrected resend.
import test from "node:test";
import assert from "node:assert/strict";
import { array, decodeOrThrow, number, object, optional, string } from "@extynt/decode";
import type { Infer, JsonObject } from "@extynt/decode";
import { callTool } from "../src/index.js";
import { dependentPositions } from "../src/queue-partial.js";
import { stringAt } from "../src/json.js";
import { resultData, storedOperations } from "./support/json-results.js";
import { queueContext, queuedPlan } from "./support/queue-context.js";
import type { QueueContext } from "./support/queue-context.js";

const title = { compositionId: "comp-main", layerId: "layer-title" };
const marker = (layerId: string, time: number): JsonObject => ({ type: "add_marker", target: { compositionId: "comp-main", layerId }, time, comment: String(time) });
const created = (name: string, extra: JsonObject = {}): JsonObject => ({ type: "create_layer", target: { compositionId: "comp-main", layerId: `__new__:${name}` }, layerType: "shape", name, ...extra });

const reportShape = object({
  queued: number(), accepted: number(), fix: optional(array(object({ positions: array(number()) }))), resend: optional(array(number())),
  dependents: optional(array(number())), next: string(),
});
type Report = Infer<typeof reportShape>;

function send(context: QueueContext, operations: JsonObject[]): Report {
  const result = callTool("ae_queue_add", { operations }, context);
  assert.equal(result.ok, true, JSON.stringify(result));
  return decodeOrThrow(reportShape, resultData(result));
}

const queuedTypes = (context: QueueContext): ReadonlyArray<string | undefined> => storedOperations(queuedPlan(context)).map((operation) => stringAt(operation, "type"));

const mixedCall = (): JsonObject[] => [
  created("bar"),
  { type: "set_layer_name", target: title, name: "Renamed", bogus: true },
  marker("__new__:bar", 1),
  created("dot", { bogus: true }),
  marker("__new__:dot", 2),
  marker("layer-title", 3),
];

test("operations that validated and need nothing refused are staged; the refused ones come back with their positions", () => {
  const context = queueContext();
  const report = send(context, mixedCall());
  assert.equal(report.accepted, 3, "positions 0, 2 and 5 are independent of the refusals");
  assert.equal(report.queued, 3);
  assert.deepEqual((report.fix ?? []).flatMap((entry) => entry.positions), [1, 3], "the two refused operations, by call position");
  assert.equal(queuedTypes(context).length, 3, "the plan really holds the three staged operations");
});

test("an operation that references what a refused create would have made is held, not staged", () => {
  const context = queueContext();
  const report = send(context, mixedCall());
  assert.deepEqual(report.dependents, [4], "the marker on the refused layer follows from it");
  assert.deepEqual(report.resend, [1, 3, 4]);
  assert.ok(!JSON.stringify(storedOperations(queuedPlan(context))).includes("dot"), "nothing that names the refused layer is staged");
});

test("the answer names the positions to resend and says not to resend the rest", () => {
  const report = send(queueContext(), mixedCall());
  assert.match(report.next, /^3 of 6 operations staged \(3 in the queue\); 3 not\./);
  assert.match(report.next, /Resend ONLY positions 1, 3 \(and their dependents 4, which follow from them and were held back\), corrected/);
  assert.match(report.next, /do not resend the other 3: they are already queued/);
  assert.match(report.next, /would queue them twice/);
});

test("resending only the refused operations and their dependents completes the plan in a valid order", () => {
  const context = queueContext();
  send(context, mixedCall());
  const second = send(context, [{ type: "set_layer_name", target: title, name: "Renamed" }, created("dot"), marker("__new__:dot", 2)]);
  assert.deepEqual(second.fix ?? [], []);
  assert.equal(second.accepted, 3);
  assert.equal(second.queued, 6, "the queue now holds every operation of the original call exactly once");
  const types = queuedTypes(context);
  const parent = types.findIndex((type, index) => index >= 3 && type === "create_layer");
  const child = types.findIndex((type, index) => index > parent && type === "add_marker");
  assert.ok(parent >= 3 && child > parent, "the dependent marker is queued after its fixed parent");
  const sealed = callTool("ae_queue_finish", {}, context);
  assert.equal(sealed.ok, true, JSON.stringify(sealed));
});

test("when every operation depends on the refusal the old all-or-nothing answer stands", () => {
  const report = send(queueContext(), [created("dot", { bogus: true }), marker("__new__:dot", 2)]);
  assert.equal(report.accepted, 0);
  assert.equal(report.queued, 0);
  assert.match(report.next, /Nothing from that call was queued/);
  assert.match(report.next, /send the whole call again/);
});

test("dependentPositions follows a created id through a chain and holds writes on a layer whose parent is held", () => {
  const operations: JsonObject[] = [
    { type: "create_layer", target: { layerId: "__new__:a" } },
    { type: "create_layer", target: { layerId: "__new__:b" }, parent: "__new__:a" },
    { type: "add_marker", target: { layerId: "__new__:b" } },
    { type: "set_layer_parent", target: { layerId: "layer-title" }, parentLayerId: "layer-x" },
    { type: "set_layer_property", target: { layerId: "layer-title" } },
    { type: "add_marker", target: { layerId: "layer-other" } },
  ];
  assert.deepEqual([...dependentPositions(operations, new Set([0]))].sort(), [1, 2], "b names a, and the marker names b");
  assert.deepEqual([...dependentPositions(operations, new Set([3]))], [4], "a held reparent holds the writes on that layer, not an unrelated one");
});
