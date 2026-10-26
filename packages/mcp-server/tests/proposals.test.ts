// Proves that ae_propose_plan composes multi-operation plans against observed and plan-created targets, canonicalizes their placeholders, and refuses unresolvable references.
import test from "node:test";
import assert from "node:assert/strict";
import { representativeSnapshot } from "@extynt/project-graph";
import { callTool, PROPOSAL_OPERATION_LIMIT } from "../src/index.js";
import { booleanAt, objectAt, stringAt } from "../src/json.js";
import type { JsonObject } from "@extynt/decode";
import { refusalOf } from "./support/json-results.js";
import { RENDER_OUTPUT } from "./support/fixtures.js";
import { noticesOf, planContext, presentationOf, proposedOperations, propose, renamedPlaceholders, successObject, targetField } from "./support/proposal-views.js";

const TITLE = { compositionId: "comp-main", layerId: "layer-title" };
const OPACITY = "ADBE Transform Group/ADBE Opacity";
const SCALE = "ADBE Transform Group/ADBE Scale";
const PERCENT_END = "ADBE Text Properties/ADBE Text Animators/ADBE Text Animator/ADBE Text Selectors/ADBE Text Selector/ADBE Text Percent End";
const FADE_IN = [{ time: 0, value: 0 }, { time: 1, value: 100 }];
const SCENE_SIZE = { width: 1920, height: 1080 };

test("ae_propose_plan carries the non-blocking Gradient Ramp warning into the plan card", () => {
  const effectPath = "ADBE Effect Parade/ADBE Ramp";
  const target = { compositionId: "comp-main", layerId: "__new__:gradient-shape" };
  const result = propose("Warn about an unsafe gradient target", [
    { type: "create_layer", target, layerType: "shape", name: "Planet" },
    { type: "ensure_effect", target: { ...target, effectPath }, capabilityId: "adobe.gradient-ramp", effectMatchName: "ADBE Ramp", effectPath },
  ], planContext());
  const warnings = presentationOf(result).warnings;
  assert.ok(Array.isArray(warnings) && warnings.some((warning) => /Gradient Ramp fills the whole layer rectangle/.test(String(warning))));
  assert.equal(stringAt(noticesOf(result).find((notice) => stringAt(notice, "code") === "RAMP_ON_SHAPE_LAYER"), "severity"), "note");
});

test("ae_propose_plan composes a custom multi-operation plan against existing observed targets", () => {
  const context = planContext();
  const result = propose("Fade and scale the title", [
    { type: "animate_property", target: { ...TITLE, propertyPath: OPACITY }, role: "transform.opacity", keyframes: FADE_IN },
    { type: "animate_property", target: { ...TITLE, propertyPath: SCALE }, role: "transform.scale", keyframes: [{ time: 0, value: [0, 0] }, { time: 1, value: [100, 100] }] },
  ], context);
  const data = successObject(result);
  const plan = objectAt(data, "plan");
  assert.equal(stringAt(plan, "schemaVersion"), "0.2");
  assert.equal(proposedOperations(result).length, 2);
  assert.equal(stringAt(plan, "digest")?.length, 64);
  assert.equal(stringAt(objectAt(presentationOf(result), "target"), "layerName"), "TITLE — Summer");
  assert.equal(booleanAt(objectAt(data, "approvalCapability"), "oneTime"), true);
  assert.ok(callTool("ae_get_plan_status", { planId: stringAt(data, "planId") ?? "" }, context).ok);
});

test("ae_propose_plan batch-renames several existing layers in one reviewable plan", () => {
  const result = propose("Rename layers to match convention", [
    { type: "set_layer_name", target: TITLE, name: "Title_01" },
    { type: "set_layer_name", target: { compositionId: "comp-main", layerId: "layer-footage" }, name: "Footage_01" },
  ], planContext());
  assert.equal(proposedOperations(result).length, 2);
});

test("ae_propose_plan parents a layer and sets a blend mode in one composed plan", () => {
  const result = propose("Parent title to footage and screen-blend it", [
    { type: "set_layer_parent", target: TITLE, parentLayerId: "layer-footage" },
    { type: "set_layer_attribute", target: TITLE, role: "blend-mode", value: "SCREEN" },
  ], planContext());
  assert.equal(proposedOperations(result).length, 2);
});

test("ae_propose_plan creates a new composition and a text layer inside it without the caller knowing the placeholder convention", () => {
  const operations = proposedOperations(propose("Variant comp with a Lorem Ipsum title", [
    { type: "create_composition", name: "Variant 1", ...SCENE_SIZE, durationSeconds: 4, frameRate: 30 },
    { type: "create_layer", target: { compositionId: "__new__:comp0" }, layerType: "text", name: "Lorem Ipsum", text: "Lorem ipsum dolor sit amet" },
  ], planContext()));
  assert.equal(stringAt(operations[0], "type"), "create_composition");
  assert.equal(stringAt(operations[0], "newCompositionId"), "__new__:comp0");
  assert.equal(targetField(operations[1], "compositionId"), "__new__:comp0");
});

