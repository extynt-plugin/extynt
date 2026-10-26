// Tests for compose corrections.
import test from "node:test";
import assert from "node:assert/strict";
import { authoring, dataOf } from "./support/fixtures.js";
import { resultData, storedOperations } from "./support/json-results.js";
import { correctOperation } from "../src/compose-corrections.js";
import { callTool } from "../src/index.js";
import type { StoredPlan, ToolContext } from "../src/index.js";
import { arrayAt, numberAt, objectAt, objectOf, objectsIn, stringAt, stringsIn } from "../src/json.js";
import type { JsonObject, JsonValue } from "@extynt/decode";
import { representativeSnapshot } from "@extynt/project-graph";
import type { ProjectSnapshot, PropertySnapshot } from "@extynt/project-graph";

type TestContext = ToolContext & { plans: Map<string, StoredPlan> };
type Verdict = NonNullable<ReturnType<typeof dataOf>["verdicts"]>[number];

const TITLE = { compositionId: "comp-main", layerId: "layer-title" };
const BLUR = "ADBE Effect Parade/ADBE Gaussian Blur 2";

interface Added {
  verdicts: ReadonlyArray<Verdict>;
  stored: ReadonlyArray<JsonObject>;
  ok: boolean;
  message?: string;
}

function add(context: TestContext, operations: JsonValue[]): Added {
  const created = callTool("ae_plan_create", { summary: "Corrections" }, context);
  assert.equal(created.ok, true); if (!created.ok) throw new Error("plan fixture failed");
  const planId = dataOf(created).planId;
  const added = callTool("ae_plan_add", { planId, operations }, context);
  if (!added.ok) return { verdicts: [], stored: [], ok: false, message: added.error.message };
  const verdicts = dataOf(added).verdicts ?? [];
  const record = context.plans.get(planId);
  const refused = verdicts.find((verdict) => verdict.status === "rejected");
  return { verdicts, stored: storedOperations(record), ok: !refused, ...(refused?.detail ? { message: refused.detail } : {}) };
}

function addressOf(operation: JsonObject | undefined): JsonObject {
  const target = objectAt(operation, "target");
  return objectOf({ compositionId: target?.compositionId, layerId: target?.layerId, effectPath: target?.effectPath, propertyPath: target?.propertyPath });
}

function withShapeLayer(groups: number): TestContext {
  const snapshot: ProjectSnapshot = structuredClone(representativeSnapshot);
  const composition = snapshot.compositions[0];
  const template = composition?.layers[1];
  if (!composition || !template) throw new Error("fixture changed");
  const group = (at: number): PropertySnapshot => ({ path: `ADBE Root Vectors Group/ADBE Vector Group#${at}`, matchName: "ADBE Vector Group", displayName: `Group ${at}`, kind: "group", valueType: "unknown", value: null, canSetValue: false });
  const contents: PropertySnapshot = { path: "ADBE Root Vectors Group", matchName: "ADBE Root Vectors Group", displayName: "Contents", kind: "group", valueType: "unknown", value: null, canSetValue: false, children: Array.from({ length: groups }, (_, at) => group(at + 1)) };
  composition.layers.push({ ...structuredClone(template), id: "layer-shape", index: 3, name: "Shapes", type: "shape", properties: [contents] });
  return { snapshot, plans: new Map<string, StoredPlan>() };
}

const SHAPE = { compositionId: "comp-main", layerId: "layer-shape" };

test("a justification written as center, CENTER or left is the closed-enum member it names, and the verdict says so", () => {
  for (const [given, member] of [["center", "CENTER_JUSTIFY"], ["CENTER", "CENTER_JUSTIFY"], ["left", "LEFT_JUSTIFY"]] as const) {
    const result = add(authoring(), [{ type: "set_text_document", target: TITLE, justification: given }]);
    assert.equal(result.ok, true, result.message);
    assert.equal(result.verdicts[0]?.status, "accepted_modified");
    const change = result.verdicts[0]?.changes?.[0];
    assert.deepEqual([change?.field, change?.from, change?.to], ["justification", given, member]);
    assert.equal(stringAt(result.stored[0], "justification"), member);
  }
});

