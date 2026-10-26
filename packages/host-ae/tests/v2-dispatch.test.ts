// Every v0.2 operation kind reaches its host operation, and the plan-level rules around the dispatch hold.
import test from "node:test";
import assert from "node:assert/strict";
import { computePlanDigest, type ActionPlanV2, type ActionPlanV2Operation, type ApprovalBinding } from "@extynt/action-plan";
import { representativeSnapshot } from "@extynt/project-graph";
import { PLAN_UNDO_BATCH_SIZE, compileCommand, compileV2Plan, type HostPlanCommand } from "../src/index.js";

type OperationType = ActionPlanV2Operation["type"];
type OperationOf<T extends OperationType> = Extract<ActionPlanV2Operation, { type: T }>;

const snapshot = representativeSnapshot;
const snapshotLayerTarget = { compositionId: "comp-main", layerId: "layer-title", snapshotFingerprint: snapshot.fingerprint, selectionFingerprint: snapshot.selectionFingerprint };

const layerTarget = { compositionId: "comp-main", layerId: "layer-title", snapshotFingerprint: "fp-1", selectionFingerprint: "sel-1" };
const itemTarget = { itemId: "item-1", snapshotFingerprint: "fp-1", selectionFingerprint: "sel-1" };
const compositionTarget = { compositionId: "comp-main", snapshotFingerprint: "fp-1", selectionFingerprint: "sel-1" };