test("ae_propose_plan composes a per-character reveal via ensure_text_animator", () => {
  const operations = proposedOperations(propose("Fade in the title one character at a time", [{ type: "ensure_text_animator", target: TITLE, role: "text.opacity", value: 0 }], planContext()));
  assert.equal(stringAt(operations[0], "type"), "ensure_text_animator");
});

test("ae_propose_plan canonicalizes earlier created layers for same-plan text animation", () => {
  const created = { compositionId: "__new__:title-comp", layerId: "__new__:title0" };
  const operations = proposedOperations(propose("Create and reveal title", [
    { type: "create_composition", newCompositionId: "__new__:title-comp", name: "Title", ...SCENE_SIZE, durationSeconds: 2, frameRate: 24 },
    { type: "create_layer", target: created, layerType: "text", name: "Title", text: "Hello" },
    { type: "set_layer_property", target: created, role: "transform.opacity", propertyPath: OPACITY, value: 0 },
    { type: "ensure_text_animator", target: created, role: "text.opacity", value: 0 },
    { type: "animate_property", target: { ...created, propertyPath: PERCENT_END }, keyframes: FADE_IN },
  ], planContext()));
  assert.equal(targetField(operations[1], "compositionId"), "__new__:comp0");
  assert.equal(targetField(operations[1], "layerId"), "__new__:layer1");
  assert.equal(targetField(operations[4], "layerId"), "__new__:layer1");
});

test("ae_propose_plan rejects forward or cross-composition created-layer references", () => {
  const late = { compositionId: "comp-main", layerId: "__new__:title0" };
  const createLate: JsonObject = { type: "create_layer", target: late, layerType: "text", name: "Late", text: "Late" };
  assert.ok(!propose("Bad forward", [{ type: "set_layer_name", target: late, name: "Late" }, createLate], planContext()).ok);
  const wrongComposition: JsonObject = { type: "set_layer_name", target: { compositionId: "other", layerId: "__new__:title0" }, name: "Wrong" };
  assert.ok(!propose("Bad cross", [createLate, wrongComposition], planContext()).ok);
});

test("ae_propose_plan keeps ten created text layers and their reveals in one 40-operation plan", () => {
  const operations = Array.from({ length: 10 }, (_, index): ReadonlyArray<JsonObject> => {
    const target = { compositionId: "comp-main", layerId: `__new__:title${index}` };
    return [
      { type: "create_layer", target, layerType: "text", name: `Title ${index}`, text: `Title ${index}` },
      { type: "set_layer_property", target, role: "transform.opacity", propertyPath: OPACITY, value: 0 },
      { type: "ensure_text_animator", target, role: "text.opacity", value: 0 },
      { type: "animate_property", target: { ...target, propertyPath: PERCENT_END }, keyframes: FADE_IN },
    ];
  }).flat();
  assert.equal(proposedOperations(propose("Ten title reveals", operations, planContext())).length, 40);
});

test("ae_propose_plan rejects an unresolvable target without mutating anything", () => {
  const result = propose("Animate a layer that does not exist", [{ type: "animate_property", target: { compositionId: "comp-main", layerId: "no-such-layer" }, role: "transform.opacity", keyframes: FADE_IN }], planContext());
  assert.equal(refusalOf(result).code, "TARGET_NOT_FOUND");
});

test("ae_propose_plan rejects an empty or oversized operations list", () => {
  assert.equal(refusalOf(propose("Nothing", [], planContext())).code, "INVALID_ARGUMENT");
  const one: JsonObject = { type: "animate_property", target: TITLE, role: "transform.opacity", keyframes: [{ time: 0, value: 0 }] };
  const tooMany = propose("Too many", Array.from({ length: PROPOSAL_OPERATION_LIMIT + 1 }, () => one), planContext());
  assert.equal(refusalOf(tooMany).code, "INVALID_ARGUMENT");
});

test("ae_propose_plan supports create_layer without requiring the caller to know the new-layer ID convention", () => {
  const operations = proposedOperations(propose("Add a Lorem Ipsum text layer", [{ type: "create_layer", target: { compositionId: "comp-main" }, layerType: "text", name: "Lorem Ipsum", text: "Lorem ipsum dolor sit amet" }], planContext()));
  assert.equal(targetField(operations[0], "layerId"), "__new__:layer0");
});

