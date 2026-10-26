// Plan acceptance and refusal across operation families: masks, project items, shape groups, 3D options, composition settings and plan bounds.
import assert from "node:assert/strict";
import test from "node:test";
import { representativeSnapshot, type ProjectItemSnapshot, type ProjectSnapshot } from "@extynt/project-graph";
import { type JsonObject } from "@extynt/decode";
import { fingerprints, target } from "./fixtures.js";
import { assertOperations, assertSequences, refusal, verdict } from "./plan-builders.js";

const compTarget = { compositionId: "comp-main", ...fingerprints } satisfies JsonObject;

test("a mask lifecycle is accepted after its add placeholder", () => {
  const added = { type: "add_mask", target, newMaskId: "__new__:mask0", name: "Reveal", values: { opacity: 80 } } satisfies JsonObject;
  const update = { type: "update_mask", target, maskId: "__new__:mask0", values: { feather: [3, 4] } } satisfies JsonObject;
  const remove = { type: "remove_mask", target, maskId: "__new__:mask0", destructive: true } satisfies JsonObject;
  assertSequences([["ok", [added, update, remove]], ["TARGET_NOT_FOUND", [update]]]);
});

test("remove_mask needs the destructive confirmation", () => {
  assertOperations([["DESTRUCTIVE_CONFIRMATION_REQUIRED", { type: "remove_mask", target, maskId: "mask:1", destructive: false }]]);
});

test("delete_project_item needs the destructive confirmation", () => {
  const item = { id: "comp-main", name: "Main", type: "composition", parentFolderId: null, compositionId: "comp-main", sourceId: null } satisfies ProjectItemSnapshot;
  const snapshot: ProjectSnapshot = { ...representativeSnapshot, items: [item] };
  const itemTarget = { itemId: "comp-main", ...fingerprints } satisfies JsonObject;
  assertOperations([
    ["ok", { type: "delete_project_item", target: itemTarget, destructive: true }],
    ["DESTRUCTIVE_CONFIRMATION_REQUIRED", { type: "delete_project_item", target: itemTarget, destructive: false }],
  ], { snapshot });
});

test("delete_project_item refuses an item the plan referenced earlier", () => {
  const item = { id: "comp-main", name: "Main", type: "composition", parentFolderId: null, compositionId: "comp-main", sourceId: null } satisfies ProjectItemSnapshot;
  const itemTarget = { itemId: "comp-main", ...fingerprints } satisfies JsonObject;
  const rename = { type: "set_item_name", target: itemTarget, name: "Used first" } satisfies JsonObject;
  const remove = { type: "delete_project_item", target: itemTarget, destructive: true } satisfies JsonObject;
  assertSequences([["ITEM_REFERENCED_EARLIER", [rename, remove]]], { snapshot: { ...representativeSnapshot, items: [item] } });
});

const group = { type: "create_shape_group", target, newGroupId: "__new__:shape0", name: "Badge" } satisfies JsonObject;
const path = { type: "set_shape_path", target, groupId: "__new__:shape0", path: { vertices: [[0, 0], [100, 0], [100, 100]], closed: true } } satisfies JsonObject;
const fill = { type: "ensure_shape_fill", target, groupId: "__new__:shape0", color: [1, 0, 0] } satisfies JsonObject;
const stroke = { type: "ensure_shape_stroke", target, groupId: "__new__:shape0", color: [0, 0, 0], width: 2 } satisfies JsonObject;

test("a shape group lifecycle is accepted after its typed placeholder", () => {
  assertSequences([["ok", [group, path, fill, stroke]], ["TARGET_NOT_FOUND", [fill]]], { bounds: { maxOperations: 4 } });
});

test("shape paths and strokes refuse malformed geometry", () => {
  const options = { bounds: { maxOperations: 4 } };
  assertSequences([
    ["INVALID_VALUE", [group, { ...path, path: { vertices: [[0, 0]], inTangents: [[0, 0], [1, 1]], closed: false } }]],
    ["INVALID_VALUE", [group, { ...path, path: { vertices: [[Number.POSITIVE_INFINITY, 0]], closed: false } }]],
    ["INVALID_VALUE", [{ ...stroke, groupId: "shape:1", width: 0 }]],
  ], options);
});

test("camera, light and material options are bounded and typed", () => {
  assertOperations([
    ["ok", { type: "set_camera_options", target, options: { zoom: 2000, depthOfField: true } }],
    ["ok", { type: "set_light_options", target, options: { intensity: 500, color: [1, 0, 0] } }],
    ["ok", { type: "set_material_options", target, options: { metal: 25, acceptsShadows: false } }],
    ["INVALID_VALUE", { type: "set_camera_options", target, options: { propertyPath: "ADBE Camera Zoom" } }],
  ]);
});

test("composition settings are bounded and time remap is typed", () => {
  assertOperations([
    ["ok", { type: "set_composition_settings", target: compTarget, settings: { width: 1280, height: 720, frameRate: 24 } }],
    ["ok", { type: "set_time_remap", target, enabled: true }],
    ["INVALID_VALUE", { type: "set_composition_settings", target: compTarget, settings: { width: 9000 } }],
  ]);
});

test("guide and template export operation names are refused", () => {
  assert.notEqual(verdict([{ type: "set_composition_display", compositionId: "comp-main", ...fingerprints, guides: [] }]), "ok");
  assert.notEqual(verdict([{ type: "export_motion_graphics_template", compositionId: "comp-main", ...fingerprints, templateName: "Title", authorization: "EXPORT_MOGRT" }]), "ok");
});

test("animation limits are labelled in seconds", () => {
  const animation = { type: "animate_property", target: { ...target, propertyPath: "ADBE Transform Group/ADBE Position" }, role: "transform.position", keyframes: [{ time: 31, value: [0, 0] }] } satisfies JsonObject;
  assert.equal(refusal([animation], { bounds: { maxOperations: 1, maxKeyframeTimeSeconds: 30 } }).code, "BOUNDS_EXCEEDED");
  assert.equal(refusal([animation], { bounds: { maxOperations: 1, maxDurationMs: 30 } }).code, "INVALID_PLAN");
});