const MINIMAL_OPERATIONS: { [T in OperationType]: OperationOf<T> } = {
  ensure_effect: { type: "ensure_effect", target: layerTarget, capabilityId: "cap-blur", effectMatchName: "ADBE Gaussian Blur 2", effectPath: "ADBE Effect Parade/ADBE Gaussian Blur 2" },
  apply_preset: { type: "apply_preset", target: layerTarget, presetId: "preset:ae-presets:00000000000000000000" },
  ensure_layer_style: { type: "ensure_layer_style", target: layerTarget, style: "drop-shadow" },
  set_effect_control: { type: "set_effect_control", target: layerTarget, effectMatchName: "ADBE Gaussian Blur 2", value: 20 },

  set_text_document: { type: "set_text_document", target: layerTarget },
  ensure_text_animator: { type: "ensure_text_animator", target: layerTarget, role: "text.opacity", value: 50 },
  add_text_animator: { type: "add_text_animator", target: layerTarget, newAnimatorId: "__new__:animator-1" },
  update_text_animator: { type: "update_text_animator", target: layerTarget, animatorId: "animator:1" },

  create_shape_group: { type: "create_shape_group", target: layerTarget, newGroupId: "__new__:group-1", name: "Group 1" },
  set_shape_path: { type: "set_shape_path", target: layerTarget, groupId: "root", path: { vertices: [[0, 0]], closed: true } },
  ensure_shape_fill: { type: "ensure_shape_fill", target: layerTarget, groupId: "root", color: [1, 0, 0] },
  ensure_shape_stroke: { type: "ensure_shape_stroke", target: layerTarget, groupId: "root", color: [1, 0, 0], width: 2 },
  draw_vector_shapes: { type: "draw_vector_shapes", target: layerTarget, shapes: [{ name: "Disc", paths: [{ vertices: [[0, 0], [10, 0], [10, 10]], closed: true }], fill: { color: [1, 0, 0], rule: "evenodd" }, stroke: { color: [0, 0, 0], width: 2, cap: "round", join: "bevel" } }] },
  add_shape_item: { type: "add_shape_item", target: layerTarget, groupId: "root", item: "rectangle", newItemId: "__new__:item-1" },
  update_shape_item: { type: "update_shape_item", target: layerTarget, groupId: "root", item: "rectangle", itemId: "item:1" },

  set_footage_interpretation: { type: "set_footage_interpretation", target: itemTarget, interpretation: { loop: 2 } },
  detect_scene_edits: { type: "detect_scene_edits", target: layerTarget, mode: "markers" },

  add_mask: { type: "add_mask", target: layerTarget, newMaskId: "__new__:mask-1", name: "Mask 1" },
  update_mask: { type: "update_mask", target: layerTarget, maskId: "mask:1", values: { opacity: 50 } },
  remove_mask: { type: "remove_mask", target: layerTarget, maskId: "mask:1", destructive: true },

  set_camera_options: { type: "set_camera_options", target: layerTarget, options: { zoom: 100 } },
  set_light_options: { type: "set_light_options", target: layerTarget, options: { intensity: 50 } },
  set_material_options: { type: "set_material_options", target: layerTarget, options: { metal: 10 } },

  set_layer_property: { type: "set_layer_property", target: layerTarget, role: "transform.position", propertyPath: "ADBE Transform Group/ADBE Position", value: 5 },
  set_layer_attribute: { type: "set_layer_attribute", target: layerTarget, role: "motion-blur", value: true },
  set_layer_name: { type: "set_layer_name", target: layerTarget, name: "Title 2" },
  set_layer_parent: { type: "set_layer_parent", target: layerTarget, parentLayerId: null },
  animate_control: { type: "animate_control", target: layerTarget, role: "effect.blur", effectMatchName: "ADBE Gaussian Blur 2" },
  animate_property: { type: "animate_property", target: layerTarget },
  set_expression: { type: "set_expression", target: layerTarget, source: "value", enabled: true },
  set_loop: { type: "set_loop", target: layerTarget, mode: "cycle" },
  create_layer: { type: "create_layer", target: layerTarget, layerType: "null", name: "Null 1" },
  set_layer_timing: { type: "set_layer_timing", target: layerTarget },
  set_audio: { type: "set_audio", target: layerTarget },
  set_time_remap: { type: "set_time_remap", target: layerTarget, enabled: true },
  derive_layer: { type: "derive_layer", target: layerTarget, kind: "split", newLayerId: "__new__:layer-2", time: 1 },
  export_frame: { type: "export_frame", target: compositionTarget, time: 1, outputPath: "/tmp/frame.png", exportAuthorization: "EXPORT_NOW" },
  save_project: { type: "save_project", snapshotFingerprint: "fp-1", selectionFingerprint: "sel-1", mode: "save_as", path: "/tmp/copy.aep" },
  tracker_to_nulls: { type: "tracker_to_nulls", target: layerTarget, trackerName: "Tracker 1" },
  save_layer_preset: { type: "save_layer_preset", target: layerTarget, outputPath: "/tmp/fx.ffx", exportAuthorization: "EXPORT_NOW" },
  switch_project: { type: "switch_project", snapshotFingerprint: "fp-1", selectionFingerprint: "sel-1", mode: "open", path: "/tmp/other.aep" },
  collect_project: { type: "collect_project", snapshotFingerprint: "fp-1", selectionFingerprint: "sel-1", destinationFolder: "/tmp/collect", projectName: "walk", exportAuthorization: "EXPORT_NOW" },
  resize_solid: { type: "resize_solid", target: layerTarget, width: 640, height: 360 },
  set_text_path: { type: "set_text_path", target: layerTarget, maskIndex: 1, firstMargin: 10 },
  open_composition: { type: "open_composition", target: compositionTarget },
  start_analysis: { type: "start_analysis", target: layerTarget, kind: "warp-stabilizer" },
  replace_layer_source: { type: "replace_layer_source", target: layerTarget, sourceItemId: "item-1" },
  center_anchor: { type: "center_anchor", target: layerTarget, time: 1 },
  copy_effects: { type: "copy_effects", target: layerTarget, source: { compositionId: "comp-main", layerId: "layer-other" }, effectPaths: ["ADBE Effect Parade/ADBE Gaussian Blur 2"] },
  set_puppet_pins: { type: "set_puppet_pins", target: layerTarget, pins: [{ x: 10, y: 20 }, { x: 30, y: 40, keyframes: [{ time: 0, x: 30, y: 40 }, { time: 1, x: 60, y: 40 }] }] },
  read_keyframes: { type: "read_keyframes", target: { ...layerTarget, propertyPath: "ADBE Transform Group/ADBE Position" }, maxKeys: 50 },
  remove_effect: { type: "remove_effect", target: { ...layerTarget, effectPath: "ADBE Effect Parade/ADBE Gaussian Blur 2" }, destructive: true },
  reorder_effect: { type: "reorder_effect", target: { ...layerTarget, effectPath: "ADBE Effect Parade/ADBE Gaussian Blur 2" }, index: 1 },
  edit_keyframes: { type: "edit_keyframes", target: { ...layerTarget, propertyPath: "ADBE Transform Group/ADBE Position" }, action: "move", times: [1], offset: 0.5 },
  retime_layer: { type: "retime_layer", target: layerTarget, mode: "reverse" },
  dolly_camera: { type: "dolly_camera", target: layerTarget, keyframes: [{ time: 0, distance: 2667, curve: "ease-in-out" }, { time: 5, distance: 2200 }] },
  duplicate_layer: { type: "duplicate_layer", target: layerTarget, newLayerId: "__new__:layer-1" },
  remove_layer: { type: "remove_layer", target: layerTarget, destructive: true },
  reorder_layer: { type: "reorder_layer", target: layerTarget, placement: "beginning" },
  set_track_matte: { type: "set_track_matte", target: layerTarget, matteLayerId: null, mode: "alpha" },
  add_marker: { type: "add_marker", target: layerTarget, time: 0 },
  update_marker: { type: "update_marker", target: layerTarget, time: 0 },
  remove_marker: { type: "remove_marker", target: layerTarget, time: 0, destructive: true },
  duplicate_composition: { type: "duplicate_composition", target: compositionTarget, newCompositionId: "__new__:comp-2", name: "Run Cycle" },
  precompose_layers: { type: "precompose_layers", target: compositionTarget, layerIds: ["layer-title"], name: "Precomp 1", newCompositionId: "__new__:comp-1", newLayerId: "__new__:layer-2" },

  create_folder: { type: "create_folder", newFolderId: "__new__:folder-1", snapshotFingerprint: "fp-1", selectionFingerprint: "sel-1", name: "Folder 1" },
  set_item_name: { type: "set_item_name", target: itemTarget, name: "Item 1" },
  move_item_to_folder: { type: "move_item_to_folder", target: itemTarget, folderId: null },
  delete_project_item: { type: "delete_project_item", target: itemTarget, destructive: true },
  import_file: { type: "import_file", newItemId: "__new__:item-2", snapshotFingerprint: "fp-1", selectionFingerprint: "sel-1", path: "/tmp/clip.mov" },
  create_vector_artwork: { type: "create_vector_artwork", newItemId: "__new__:vector-1", snapshotFingerprint: "fp-1", selectionFingerprint: "sel-1", name: "Vector", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M0 0L1 1\"/></svg>", sourceHash: "a".repeat(64), metadata: { bytes: 74, elements: 2, maxDepth: 1, pathCommands: 2, gradientStops: 0, gradients: 0, masks: 0, clipPaths: 0, sourceHash: "a".repeat(64) }, importMode: "editable", managedSourcePolicy: "retain" },
  replace_footage: { type: "replace_footage", target: itemTarget, path: "/tmp/clip.mov" },
  set_footage_proxy: { type: "set_footage_proxy", target: itemTarget, path: "/tmp/proxy.mov" },
  clear_footage_proxy: { type: "clear_footage_proxy", target: itemTarget },

  create_composition: { type: "create_composition", newCompositionId: "__new__:comp-1", snapshotFingerprint: "fp-1", selectionFingerprint: "sel-1", name: "Comp 1", width: 1920, height: 1080, durationSeconds: 5, frameRate: 30 },
  set_composition_settings: { type: "set_composition_settings", target: compositionTarget, settings: { width: 1920 } },
  render_composition: { type: "render_composition", compositionId: "comp-main", snapshotFingerprint: "fp-1", selectionFingerprint: "sel-1", outputPath: "/tmp/out.mov", destinationPolicy: "explicit-local-path" },
  export_mogrt: { type: "export_mogrt", target: compositionTarget, templateName: "Template 1", outputPath: "/tmp/template.mogrt", exportAuthorization: "EXPORT_NOW" },
  set_composition_guides: { type: "set_composition_guides", target: compositionTarget, guides: [{ orientation: "horizontal", position: 100 }] },
  set_project_settings: { type: "set_project_settings", snapshotFingerprint: "fp-1", selectionFingerprint: "sel-1", settings: { bitsPerChannel: 16 } },
  cleanup_project: { type: "cleanup_project", snapshotFingerprint: "fp-1", selectionFingerprint: "sel-1", mode: "remove_unused_footage", destructive: true },
  add_essential_property: { type: "add_essential_property", target: layerTarget },
};