test("a shape item kind is matched case-insensitively", () => {
  const result = add(withShapeLayer(1), [{ type: "add_shape_item", target: SHAPE, groupId: "shape:1", item: "Rectangle", newItemId: "__new__:box" }]);
  assert.equal(result.ok, true, JSON.stringify(result.verdicts));
  assert.equal(result.stored[0]?.item, "rectangle");
  assert.equal(result.verdicts[0]?.status, "accepted_modified");
});

test("an enum spelling that names two members is left for the validator rather than guessed", () => {
  const result = add(authoring(), [{ type: "set_text_document", target: TITLE, justification: "full" }]);
  assert.equal(result.verdicts[0]?.status, "rejected");
});

test("a propertyPath given beside target moves into target, and one that disagrees with target is not overwritten", () => {
  const moved = add(authoring(), [{ type: "add_essential_property", target: TITLE, propertyPath: "ADBE Transform Group/ADBE Position" }]);
  assert.equal(moved.ok, true, JSON.stringify(moved.verdicts));
  assert.equal(moved.verdicts[0]?.status, "accepted_modified");
  assert.deepEqual(addressOf(moved.stored[0]), { ...TITLE, propertyPath: "ADBE Transform Group/ADBE Position" });
  assert.equal(moved.stored[0]?.propertyPath, undefined);
  const clash = add(authoring(), [{ type: "add_essential_property", target: { ...TITLE, propertyPath: "ADBE Transform Group/ADBE Opacity" }, propertyPath: "ADBE Transform Group/ADBE Position" }]);
  assert.equal(clash.ok, false, "the two paths disagree, so nothing is moved");
});

test("a layerId written beside target on a layer-scoped operation moves into target", () => {
  const result = add(authoring(), [{ type: "set_text_document", target: { compositionId: "comp-main" }, layerId: "layer-title", justification: "CENTER_JUSTIFY" }]);
  assert.equal(result.ok, true, JSON.stringify(result.verdicts));
  assert.deepEqual(addressOf(result.stored[0]), TITLE);
});

test("set_effect_control with a bare matchName effectPath, a bare control name and no effectMatchName is canonicalised", () => {
  const control = "ADBE Gaussian Blur 2-0001";
  const result = add(authoring(), [{ type: "set_effect_control", target: { ...TITLE, effectPath: "ADBE Gaussian Blur 2", propertyPath: control }, value: 45 }]);
  assert.equal(result.ok, true, JSON.stringify(result.verdicts));
  assert.equal(result.verdicts[0]?.status, "accepted_modified");
  assert.deepEqual(addressOf(result.stored[0]), { ...TITLE, effectPath: BLUR, propertyPath: `${BLUR}/${control}` });
  assert.equal(result.stored[0]?.effectMatchName, "ADBE Gaussian Blur 2");
});

test("an effectPath written as the effect's display name resolves through the snapshot", () => {
  const result = add(authoring(), [{ type: "set_effect_control", effectMatchName: "ADBE Gaussian Blur 2", target: { ...TITLE, effectPath: "Gaussian Blur", propertyPath: `${BLUR}/ADBE Gaussian Blur 2-0001` }, value: 12 }]);
  assert.equal(result.ok, true, JSON.stringify(result.verdicts));
  assert.equal(stringAt(objectAt(result.stored[0], "target"), "effectPath"), BLUR);
});

test("ensure_effect with a bare effectPath and a host: capability on the display name is canonicalised", () => {
  const result = add(authoring(), [{ type: "ensure_effect", target: { ...TITLE, effectPath: "ADBE Gaussian Blur 2" }, capabilityId: "host:Gaussian Blur", effectMatchName: "ADBE Gaussian Blur 2", effectPath: "ADBE Gaussian Blur 2" }]);
  assert.equal(result.ok, true, JSON.stringify(result.verdicts));
  assert.equal(result.stored[0]?.effectPath, BLUR);
  assert.equal(stringAt(objectAt(result.stored[0], "target"), "effectPath"), BLUR);
  assert.equal(result.stored[0]?.capabilityId, "host:ADBE Gaussian Blur 2");
});

test("create_shape_group given groupId for its placeholder declares it as newGroupId, and a later fill finds it", () => {
  const result = add(withShapeLayer(0), [
    { type: "create_shape_group", target: SHAPE, groupId: "__new__:bars", name: "Bars" },
    { type: "ensure_shape_fill", target: SHAPE, groupId: "__new__:bars", values: { color: [1, 0, 0], opacity: 80 } },
  ]);
  assert.equal(result.ok, true, JSON.stringify(result.verdicts));
  assert.equal(result.verdicts[0]?.status, "accepted_modified");
  assert.equal(result.stored[0]?.groupId, undefined);
  assert.equal(result.stored[1]?.values, undefined);
  assert.deepEqual(result.stored[1]?.color, [1, 0, 0]);
  assert.equal(result.stored[1]?.opacity, 80);
});

