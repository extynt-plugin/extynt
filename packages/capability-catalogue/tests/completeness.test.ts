// Tests the advisory completeness findings for plans that create objects they never use.
import assert from "node:assert/strict";
import test from "node:test";
import { computePlanDigest, validateActionPlan, collectOperationProblems } from "@extynt/action-plan";
import { representativeSnapshot, type ProjectSnapshot } from "@extynt/project-graph";
import { type JsonObject, type JsonValue } from "@extynt/decode";
import { INTENT_CONCEPTS, planCompleteness } from "../src/index.js";
import { present } from "./present.js";

const COMP = "comp-main";
const TEXT_LAYER = "layer-title";
const PLATE_LAYER = "layer-footage";

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stampTarget(operation: JsonObject, snapshot: ProjectSnapshot): JsonObject {
  const target = operation.target;
  if (!isJsonObject(target)) return operation;
  const stamps = { snapshotFingerprint: snapshot.fingerprint, selectionFingerprint: snapshot.selectionFingerprint };
  if (operation.type === "set_composition_settings") return { ...operation, target: { compositionId: target.compositionId ?? null, ...stamps } };
  return { ...operation, target: { ...target, ...stamps } };
}

function keyframeCount(operation: JsonObject): number {
  const keyframes = operation.keyframes;
  if (Array.isArray(keyframes)) return keyframes.length;
  if (!isJsonObject(keyframes)) return 0;
  return Object.values(keyframes).reduce((inner: number, frames) => inner + (Array.isArray(frames) ? frames.length : 0), 0);
}

function seededPlan(operations: readonly JsonObject[], snapshot: ProjectSnapshot = representativeSnapshot): { plan: JsonObject; operations: JsonObject[] } {
  const stamped = operations.map((operation) => stampTarget(operation, snapshot));
  const totalKeyframes = stamped.reduce((sum, operation) => sum + keyframeCount(operation), 0);
  const plan: JsonObject = {
    schemaVersion: "0.2", planId: "plan-completeness-test", snapshotFingerprint: snapshot.fingerprint, selectionFingerprint: snapshot.selectionFingerprint,
    freshness: snapshot.freshness, summary: "Completeness fixture", requiresApproval: true,
    bounds: { maxOperations: stamped.length, maxKeyframes: Math.max(1, totalKeyframes), maxKeyframeTimeSeconds: 30, maxExpressionLength: 1 },
    preconditions: [], conflicts: [], postconditions: [], operations: stamped, digest: "",
  };
  return { plan: { ...plan, digest: computePlanDigest(plan) }, operations: stamped };
}

const positionWrite = (layerId: string, value: JsonValue): JsonObject => ({ type: "set_layer_property", target: { compositionId: COMP, layerId }, role: "transform.position", propertyPath: "ADBE Transform Group/ADBE Position", value });
const positionAnimation = (layerId: string, firstKey: number) => ({ type: "animate_property", target: { compositionId: COMP, layerId, propertyPath: "ADBE Transform Group/ADBE Position" }, role: "transform.position", keyframes: [{ time: firstKey, value: [0, 0] }, { time: firstKey + 1, value: [10, 10] }] });
const parentTo = (layerId: string, parentLayerId: string) => ({ type: "set_layer_parent", target: { compositionId: COMP, layerId }, parentLayerId });
const shapeLayer = (id: string) => ({ type: "create_layer", target: { compositionId: COMP, layerId: id }, layerType: "shape", name: "Shapes" });
const groupIn = (layerId: string, groupId: string) => ({ type: "create_shape_group", target: { compositionId: COMP, layerId }, newGroupId: groupId, name: "Group" });
const codes = (findings: Array<{ code: string }>) => findings.map((finding) => finding.code);

test("parenting after a Position write is no completeness finding: the plan layer notes it and verification judges the write as it ran", () => {
  assert.deepEqual(planCompleteness([positionWrite(TEXT_LAYER, [160, 90]), parentTo(TEXT_LAYER, PLATE_LAYER)]), []);
  assert.deepEqual(planCompleteness([parentTo(TEXT_LAYER, PLATE_LAYER), positionWrite(TEXT_LAYER, [60, 40])]), []);
});

