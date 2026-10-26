// Tests for compose normalise.
import test from "node:test";
import assert from "node:assert/strict";
import { resultData, storedOperations } from "./support/json-results.js";
import { callTool } from "../src/index.js";
import { arrayAt, asObject, numberAt, objectAt, objectsIn, stringAt, stringsIn } from "../src/json.js";
import type { JsonObject, JsonValue } from "@extynt/decode";
import { queueContext } from "./support/queue-context.js";


const TITLE = { compositionId: "comp-main", layerId: "layer-title" };
interface Queued {
  ok: boolean;
  text: string;
  notes: ReadonlyArray<string>;
  stored: ReadonlyArray<JsonObject>;
}

function queue(operations: JsonValue[]): Queued {
  const context = queueContext();
  const result = callTool("ae_queue_add", { operations }, context);
  const record = context.queue.planId ? context.plans.get(context.queue.planId) : undefined;
  const data = resultData(result);
  return { ok: result.ok && numberAt(data, "accepted") === operations.length, text: JSON.stringify(result), notes: stringsIn(arrayAt(data, "notes")), stored: storedOperations(record) };
}

const createNull = (extra: JsonObject, target: JsonObject = { layerId: "__new__:title_null" }) => ({ type: "create_layer", layerType: "null", name: "Title Null", target, ...extra });

test("create_layer with a top-level layerId identical to target.layerId is accepted and the copy is dropped", () => {
  const result = queue([createNull({ layerId: "__new__:title_null" })]);
  assert.equal(result.ok, true, result.text);
  assert.equal(result.stored[0]?.layerId, undefined);
  assert.match(stringAt(objectAt(result.stored[0], "target"), "layerId") ?? "", /^__new__:/);
  assert.equal(result.notes.length, 1, "one line in the answer, nothing more");
});

test("create_layer with a top-level layerId that differs from target.layerId is still refused", () => {
  const result = queue([createNull({ layerId: "__new__:other" })]);
  assert.equal(result.ok, false);
  assert.match(result.text, /Unknown field: layerId/);
});

test("a top-level layerId with no layerId in target moves into target where the type takes it there", () => {
  const result = queue([{ type: "set_layer_name", target: { compositionId: "comp-main" }, layerId: "layer-title", name: "Renamed" }]);
  assert.equal(result.ok, true, result.text);
  assert.equal(stringAt(objectAt(result.stored[0], "target"), "layerId"), "layer-title");
});

test("set_text_document with its fields wrapped in document is flattened", () => {
  const result = queue([{ type: "set_text_document", target: TITLE, document: { text: "Hello", fontSize: 72 } }]);
  assert.equal(result.ok, true, result.text);
  assert.deepEqual([result.stored[0]?.text, result.stored[0]?.fontSize, result.stored[0]?.document], ["Hello", 72, undefined]);
});

test("a wrapper is flattened on any operation type whose fields it holds, whatever it is called", () => {
  const result = queue([{ type: "set_layer_name", target: TITLE, settings: { name: "Flat" } }]);
  assert.equal(result.ok, true, result.text);
  assert.deepEqual([result.stored[0]?.name, result.stored[0]?.settings], ["Flat", undefined]);
});

test("a wrapper holding a field the operation does not take is still refused", () => {
  const result = queue([{ type: "set_text_document", target: TITLE, document: { text: "Hello", colour: "red" } }]);
  assert.equal(result.ok, false);
  assert.match(result.text, /Unknown field: document/);
});

test("a wrapper whose key is also present at the top level is still refused", () => {
  const result = queue([{ type: "set_text_document", target: TITLE, text: "Top", document: { text: "Inner" } }]);
  assert.equal(result.ok, false);
  assert.match(result.text, /Unknown field: document/);
});

test("a wrapper that carries the operation's type up is still refused", () => {
  const result = queue([{ type: "set_text_document", target: TITLE, document: { type: "set_layer_name", text: "x" } }]);
  assert.equal(result.ok, false);
});

test("a field the operation accepts is never treated as a wrapper", () => {
  const result = queue([{ type: "set_text_document", target: TITLE, characterRanges: [{ start: 0, end: 2, fontSize: 40 }] }]);
  assert.equal(result.stored[0]?.fontSize, undefined, "characterRanges is not flattened");
});

test("ae_plan_add normalises the same way and stores the normalised operations", () => {
  const context = queueContext();
  const created = callTool("ae_plan_create", { summary: "Normalise" }, context);
  assert.equal(created.ok, true); if (!created.ok) return;
  const planId = stringAt(resultData(created), "planId") ?? "";
  const added = callTool("ae_plan_add", { planId, operations: [{ type: "set_text_document", target: TITLE, document: { text: "Hi" } }, createNull({ layerId: "__new__:title_null" })] }, context);
  assert.equal(added.ok, true, JSON.stringify(added));
  const stored = storedOperations(context.plans.get(planId));
  assert.deepEqual([stored[0]?.text, stored[0]?.document, stored[1]?.layerId], ["Hi", undefined, undefined]);
});

