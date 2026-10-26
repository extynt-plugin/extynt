// Layer, project and export operations: layer creation and attributes, removal ordering, MOGRT export, guides and project settings.
import assert from "node:assert/strict";
import test from "node:test";
import { representativeSnapshot, type ProjectItemSnapshot, type ProjectSnapshot } from "@extynt/project-graph";
import { type JsonObject } from "@extynt/decode";
import { compositionTarget, fingerprints, target } from "./fixtures.js";
import { assertOperations, assertSequences, verdict } from "./plan-builders.js";

const removeTitle = { type: "remove_layer", target, destructive: true } satisfies JsonObject;
const rebuilt = { ...target, layerId: "__new__:rebuilt" } satisfies JsonObject;
const createRebuilt = { type: "create_layer", target: rebuilt, layerType: "null", name: "Rebuilt" } satisfies JsonObject;
const removeRebuilt = { type: "remove_layer", target: rebuilt, destructive: true } satisfies JsonObject;

function mogrt(extra: JsonObject): JsonObject {
  return { type: "export_mogrt", target: compositionTarget, templateName: "Title", outputPath: "/templates/title.mogrt", ...extra };
}

function reorder(referenceLayerId: string): JsonObject {
  return { type: "reorder_layer", target, placement: "before", referenceLayerId };
}

test("export_mogrt requires EXPORT_NOW and a .mogrt path", () => {
  assertOperations([
    ["ok", mogrt({ exportAuthorization: "EXPORT_NOW" })],
    ["EXPORT_AUTHORIZATION_REQUIRED", mogrt({})],
    ["INVALID_VALUE", mogrt({ outputPath: "/templates/title.mov", exportAuthorization: "EXPORT_NOW" })],
  ]);
});

test("export_mogrt takes absolute Windows paths and refuses relative ones", () => {
  const rows = (paths: readonly string[], expected: string) => paths.map((outputPath): readonly [string, JsonObject] => [expected, mogrt({ outputPath, exportAuthorization: "EXPORT_NOW" })]);
  assertOperations(rows(["C:/Users/x/supplement.mogrt", "C:\\Users\\x\\a.mogrt"], "ok"));
  assertOperations(rows(["templates/title.mogrt", "C:/Users/x/title.mov", "C:title.mogrt"], "INVALID_VALUE"));
});

test("set_composition_guides needs replace to clear and accepts a horizontal guide", () => {
  assertOperations([
    ["ok", { type: "set_composition_guides", target: compositionTarget, guides: [{ orientation: "horizontal", position: 100 }] }],
    ["ok", { type: "set_composition_guides", target: compositionTarget, guides: [], replace: true }],
    ["INVALID_VALUE", { type: "set_composition_guides", target: compositionTarget, guides: [] }],
  ]);
});

test("set_project_settings bounds the bit depth", () => {
  assertOperations([
    ["ok", { type: "set_project_settings", ...fingerprints, settings: { bitsPerChannel: 16, linearBlending: true } }],
    ["INVALID_VALUE", { type: "set_project_settings", ...fingerprints, settings: { bitsPerChannel: 24 } }],
  ]);
});

test("set_layer_attribute accepts quality DRAFT and blend modes, and refuses invalid values", () => {
  assertOperations([
    ["ok", { type: "set_layer_attribute", target, role: "quality", value: "DRAFT" }],
    ["ok", { type: "set_layer_attribute", target, role: "blend-mode", value: "COLOR_BURN" }],
    ["INVALID_VALUE", { type: "set_layer_attribute", target, role: "quality", value: "ULTRA" }],
    ["INVALID_VALUE", { type: "set_layer_attribute", target, role: "blend-mode", value: "NOT_A_MODE" }],
  ]);
});

test("create_layer builds a solid with color and size and a footage layer from an item", () => {
  const created = (layerId: string, extra: JsonObject): JsonObject => ({ type: "create_layer", target: { ...compositionTarget, layerId }, ...extra });
  assertOperations([
    ["ok", created("__new__:solid0", { layerType: "solid", name: "Solid", color: [1, 0, 0, 1], size: [1920, 1080] })],
    ["ok", created("__new__:footage0", { layerType: "footage", name: "Footage", sourceItemId: "comp-square" })],
    ["TARGET_NOT_FOUND", created("__new__:footage0", { layerType: "footage", name: "Bad footage", sourceItemId: "no-such-item" })],
  ]);
});

test("a later operation cannot target a layer an earlier remove_layer removed", () => {
  const position = { type: "animate_property", target: { ...target, propertyPath: "ADBE Transform Group/ADBE Position" }, keyframes: [{ time: 0, value: [0, 0] }] } satisfies JsonObject;
  assertSequences([
    ["TARGET_NOT_FOUND", [removeTitle, { type: "set_layer_name", target, name: "Gone" }]],
    ["TARGET_NOT_FOUND", [removeTitle, position]],
  ], { bounds: { maxOperations: 3 } });
});

test("a layer id is live again when a later operation re-creates it", () => {
  assertSequences([
    ["ok", [createRebuilt, removeRebuilt, createRebuilt]],
    ["TARGET_NOT_FOUND", [createRebuilt, removeRebuilt, { type: "set_layer_name", target: rebuilt, name: "Third" }]],
  ], { bounds: { maxOperations: 3 } });
});

test("a later operation cannot target a project item an earlier delete_project_item removed", () => {
  const item = { id: "comp-main", name: "Main", type: "composition", parentFolderId: null, compositionId: "comp-main", sourceId: null } satisfies ProjectItemSnapshot;
  const snapshot: ProjectSnapshot = { ...representativeSnapshot, items: [item] };
  const itemTarget = { itemId: "comp-main", ...fingerprints } satisfies JsonObject;
  assertSequences([["TARGET_NOT_FOUND", [{ type: "delete_project_item", target: itemTarget, destructive: true }, { type: "set_item_name", target: itemTarget, name: "Deleted" }]]], { snapshot, bounds: { maxOperations: 2 } });
});

test("reorder_layer accepts a reference layer in the composition", () => {
  assert.equal(verdict([reorder("layer-footage")], { bounds: { maxOperations: 2 } }), "ok");
  const planned = { type: "create_layer", target: { ...compositionTarget, layerId: "__new__:reorder-ref" }, layerType: "null", name: "Reference" } satisfies JsonObject;
  assert.equal(verdict([planned, reorder("__new__:reorder-ref")], { bounds: { maxOperations: 2 } }), "ok");
});

test("reorder_layer refuses a reference layer that is missing, empty, or in another composition", () => {
  assertOperations([
    ["TARGET_NOT_FOUND", reorder("layer-does-not-exist")],
    ["TARGET_NOT_FOUND", reorder("")],
    ["TARGET_NOT_FOUND", reorder("layer-social-title")],
  ], { bounds: { maxOperations: 2 } });
});

test("set_composition_settings width and height must be whole numbers", () => {
  const settings = (value: JsonObject): readonly [string, JsonObject] => ["INVALID_VALUE", { type: "set_composition_settings", target: compositionTarget, settings: value }];
  assertOperations([
    ["ok", { type: "set_composition_settings", target: compositionTarget, settings: { width: 1920, height: 1080, frameRate: 23.976 } }],
    ["ok", { type: "set_composition_settings", target: compositionTarget, settings: { width: 4, height: 8192 } }],
    settings({ width: 1920.5 }),
    settings({ height: 4.000000001 }),
    settings({ width: 3.5 }),
    settings({ width: 8192.5 }),
  ]);
});