function planWith(operations: ActionPlanV2Operation[]): ActionPlanV2 {
  return { schemaVersion: "0.2", planId: "plan-1", snapshotFingerprint: "fp-1", selectionFingerprint: "sel-1", freshness: { revision: "1", capturedAt: "2026-09-21T00:00:00.000Z" }, summary: "Dispatch", requiresApproval: true, bounds: { maxOperations: 64 }, preconditions: [], conflicts: [], postconditions: [], digest: "digest", operations };
}

test("duplicate_composition compiles to the source composition, the copy's placeholder and the optional name", () => {
  const named = compileV2Plan(planWith([MINIMAL_OPERATIONS.duplicate_composition]));
  assert.ok(!("ok" in named));
  assert.deepEqual(named.operations, [{ operation: "duplicate_composition", compositionId: "comp-main", newCompositionId: "__new__:comp-2", name: "Run Cycle" }]);
  const unnamed = compileV2Plan(planWith([{ type: "duplicate_composition", target: compositionTarget, newCompositionId: "__new__:comp-3" }]));
  assert.ok(!("ok" in unnamed));
  assert.deepEqual(unnamed.operations, [{ operation: "duplicate_composition", compositionId: "comp-main", newCompositionId: "__new__:comp-3" }]);
});

test("every v0.2 operation kind compiles to its host operation", () => {
  for (const [type, operation] of Object.entries(MINIMAL_OPERATIONS)) {
    const result = compileV2Plan(planWith([operation]));
    assert.equal("ok" in result, false, `${type} was refused`);
    if ("ok" in result) continue;
    assert.deepEqual(result.operations.map((compiled) => compiled.operation), [type === "set_loop" ? "set_expression" : type]);
  }
});