test("ae_propose_plan normalises the same way, so the proposed plan carries the flat operation", () => {
  const proposed = callTool("ae_propose_plan", { summary: "Normalise", operations: [{ type: "set_text_document", target: TITLE, document: { text: "Hi" } }] }, queueContext());
  assert.equal(proposed.ok, true, JSON.stringify(proposed));
  const plan = objectAt(resultData(proposed), "plan");
  const first = asObject(arrayAt(plan, "operations")?.[0]);
  assert.equal(stringAt(first, "text"), "Hi");
  assert.equal(first?.document, undefined);
});

const SCALE = "ADBE Transform Group/ADBE Scale";
const POSITION = "ADBE Transform Group/ADBE Position";
const NEW_TITLE = { layerId: "__new__:title" };

test("a text create_layer without text takes it from the same call's set_text_document on that target", () => {
  const result = queue([
    { type: "create_layer", target: NEW_TITLE, layerType: "text", name: "SIGNAL" },
    { type: "set_text_document", target: NEW_TITLE, text: "SIGNAL", fontSize: 150 },
  ]);
  assert.equal(result.ok, true, result.text);
  assert.equal(result.stored[0]?.text, "SIGNAL");
  assert.equal(result.stored[1]?.text, "SIGNAL", "the set_text_document is left as it is");
});

test("a text create_layer without text is still refused when no set_text_document in the call carries it", () => {
  const none = queue([{ type: "create_layer", target: NEW_TITLE, layerType: "text", name: "SIGNAL" }]);
  assert.equal(none.ok, false);
  assert.match(none.text, /Text layers require text content/);
  const other = queue([
    { type: "create_layer", target: NEW_TITLE, layerType: "text", name: "SIGNAL" },
    { type: "set_text_document", target: { layerId: "__new__:other" }, text: "X" },
  ]);
  assert.equal(other.ok, false);
});

test("a top-level propertyPath moves into a placeholder (__new__) target that lacks it", () => {
  const result = queue([
    { type: "create_layer", target: NEW_TITLE, layerType: "text", name: "T", text: "T" },
    { type: "set_expression", target: NEW_TITLE, propertyPath: POSITION, source: "wiggle(1, 5)", enabled: true },
  ]);
  assert.equal(result.ok, true, result.text);
  assert.equal(result.stored[1]?.propertyPath, undefined);
  assert.equal(stringAt(objectAt(result.stored[1], "target"), "propertyPath"), POSITION);
});

test("a top-level propertyPath identical to the one in target is dropped; a different one is still refused", () => {
  const target = { ...TITLE, propertyPath: POSITION };
  const same = queue([{ type: "set_expression", target, propertyPath: POSITION, source: "wiggle(1, 5)", enabled: true }]);
  assert.equal(same.ok, true, same.text);
  assert.equal(same.stored[0]?.propertyPath, undefined);
  assert.equal(stringAt(objectAt(same.stored[0], "target"), "propertyPath"), POSITION);
  const differs = queue([{ type: "set_expression", target, propertyPath: SCALE, source: "wiggle(1, 5)", enabled: true }]);
  assert.equal(differs.ok, false);
});

test("set_text_document with the text document path both in target and at the top level is accepted with both dropped", () => {
  const path = "ADBE Text Properties/ADBE Text Document";
  const result = queue([{ type: "set_text_document", target: { ...TITLE, propertyPath: path }, propertyPath: path, text: "Hi" }]);
  assert.equal(result.ok, true, result.text);
  assert.equal(result.stored[0]?.propertyPath, undefined);
  assert.equal(stringAt(objectAt(result.stored[0], "target"), "propertyPath"), undefined);
  const other = queue([{ type: "set_text_document", target: { ...TITLE, propertyPath: POSITION }, propertyPath: POSITION, text: "Hi" }]);
  assert.equal(other.ok, false);
});

test("a single number for Scale keys expands to a uniform vector; position keys are never expanded", () => {
  const keys: JsonObject[] = [{ time: 0.4, value: 0, curve: "out-expo" }, { time: 1.2, value: 100 }];
  const result = queue([{ type: "animate_property", target: { ...TITLE, propertyPath: SCALE }, keyframes: keys }]);
  assert.equal(result.ok, true, result.text);
  const keyframes = objectsIn(arrayAt(result.stored[0], "keyframes"));
  assert.deepEqual(keyframes.map((key) => key.value), [[0, 0], [100, 100]]);
  const position = queue([{ type: "animate_property", target: { ...TITLE, propertyPath: POSITION }, keyframes: [{ time: 0, value: 5 }, { time: 1, value: 6 }] }]);
  assert.equal(position.ok, false);
  assert.match(position.text, /never expanded/);
});