test("ensure_shape_stroke given values:{color,width,opacity} hoists them to the top level", () => {
  const result = add(withShapeLayer(1), [{ type: "ensure_shape_stroke", target: SHAPE, groupId: "shape:1", values: { color: [0, 1, 0], width: 4, opacity: 100 } }]);
  assert.equal(result.ok, true, JSON.stringify(result.verdicts));
  assert.deepEqual([result.stored[0]?.color, result.stored[0]?.width, result.stored[0]?.opacity, result.stored[0]?.values], [[0, 1, 0], 4, 100, undefined]);
});

test("the AE-native root group name maps to root", () => {
  const result = add(withShapeLayer(0), [{ type: "ensure_shape_fill", target: SHAPE, groupId: "ADBE Root Vectors Group", color: [1, 1, 1] }]);
  assert.equal(result.ok, true, JSON.stringify(result.verdicts));
  assert.equal(result.stored[0]?.groupId, "root");
});

test("ADBE Vector Group maps to shape:1 only when the snapshot shows exactly one group; otherwise the refusal names the real ids", () => {
  const one = add(withShapeLayer(1), [{ type: "ensure_shape_fill", target: SHAPE, groupId: "ADBE Root Vectors Group/ADBE Vector Group", color: [1, 1, 1] }]);
  assert.equal(one.stored[0]?.groupId, "shape:1");
  const two = add(withShapeLayer(2), [{ type: "ensure_shape_fill", target: SHAPE, groupId: "ADBE Root Vectors Group/ADBE Vector Group", color: [1, 1, 1] }]);
  assert.equal(two.ok, false);
  assert.match(two.message ?? "", /"shape:1", "shape:2"/);
});

test("shape:0 is never remapped: the refusal names the ordinals the layer has, counting from 1", () => {
  const result = add(withShapeLayer(2), [{ type: "add_shape_item", target: SHAPE, groupId: "shape:0", item: "rectangle", newItemId: "__new__:auto-item-1" }]);
  assert.equal(result.ok, false);
  assert.match(result.message ?? "", /count from 1/);
  assert.match(result.message ?? "", /"shape:1", "shape:2"/);
  assert.doesNotMatch(result.message ?? "", /auto-item-1/, "the operation's own placeholder is not blamed");
});

test("a refused correction is that operation's own verdict and fix entry, and the call's other operations are judged on their own", () => {
  const context = withShapeLayer(2);
  const result = add(context, [
    { type: "set_text_document", target: TITLE, justification: "center" },
    { type: "ensure_shape_fill", target: SHAPE, groupId: "shape:0", color: [1, 1, 1] },
    { type: "ensure_shape_fill", target: SHAPE, groupId: "ADBE Vector Group", color: [1, 1, 1] },
    { type: "ensure_shape_stroke", target: SHAPE, groupId: "shape:2", color: [1, 1, 1], width: 2 },
  ]);
  assert.deepEqual(result.verdicts.map((verdict) => verdict.status), ["accepted_modified", "rejected", "rejected", "accepted"]);
  assert.deepEqual(result.verdicts.map((verdict) => verdict.index), [0, 1, 2, 3]);
  assert.ok(result.verdicts[1]?.fix, "the verdict carries the fix, as any validator refusal does");
  assert.match(result.verdicts[2]?.detail ?? "", /"shape:1", "shape:2"/);
  const queued = callTool("ae_queue_add", { operations: [
    { type: "ensure_shape_fill", target: SHAPE, groupId: "shape:0", color: [1, 1, 1] },
    { type: "ensure_shape_stroke", target: SHAPE, groupId: "shape:2", color: [1, 1, 1], width: 2 },
  ] }, { ...withShapeLayer(2), queue: { planId: null, set(id: string | null) { this.planId = id; } } });
  const fix = objectsIn(arrayAt(resultData(queued), "fix"));
  assert.deepEqual(fix.map((entry) => [numberAt(entry, "position"), stringAt(entry, "code")]), [[0, "TARGET_NOT_FOUND"]]);
});