test("dolly_camera reaches the host as distances with the curve preset resolved to control points, and no coordinates", () => {
  const result = compileV2Plan(planWith([MINIMAL_OPERATIONS.dolly_camera]));
  assert.equal("ok" in result, false);
  if ("ok" in result) return;
  const [compiled] = result.operations;
  assert.equal(compiled?.operation, "dolly_camera");
  if (compiled?.operation !== "dolly_camera") return;
  assert.deepEqual(compiled.keyframes.map((key) => key.distance), [2667, 2200]);
  assert.equal(typeof compiled.keyframes[0]?.curve?.x1, "number");
  assert.equal(compiled.keyframes[1]?.curve, undefined);
  assert.equal(Object.hasOwn(compiled, "propertyPath"), false);
});

test("only a plan longer than the undo batch size carries a batch size", () => {
  const operation = MINIMAL_OPERATIONS.set_layer_name;
  const overBatch = compileV2Plan(planWith(Array.from({ length: PLAN_UNDO_BATCH_SIZE + 1 }, () => operation)));
  assert.equal("ok" in overBatch, false);
  if ("ok" in overBatch) return;
  assert.equal(overBatch.operations.length, PLAN_UNDO_BATCH_SIZE + 1);
  assert.equal(overBatch.batchSize, PLAN_UNDO_BATCH_SIZE);
  assert.equal(overBatch.undoGroup, "extynt — plan-1");
  const exactBatch = compileV2Plan(planWith(Array.from({ length: PLAN_UNDO_BATCH_SIZE }, () => operation)));
  assert.equal("ok" in exactBatch, false);
  if ("ok" in exactBatch) return;
  assert.equal(Object.hasOwn(exactBatch, "batchSize"), false);
});

