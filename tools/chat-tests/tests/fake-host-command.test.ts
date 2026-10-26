/** A flattened host command, translated into the plan vocabulary and applied end to end. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LayerSnapshot, PropertySnapshot } from "@extynt/project-graph";
import { planOperationsFromHostCommand } from "../src/fake-host-translate.js";
import { apply, fixture, layerOf, OPACITY, POSITION, propertyOf, requiredChild, requiredLayerChild } from "./fake-host-fixture.js";

describe("fake-host: the host command form", () => {
  it("translates a flattened host command into the plan vocabulary without losing a field", translatesAFlattenedHostCommand);
  it("applies a compiled host command end to end, keyframes included", appliesACompiledHostCommand);
  it("keeps an unmodelled host operation visible and refuses it by name", keepsAnUnmodelledHostOperationVisible);
  it("refuses a shape-item path it cannot resolve instead of dropping it", refusesAnUnresolvableShapeItemPath);
  it("leaves nothing half-written when one of several settings is refused", leavesNothingHalfWritten);
});

function translatesAFlattenedHostCommand(): void {
  const translated = planOperationsFromHostCommand([
    { operation: "set_layer_name", compositionId: "comp-main", layerId: "layer-title", name: "Renamed" },
    { operation: "create_layer", compositionId: "__new__:c1", layerId: "__new__:l1", layerType: "solid", name: "Plate", color: [1, 0, 0], size: [100, 50] },
    { operation: "set_effect_control", compositionId: "comp-main", layerId: "layer-title", effectMatchName: "ADBE Glo2", propertyPath: "ADBE Effect Parade/ADBE Glo2/ADBE Glo2-0002", value: 42 },
    { operation: "ensure_effect", compositionId: "comp-main", layerId: "layer-title", capabilityId: "adobe.glow", effectMatchName: "ADBE Glo2", effectPath: "ADBE Effect Parade/ADBE Glo2", enabled: true },
    { operation: "set_layer_attribute", compositionId: "comp-main", layerId: "layer-title", role: "label", value: 5, hostProperty: "label" },
    { operation: "set_composition_settings", compositionId: "comp-main", settings: { width: 1000 } },
    { operation: "create_composition", newCompositionId: "__new__:c1", name: "Overlay", width: 1080, height: 1080, durationSeconds: 6, frameRate: 30 },
  ]);

  assert.deepEqual(translated[0], { type: "set_layer_name", target: { compositionId: "comp-main", layerId: "layer-title" }, name: "Renamed" });
  assert.deepEqual(translated[1], { type: "create_layer", target: { compositionId: "__new__:c1", layerId: "__new__:l1" }, layerType: "solid", name: "Plate", color: [1, 0, 0], size: [100, 50] });
  assert.deepEqual(translated[2], { type: "set_effect_control", effectMatchName: "ADBE Glo2", target: { compositionId: "comp-main", layerId: "layer-title", propertyPath: "ADBE Effect Parade/ADBE Glo2/ADBE Glo2-0002" }, value: 42 });
  assert.deepEqual(translated[3], { type: "ensure_effect", capabilityId: "adobe.glow", effectMatchName: "ADBE Glo2", enabled: true, target: { compositionId: "comp-main", layerId: "layer-title", effectPath: "ADBE Effect Parade/ADBE Glo2" } });
  assert.equal(translated[4]?.hostProperty, "label");
  assert.deepEqual(translated[5], { type: "set_composition_settings", settings: { width: 1000 }, target: { compositionId: "comp-main" } });
  assert.deepEqual(translated[6], { type: "create_composition", newCompositionId: "__new__:c1", name: "Overlay", width: 1080, height: 1080, durationSeconds: 6, frameRate: 30 });

  assert.deepEqual(planOperationsFromHostCommand(translated), translated);
}

function appliesACompiledHostCommand(): void {
  const input = fixture();
  const command = [
    { operation: "create_composition", newCompositionId: "__new__:c1", name: "Overlay", width: 1080, height: 1080, durationSeconds: 6, frameRate: 30 },
    { operation: "create_layer", compositionId: "__new__:c1", layerId: "__new__:l1", layerType: "null", name: "Control" },
    { operation: "set_layer_name", compositionId: "__new__:c1", layerId: "__new__:l1", name: "Control Null" },
    { operation: "set_layer_property", compositionId: "__new__:c1", layerId: "__new__:l1", propertyPath: "ADBE Transform Group/ADBE Position", role: "transform.position", value: [540, 540] },
    { operation: "animate_property", compositionId: "__new__:c1", layerId: "__new__:l1", propertyPath: "ADBE Transform Group/ADBE Opacity", keyframes: [{ time: 0, value: 0, curve: { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 } }, { time: 1, value: 100 }] },
    { operation: "set_effect_control", compositionId: "comp-main", layerId: "layer-title", effectMatchName: "ADBE Glo2", propertyPath: "ADBE Effect Parade/ADBE Glo2/ADBE Glo2-0002", value: 42 },
    { operation: "add_shape_item", compositionId: "comp-main", layerId: "layer-accent", groupId: "shape:1", itemMatchName: "ADBE Vector Shape - Rect", newItemId: "__new__:r1", writes: [{ path: "ADBE Vector Rect Size", value: [20, 10] }], animations: [{ path: "ADBE Vector Rect Position", keyframes: [{ time: 0, value: [0, 0] }, { time: 1, value: [5, 5] }] }] },
  ];
  const result = apply(input, planOperationsFromHostCommand(command));

  assert.deepEqual(result.verdicts.map((verdict) => `${verdict.index}:${verdict.ok}:${verdict.code ?? ""}`), ["0:true:", "1:true:", "2:true:", "3:true:", "4:true:", "5:true:", "6:true:"]);
  const overlay = result.snapshot.compositions.find((candidate) => candidate.name === "Overlay");
  assert.ok(overlay);
  assert.match(overlay.id, /^fx-comp-[0-9]+$/);
  const [control] = overlay.layers;
  assert.ok(control);
  assert.match(control.id, /^fx-layer-[0-9]+$/, "the placeholder layerId became the id the fixture minted");
  assert.equal(control.name, "Control Null", "the rename targeted the same layer");
  assert.deepEqual(propertyOf(control, POSITION).value, [540, 540]);
  const opacity = propertyOf(control, OPACITY);
  assert.deepEqual(opacity.keyframes, [
    { time: 0, value: 0, curve: { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 } },
    { time: 1, value: 100 },
  ], "the compiled keyframes, curve and all, reached the property");

  assert.equal(propertyOf(layerOf(result.snapshot, "comp-main", "layer-title"), "ADBE Effect Parade/ADBE Glo2/ADBE Glo2-0002").value, 42);

  assertHostFormShapeItem(layerOf(result.snapshot, "comp-main", "layer-accent"));
}

function assertHostFormShapeItem(accent: LayerSnapshot): void {
  const root = requiredLayerChild(accent, "ADBE Root Vectors Group", `layer ${accent.id} should carry a vectors root`);
  const rectangles: PropertySnapshot[] = [];
  const visit = (property: PropertySnapshot): void => {
    if (property.matchName === "ADBE Vector Shape - Rect") rectangles.push(property);
    for (const child of property.children ?? []) visit(child);
  };
  visit(root);
  const rectangle = rectangles.find((candidate) => {
    const size = requiredChild(candidate, "ADBE Vector Rect Size", "every rectangle should carry a size").value;
    return Array.isArray(size) && size[0] === 20;
  });
  assert.ok(rectangle, "the host-form shape item should have been created");
  assert.deepEqual(requiredChild(rectangle, "ADBE Vector Rect Size", "the item should carry a size").value, [20, 10], "writes became the plan's values");
  assert.deepEqual(requiredChild(rectangle, "ADBE Vector Rect Position", "the item should carry a position").keyframes, [{ time: 0, value: [0, 0] }, { time: 1, value: [5, 5] }], "animations became the plan's keyframes");
}

function keepsAnUnmodelledHostOperationVisible(): void {
  const input = fixture();
  const command = [
    { operation: "set_project_settings", settings: { bitsPerChannel: 16 } },
    { operation: "render_composition", compositionId: "comp-main", outputPath: "/tmp/out.mov", destinationPolicy: "explicit-local-path" },
    { operation: "set_audio", compositionId: "comp-main", layerId: "layer-title", enabled: false },
    { operation: "apply_preset", compositionId: "comp-main", layerId: "layer-title", presetId: "preset:ae-presets:0123456789abcdef0123", presetPath: "/tmp/preset.ffx" },
    { operation: "set_item_name", itemId: "item-1", name: "Renamed item" },
  ];
  const translated = planOperationsFromHostCommand(command);
  assert.equal(translated[3]?.presetPath, "/tmp/preset.ffx");
  assert.deepEqual(translated[4]?.target, { itemId: "item-1" });

  const result = apply(input, translated);
  assert.deepEqual(result.verdicts.map((verdict) => verdict.type), ["set_project_settings", "render_composition", "set_audio", "apply_preset", "set_item_name"]);
  for (const verdict of result.verdicts) {
    assert.equal(verdict.ok, false, `${verdict.type} must be refused`);
    assert.equal(verdict.code, "UNSUPPORTED_IN_FIXTURE");
    assert.match(verdict.message ?? "", new RegExp(verdict.type), `${verdict.type} must be named in its refusal`);
  }
  assert.equal(result.mutated, false);
  assert.deepEqual(result.snapshot, input, "a refused operation leaves the project exactly as it was");
}

function assertShapeItemRefused(itemMatchName: string, newItemId: string, writes: readonly { path: string; value: number | number[] }[], named: RegExp): void {
  const input = fixture();
  const result = apply(input, planOperationsFromHostCommand([
    { operation: "add_shape_item", compositionId: "comp-main", layerId: "layer-accent", groupId: "shape:1", itemMatchName, newItemId, writes, animations: [] },
  ]));
  assert.equal(result.verdicts[0]?.ok, false);
  assert.equal(result.verdicts[0]?.code, "INVALID_VALUE");
  assert.match(result.verdicts[0]?.message ?? "", named);
  assert.equal(result.mutated, false);
  assert.deepEqual(result.snapshot, input, "the item is not created when one of its writes cannot be resolved");
}

function refusesAnUnresolvableShapeItemPath(): void {
  assertShapeItemRefused("ADBE Vector Shape - Rect", "__new__:r1", [{ path: "ADBE Vector Rect Size", value: [20, 10] }, { path: "ADBE Vector Not A Setting", value: 1 }], /ADBE Vector Not A Setting/);
  assertShapeItemRefused("ADBE Vector Shape - Trapezoid", "__new__:r2", [{ path: "ADBE Vector Rect Size", value: [1, 1] }], /ADBE Vector Shape - Trapezoid/);
}

function leavesNothingHalfWritten(): void {
  const input = fixture();
  const result = apply(input, [
    { type: "set_composition_settings", target: { compositionId: "comp-main" }, settings: { width: 1000, frameRate: 500 } },
  ]);
  assert.equal(result.verdicts[0]?.ok, false);
  assert.equal(result.verdicts[0]?.code, "INVALID_VALUE");
  assert.match(result.verdicts[0]?.message ?? "", /frameRate/);
  assert.equal(result.mutated, false);
  assert.deepEqual(result.snapshot, input);
}