test("a call that is only corrected is accepted and says what it corrected", () => {
  const context = authoring();
  const proposed = callTool("ae_propose_plan", { summary: "Center the title", operations: [{ type: "set_text_document", target: TITLE, justification: "center" }] }, context);
  assert.equal(proposed.ok, true, JSON.stringify(proposed));
  const data = resultData(proposed);
  assert.equal(numberAt(data, "corrected"), 1);
  assert.match(stringsIn(arrayAt(data, "notes"))[0] ?? "", /justification "center" -> "CENTER_JUSTIFY"/);
});

test("a field moves between target and the top level only where that operation type's validator takes it there", () => {
  const stray = (type: string, extra: JsonObject) => add(authoring(), [{ type, target: { compositionId: "comp-main" }, layerId: "layer-title", ...extra }]);
  assert.equal(stray("set_text_document", { text: "x" }).verdicts[0]?.status, "accepted_modified", "a layer-scoped type takes layerId inside target");
  const created = add(authoring(), [{ type: "create_composition", newCompositionId: "__new__:c", name: "Extra", width: 100, height: 100, durationSeconds: 1, frameRate: 24, layerId: "layer-title" }]);
  assert.equal(created.verdicts[0]?.status, "rejected", "a type with no layer target keeps the validator's refusal");
  assert.match(created.verdicts[0]?.detail ?? "", /layerId/);
  const stranger = { type: "made_up_operation", target: { compositionId: "comp-main" }, layerId: "layer-title" };
  const untouched = correctOperation(stranger, representativeSnapshot, 0);
  assert.deepEqual([untouched.operation, untouched.changes], [stranger, []], "a type the validator does not know is never rewritten");
});

test("re-adding corrected operations in a second batch recomposes cleanly", () => {
  const context = withShapeLayer(0);
  const created = callTool("ae_plan_create", { summary: "Two batches" }, context);
  assert.equal(created.ok, true); if (!created.ok) return;
  const planId = dataOf(created).planId;
  const first = callTool("ae_plan_add", { planId, operations: [{ type: "create_shape_group", target: SHAPE, groupId: "__new__:bars", name: "Bars" }] }, context);
  assert.equal(first.ok, true);
  const second = callTool("ae_plan_add", { planId, operations: [{ type: "ensure_shape_fill", target: SHAPE, groupId: "__new__:bars", color: [1, 0, 0] }] }, context);
  assert.equal(second.ok, true, second.ok ? "" : second.error.message);
  if (second.ok) assert.deepEqual((dataOf(second).verdicts ?? []).map((verdict) => verdict.status), ["accepted"]);
});

test("ae_propose_plan supplies missing declaration ids and reports each as a correction", () => {
  const context = withShapeLayer(1);
  const operations = [
    { type: "add_shape_item", target: SHAPE, groupId: "shape:1", item: "rectangle" },
    { type: "add_shape_item", target: SHAPE, groupId: "shape:1", item: "ellipse", newItemId: "__new__:auto-add-shape-item-1" },
    { type: "add_shape_item", target: SHAPE, groupId: "shape:1", item: "ellipse" },
  ];
  const proposed = callTool("ae_propose_plan", { summary: "Shapes", operations }, context);
  assert.equal(proposed.ok, true, JSON.stringify(proposed));
  const data = resultData(proposed);
  assert.equal(numberAt(data, "corrected"), 2);
  assert.match(stringsIn(arrayAt(data, "notes"))[0] ?? "", /newItemId/);
  assert.equal(Object.keys(objectAt(data, "bindings") ?? {}).length, 3, "three distinct declarations");
});

test("a duplicate declaration id still refuses, naming the expected form and ae_amend_plan", () => {
  const context = withShapeLayer(1);
  const operations = [
    { type: "add_shape_item", target: SHAPE, groupId: "shape:1", item: "rectangle", newItemId: "__new__:a" },
    { type: "add_shape_item", target: SHAPE, groupId: "shape:1", item: "ellipse", newItemId: "__new__:a" },
  ];
  const proposed = callTool("ae_propose_plan", { summary: "Shapes", operations }, context);
  assert.equal(proposed.ok, false);
  if (!proposed.ok) assert.match(proposed.error.message, /__new__:<name>.*ae_amend_plan/);
});