test("an object the plan creates for nothing is reported, and a used one is not", () => {
  const emptyGroup = [shapeLayer("__new__:shapes"), groupIn("__new__:shapes", "__new__:group")];
  assert.deepEqual(codes(planCompleteness(emptyGroup)), ["CREATED_UNUSED_OBJECT"]);
  assert.match(present(planCompleteness(emptyGroup)[0], "a finding").message, /no operation adds a path, paint or operator to/);
  assert.deepEqual(planCompleteness([...emptyGroup, { type: "ensure_shape_fill", target: { compositionId: COMP, layerId: "__new__:shapes" }, groupId: "__new__:group", color: [1, 0, 0] }]), []);

  const nullLayer = [{ type: "create_layer", target: { compositionId: COMP, layerId: "__new__:handle" }, layerType: "null", name: "Handle" }];
  assert.deepEqual(codes(planCompleteness(nullLayer)), ["CREATED_UNUSED_OBJECT"]);
  assert.deepEqual(planCompleteness([...nullLayer, { type: "add_marker", target: { compositionId: COMP, layerId: "__new__:handle" }, time: 1, comment: "Beat" }]), []);

  const unusedImport = [{ type: "import_file", newItemId: "__new__:item", path: "/fixtures/plate.mov" }];
  assert.deepEqual(codes(planCompleteness(unusedImport)), ["CREATED_UNUSED_OBJECT"]);
  assert.deepEqual(planCompleteness([...unusedImport, { type: "create_layer", target: { compositionId: COMP, layerId: "__new__:plate" }, layerType: "footage", name: "Plate", sourceItemId: "__new__:item" }]), []);

  const unusedComposition = [{ type: "create_composition", newCompositionId: "__new__:pre", name: "Pre", width: 1920, height: 1080, durationSeconds: 2, frameRate: 24 }];
  assert.deepEqual(codes(planCompleteness(unusedComposition)), ["CREATED_UNUSED_OBJECT"]);
  assert.deepEqual(planCompleteness([...unusedComposition, { type: "create_layer", target: { compositionId: "__new__:pre", layerId: "__new__:inner" }, layerType: "shape", name: "Inner" }]), []);
});

test("a path in a group this plan creates with no paint is reported; an existing group is not judged", () => {
  const primitive = (groupId: string) => ({ type: "add_shape_item", target: { compositionId: COMP, layerId: "__new__:shapes" }, groupId, item: "rectangle", newItemId: "__new__:rect", values: { size: [10, 10], position: [0, 0] } });
  const findings = planCompleteness([shapeLayer("__new__:shapes"), groupIn("__new__:shapes", "__new__:group"), primitive("__new__:group")]);
  assert.deepEqual(codes(findings), ["INVISIBLE_SHAPE_ITEM"]);
  assert.deepEqual(findings[0]?.operationIndexes, [2]);
  assert.match(findings[0].message, /no fill or stroke in this plan/);
  assert.deepEqual(planCompleteness([shapeLayer("__new__:shapes"), groupIn("__new__:shapes", "__new__:group"), primitive("__new__:group"), { type: "ensure_shape_stroke", target: { compositionId: COMP, layerId: "__new__:shapes" }, groupId: "__new__:group", color: [1, 1, 1], width: 4 }]), []);
  assert.deepEqual(planCompleteness([shapeLayer("__new__:shapes"), primitive("root")]), []);
});

test("a layer created and then removed is reported; a used one is not", () => {
  const created = { type: "create_layer", target: { compositionId: COMP, layerId: "__new__:temp" }, layerType: "solid", name: "Temp" };
  const findings = planCompleteness([created, { type: "remove_layer", target: { compositionId: COMP, layerId: "__new__:temp" }, destructive: true }]);
  assert.deepEqual(codes(findings), ["CREATED_THEN_REMOVED"]);
  assert.deepEqual(findings[0]?.operationIndexes, [0, 1]);
  assert.deepEqual(planCompleteness([created, { type: "set_layer_property", target: { compositionId: COMP, layerId: "__new__:temp" }, role: "transform.opacity", propertyPath: "ADBE Transform Group/ADBE Opacity", value: 50 }, { type: "remove_layer", target: { compositionId: COMP, layerId: "__new__:temp" }, destructive: true }]), []);
});

test("nothing is reported for a property that states no value before its first key", () => {
  assert.deepEqual(planCompleteness([shapeLayer("__new__:shapes"), positionAnimation("__new__:shapes", 1)]), []);
  assert.deepEqual(planCompleteness([positionAnimation(TEXT_LAYER, 1)]), []);
  assert.deepEqual(planCompleteness([shapeLayer("__new__:shapes"), positionAnimation("__new__:shapes", 0)]), []);
});

test("a static write a later animation makes unobservable is reported, whenever the keys start", () => {
  const setOpacity = { type: "set_layer_property", target: { compositionId: COMP, layerId: TEXT_LAYER }, role: "transform.opacity", propertyPath: "ADBE Transform Group/ADBE Opacity", value: 50 };
  const animateOpacity = (firstKey: number) => ({ type: "animate_property", target: { compositionId: COMP, layerId: TEXT_LAYER, propertyPath: "ADBE Transform Group/ADBE Opacity" }, role: "transform.opacity", keyframes: [{ time: firstKey, value: 0 }, { time: firstKey + 1, value: 100 }] });
  const findings = planCompleteness([setOpacity, animateOpacity(0)]);
  assert.deepEqual(codes(findings), ["SUPERSEDED_STATIC_WRITE"]);
  assert.deepEqual(findings[0]?.operationIndexes, [0, 1]);
  assert.match(findings[0].message, /held at no time at all/);
  assert.deepEqual(codes(planCompleteness([setOpacity, animateOpacity(2)])), ["SUPERSEDED_STATIC_WRITE"]);
  assert.deepEqual(planCompleteness([setOpacity, { ...animateOpacity(2), target: { compositionId: COMP, layerId: "layer-other", propertyPath: "ADBE Transform Group/ADBE Opacity" } }]), []);
});