const PATHLESS_WRITES: Array<[ActionPlanV2Operation, string]> = [
  [{ type: "set_effect_control", target: snapshotLayerTarget, effectMatchName: "ADBE Gaussian Blur 2", value: 20 }, "INVALID_TARGET"],
  [{ type: "animate_control", target: snapshotLayerTarget, effectMatchName: "ADBE Gaussian Blur 2", role: "effect.blur", keyframes: [{ time: 0, value: 1 }] }, "INVALID_TARGET"],
  [{ type: "animate_property", target: snapshotLayerTarget, role: "transform.position", keyframes: [{ time: 0, value: 1 }] }, "INVALID_TARGET"],
  [{ type: "set_expression", target: snapshotLayerTarget, source: "value", enabled: true }, "INVALID_OPERATION"],
  [{ type: "set_loop", target: snapshotLayerTarget, mode: "cycle" }, "INVALID_TARGET"],
  [{ type: "add_essential_property", target: snapshotLayerTarget }, "INVALID_TARGET"],
];

function snapshotPlan(operations: ActionPlanV2Operation[]): ActionPlanV2 {
  const plan: ActionPlanV2 = { schemaVersion: "0.2", planId: "plan-pathless", snapshotFingerprint: snapshot.fingerprint, selectionFingerprint: snapshot.selectionFingerprint, freshness: snapshot.freshness, summary: "Pathless write", requiresApproval: true, bounds: { maxOperations: 8 }, preconditions: [], conflicts: [], postconditions: [], digest: "", operations };
  plan.digest = computePlanDigest(plan);
  return plan;
}

function approvalFor(plan: ActionPlanV2): ApprovalBinding {
  return { planId: plan.planId, snapshotFingerprint: plan.snapshotFingerprint, selectionFingerprint: plan.selectionFingerprint, freshness: plan.freshness, approvedAt: "2026-09-21T00:00:00.000Z", approvalId: "approval-1", panelSessionId: "panel-1", oneTime: true };
}

test("a property write without target.propertyPath is refused before the host compiler sees it", () => {
  for (const [operation, code] of PATHLESS_WRITES) {
    const plan = snapshotPlan([operation]);
    const result = compileCommand(plan, snapshot, approvalFor(plan));
    assert.equal("ok" in result && result.code, code, `${operation.type} reached the host without a property path`);
  }
});

function compiledOperations(operations: ActionPlanV2Operation[]): HostPlanCommand["operations"] {
  const compiled = compileV2Plan(planWith(operations));
  assert.equal("ok" in compiled, false);
  return "ok" in compiled ? [] : compiled.operations;
}

function layerIdOf(operation: HostPlanCommand["operations"][number] | undefined): string | undefined {
  return operation !== undefined && "layerId" in operation ? operation.layerId : undefined;
}

test("a composition marker compiles without a layerId and a layer marker keeps its layerId", () => {
  const [compositionAdd, compositionRemove, layerAdd] = compiledOperations([
    { type: "add_marker", target: compositionTarget, time: 1, comment: "Beat" },
    { type: "remove_marker", target: compositionTarget, time: 1, destructive: true },
    { type: "add_marker", target: layerTarget, time: 2, comment: "Cue" },
  ]);
  assert.deepEqual([compositionAdd?.operation, layerIdOf(compositionAdd)], ["add_marker", undefined]);
  assert.deepEqual([compositionRemove?.operation, layerIdOf(compositionRemove)], ["remove_marker", undefined]);
  assert.deepEqual([layerAdd?.operation, layerIdOf(layerAdd)], ["add_marker", "layer-title"]);
});

test("the work area, motion blur and renderer settings pass through to the host unchanged", () => {
  const settings = { workAreaStart: 1, workAreaDuration: 4, motionBlur: true, shutterAngle: 180, shutterPhase: -90, motionBlurSamplesPerFrame: 16, motionBlurAdaptiveSampleLimit: 128, renderer: "Advanced 3D" };
  const [compiled] = compiledOperations([{ type: "set_composition_settings", target: compositionTarget, settings }]);
  assert.equal(compiled?.operation, "set_composition_settings");
  if (compiled?.operation !== "set_composition_settings") return;
  assert.deepEqual(compiled.settings, settings);
});