test("ae_propose_plan reaches item, composition-only, and render operations while returning canonical item mappings", () => {
  const items = [
    { id: "folder-root", name: "Root", type: "folder" as const, parentFolderId: null, compositionId: null, sourceId: null },
    { id: "footage-plate", name: "plate.mov", type: "footage" as const, parentFolderId: "folder-root", compositionId: null, sourceId: null },
  ];
  const plate = { itemId: "footage-plate" };
  const result = propose("Organize and render", [
    { type: "create_folder", newFolderId: "__new__:media", name: "Media", parentFolderId: "folder-root" },
    { type: "import_file", newItemId: "__new__:source", path: "/fixtures/source.mov", destinationFolderId: "__new__:media" },
    { type: "set_item_name", target: { itemId: "__new__:source" }, name: "Source" },
    { type: "move_item_to_folder", target: plate, folderId: "__new__:media" },
    { type: "replace_footage", target: plate, path: "/fixtures/replacement.mov" },
    { type: "set_footage_proxy", target: plate, path: "/fixtures/proxy.mov" },
    { type: "clear_footage_proxy", target: plate },
    { type: "set_composition_settings", target: { compositionId: "comp-main" }, settings: { width: 1280 } },
    { type: "render_composition", compositionId: "comp-main", outputPath: RENDER_OUTPUT, destinationPolicy: "explicit-local-path" },
  ], planContext({ snapshot: { ...representativeSnapshot, items } }));
  const operations = proposedOperations(result);
  assert.equal(stringAt(operations[0], "newFolderId"), "__new__:folder0");
  assert.equal(stringAt(operations[1], "newItemId"), "__new__:item1");
  assert.equal(targetField(operations[2], "itemId"), "__new__:item1");
  assert.equal(targetField(operations[7], "compositionId"), "comp-main");
  assert.equal(stringAt(operations[8], "compositionId"), "comp-main");
  assert.equal(renamedPlaceholders(result)["__new__:media"], "__new__:folder0");
  assert.equal(renamedPlaceholders(result)["__new__:source"], "__new__:item1");
});

test("ae_propose_plan canonicalizes mask and shape placeholders on their owning layer", () => {
  const shape = { vertices: [[0, 0], [100, 0], [100, 100]], closed: true };
  const owner = { compositionId: "comp-main", layerId: "__new__:layer0" };
  const result = propose("Create typed mask and shape", [
    { type: "create_layer", target: { compositionId: "comp-main" }, layerType: "shape", name: "Shapes" },
    { type: "add_mask", target: TITLE, newMaskId: "__new__:reveal-mask", name: "Reveal", values: { path: shape } },
    { type: "update_mask", target: TITLE, maskId: "__new__:reveal-mask", values: { opacity: 50 } },
    { type: "create_shape_group", target: owner, newGroupId: "__new__:box", name: "Box" },
    { type: "set_shape_path", target: owner, groupId: "__new__:box", path: shape },
    { type: "ensure_shape_fill", target: owner, groupId: "__new__:box", color: [1, 0, 0] },
  ], planContext());
  const operations = proposedOperations(result);
  assert.equal(stringAt(operations[1], "newMaskId"), "__new__:mask1");
  assert.equal(stringAt(operations[2], "maskId"), "__new__:mask1");
  assert.equal(stringAt(operations[3], "newGroupId"), "__new__:shape3");
  assert.equal(stringAt(operations[5], "groupId"), "__new__:shape3");
  assert.equal(renamedPlaceholders(result)["__new__:reveal-mask"], "__new__:mask1");
  assert.equal(renamedPlaceholders(result)["__new__:box"], "__new__:shape3");
});

test("ae_propose_plan permits later operations to target a caller-named duplicated layer", () => {
  const copy = { compositionId: "comp-main", layerId: "__new__:copy" };
  const result = propose("Duplicate and arrange", [
    { type: "duplicate_layer", target: TITLE, newLayerId: "__new__:copy" },
    { type: "set_layer_name", target: copy, name: "Title Copy" },
    { type: "reorder_layer", target: copy, placement: "end" },
  ], planContext());
  const operations = proposedOperations(result);
  assert.equal(stringAt(operations[0], "newLayerId"), "__new__:layer0");
  assert.equal(targetField(operations[1], "layerId"), "__new__:layer0");
  assert.equal(targetField(operations[2], "layerId"), "__new__:layer0");
  assert.equal(renamedPlaceholders(result)["__new__:copy"], "__new__:layer0");
});

test("ae_propose_plan permits later operations to target a caller-named duplicated composition and its layers", () => {
  const result = propose("Run cycle from the walk comp", [
    { type: "duplicate_composition", target: { compositionId: "comp-main" }, newCompositionId: "__new__:run", name: "Run Cycle" },
    { type: "set_layer_name", target: { compositionId: "__new__:run", layerId: "layer-title" }, name: "Run Title" },
    { type: "duplicate_composition", target: { compositionId: "__new__:run" }, newCompositionId: "__new__:jump", name: "Jump Cycle" },
  ], planContext());
  const operations = proposedOperations(result);
  assert.equal(stringAt(operations[0], "newCompositionId"), "__new__:comp0");
  assert.equal(targetField(operations[1], "compositionId"), "__new__:comp0");
  assert.equal(targetField(operations[2], "compositionId"), "__new__:comp0");
  assert.equal(stringAt(operations[2], "newCompositionId"), "__new__:comp2");
  assert.equal(renamedPlaceholders(result)["__new__:run"], "__new__:comp0");
});