test("a declared concept is checked exactly, and an unknown one says so", () => {
  const withSummary = [shapeLayer("__new__:shapes")];
  assert.deepEqual(planCompleteness(withSummary), []);
  assert.deepEqual(codes(planCompleteness(withSummary, { declaredConcepts: ["blur"] })), ["INTENT_CONCEPT_UNTOUCHED"]);
  assert.match(present(planCompleteness(withSummary, { declaredConcepts: ["blur"] })[0], "a finding").message, /no operation touches it/);
  const unknown = planCompleteness(withSummary, { declaredConcepts: ["vecctor"] });
  assert.deepEqual(codes(unknown), ["INTENT_CONCEPT_UNKNOWN"]);
  assert.match(present(unknown[0], "a finding").message, /Declare one of: blur, glow, shadow, gradient, matte, mask, parent, marker, expression, text, camera, audio\./);
  assert.deepEqual(planCompleteness([{ type: "ensure_effect", target: { compositionId: COMP, layerId: TEXT_LAYER, effectPath: "ADBE Effect Parade/ADBE Gaussian Blur 2" }, capabilityId: "adobe.gaussian-blur", effectMatchName: "ADBE Gaussian Blur 2", effectPath: "ADBE Effect Parade/ADBE Gaussian Blur 2" }], { declaredConcepts: ["blur"] }), []);
  assert.deepEqual(planCompleteness([{ type: "ensure_layer_style", target: { compositionId: COMP, layerId: TEXT_LAYER }, style: "outer-glow" }], { declaredConcepts: ["glow"] }), []);
  assert.deepEqual(planCompleteness([{ type: "add_mask", target: { compositionId: COMP, layerId: TEXT_LAYER }, newMaskId: "__new__:mask", name: "M" }], { declaredConcepts: ["mask"] }), []);
  const preset = [{ type: "apply_preset", target: { compositionId: COMP, layerId: TEXT_LAYER }, presetId: "preset:ae-presets:0123456789abcdef0123" }];
  assert.deepEqual(planCompleteness(preset, { declaredConcepts: ["blur", "matte", "text", "parent"] }), []);
  assert.ok(INTENT_CONCEPTS.length >= 12);
  for (const concept of INTENT_CONCEPTS) assert.ok(concept.word === concept.word.toLowerCase() && concept.matches({ index: 0, type: "apply_preset", operation: {}, target: {} }));
});

test("findings are advisory: the same plan passes every validator gate", () => {
  const { plan, operations } = seededPlan([
    positionWrite(TEXT_LAYER, [160, 90]),
    parentTo(TEXT_LAYER, PLATE_LAYER),
    { type: "set_layer_property", target: { compositionId: COMP, layerId: TEXT_LAYER }, role: "transform.opacity", propertyPath: "ADBE Transform Group/ADBE Opacity", value: 50 },
    { type: "animate_property", target: { compositionId: COMP, layerId: TEXT_LAYER, propertyPath: "ADBE Transform Group/ADBE Opacity" }, role: "transform.opacity", keyframes: [{ time: 0, value: 0 }, { time: 1, value: 100 }] },
  ]);
  assert.deepEqual(collectOperationProblems(plan, representativeSnapshot), [], "a finding is not an operation problem");
  assert.equal(validateActionPlan(plan, representativeSnapshot).ok, true, "a finding is not a plan problem");
  assert.deepEqual(planCompleteness(operations), planCompleteness(operations), "and reading it twice says the same thing");
  assert.deepEqual(codes(planCompleteness(operations)), ["SUPERSEDED_STATIC_WRITE"]);
});

test("findings are ordered by plan position and bounded", () => {
  const operations = [shapeLayer("__new__:shapes"), groupIn("__new__:shapes", "__new__:group"), { type: "set_layer_property", target: { compositionId: COMP, layerId: TEXT_LAYER }, role: "transform.opacity", propertyPath: "ADBE Transform Group/ADBE Opacity", value: 50 }, { type: "animate_property", target: { compositionId: COMP, layerId: TEXT_LAYER, propertyPath: "ADBE Transform Group/ADBE Opacity" }, role: "transform.opacity", keyframes: [{ time: 0, value: 0 }, { time: 1, value: 100 }] }];
  const findings = planCompleteness(operations);
  assert.deepEqual(codes(findings), ["CREATED_UNUSED_OBJECT", "SUPERSEDED_STATIC_WRITE"], "lowest index first");
  assert.equal(planCompleteness(operations, { limit: 1 }).length, 1);
  assert.deepEqual(codes(planCompleteness(operations, { limit: 1 })), ["CREATED_UNUSED_OBJECT"]);
  assert.deepEqual(planCompleteness([], {}), [], "an empty plan has nothing to say");
});