test("ae_propose_plan refuses to duplicate a composition that no earlier operation created", () => {
  const missing: JsonObject = { type: "duplicate_composition", target: { compositionId: "__new__:never" }, newCompositionId: "__new__:run" };
  assert.ok(!propose("Missing source", [missing], planContext()).ok);
});

test("ae_propose_plan resolves an edit_keyframes copy source through the plan's own placeholders", () => {
  const position = "ADBE Transform Group/ADBE Position";
  const anchor = "ADBE Transform Group/ADBE Anchor Point";
  const operations = proposedOperations(propose("Copy keys onto a duplicated comp", [
    { type: "duplicate_composition", target: { compositionId: "comp-main" }, newCompositionId: "__new__:run", name: "Run Cycle" },
    { type: "edit_keyframes", target: { compositionId: "__new__:run", layerId: "layer-title", propertyPath: position }, action: "copy", source: { ...TITLE, propertyPath: anchor }, timeOffset: 0.5 },
    { type: "edit_keyframes", target: { ...TITLE, propertyPath: position }, action: "copy", source: { compositionId: "__new__:run", layerId: "layer-title", propertyPath: anchor } },
  ], planContext()));
  assert.equal(targetField(operations[1], "compositionId"), "__new__:comp0");
  assert.equal(stringAt(objectAt(operations[2], "source"), "compositionId"), "__new__:comp0");
});

test("ae_propose_plan lets keyframes and expressions reach a rig control the snapshot does not list, and still refuses a malformed path", () => {
  const rig = "ADBE Effect Parade/Pseudo/DUIK Controller/ADBE Slider Control-0001";
  const keyed = propose("Key a rig control", [{ type: "animate_property", target: { ...TITLE, propertyPath: rig }, keyframes: FADE_IN }], planContext());
  assert.ok(keyed.ok, keyed.ok ? "" : JSON.stringify(keyed.error));
  const expression = propose("Expression on a rig control", [{ type: "set_expression", target: { ...TITLE, propertyPath: rig }, source: "time * 10", enabled: true }], planContext());
  assert.ok(expression.ok, expression.ok ? "" : JSON.stringify(expression.error));
  const malformed = propose("Bad path", [{ type: "animate_property", target: { ...TITLE, propertyPath: "Opacity" }, keyframes: FADE_IN }], planContext());
  assert.ok(!malformed.ok);
});

test("precompose followed by set_layer_name on the newLayerId placeholder succeeds and renamedPlaceholders maps both placeholders", () => {
  const result = propose("Precompose and rename", [
    { type: "precompose_layers", target: { compositionId: "comp-main" }, layerIds: ["layer-title"], name: "Pre", newCompositionId: "__new__:pre", newLayerId: "__new__:prelayer" },
    { type: "set_layer_name", target: { compositionId: "comp-main", layerId: "__new__:prelayer" }, name: "Precomp Title" },
  ], planContext());
  assert.equal(proposedOperations(result).length, 2);
  assert.equal(renamedPlaceholders(result)["__new__:pre"], "__new__:comp0");
  assert.equal(renamedPlaceholders(result)["__new__:prelayer"], "__new__:layer0");
});

test("add_text_animator then update_text_animator using the caller placeholder maps to __new__:animator<index>", () => {
  const result = propose("Add and update animator", [
    { type: "add_text_animator", target: TITLE, newAnimatorId: "__new__:anim", properties: { opacity: 0 } },
    { type: "update_text_animator", target: TITLE, animatorId: "__new__:anim", properties: { opacity: 50 } },
  ], planContext());
  const operations = proposedOperations(result);
  assert.equal(operations.length, 2);
  assert.equal(renamedPlaceholders(result)["__new__:anim"], "__new__:animator0");
  assert.equal(targetField(operations[1], "layerId"), "layer-title");
});

test("precompose then operating on a precomposed layer id is rejected with PRECOMPOSED_LAYER_REFERENCED", () => {
  const result = propose("Precompose and operate on precomposed", [
    { type: "precompose_layers", target: { compositionId: "comp-main" }, layerIds: ["layer-title"], name: "Pre", newCompositionId: "__new__:pre", newLayerId: "__new__:prelayer" },
    { type: "set_layer_name", target: TITLE, name: "Invalid" },
  ], planContext());
  assert.equal(refusalOf(result).code, "PRECOMPOSED_LAYER_REFERENCED");
});
