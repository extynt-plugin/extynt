/** The rest of the fixture host's modelled surface: shapes, effects, mattes, the coverage split and the composition timeline. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findProperty, flattenProperties, type LayerSnapshot, type ProjectSnapshot, type PropertySnapshot } from "@extynt/project-graph";
import { fixtureOperationCoverage } from "../src/fake-host.js";
import { apply, compositionOf, fixture, layerOf, propertyOf, requiredChild, requiredLayerChild } from "./fake-host-fixture.js";

describe("fake-host: the modelled surface", () => {
  it("applies the rest of the modelled surface where a later inspection reads it", appliesTheRestOfTheModelledSurface);
  it("applies the composition timeline settings and composition markers where a later inspection reads them", appliesCompositionTimeline);
  it("refuses every plan type it does not model, and claims every type it does", refusesEveryUnmodelledPlanType);
});

function appliesTheRestOfTheModelledSurface(): void {
  const input = fixture();
  const result = apply(input, [
    { type: "set_composition_settings", target: { compositionId: "comp-main" }, settings: { width: 1280, height: 720, durationSeconds: 8, backgroundColor: [0.1, 0.2, 0.3] } },
    { type: "set_text_document", target: { compositionId: "comp-main", layerId: "layer-title" }, text: "Summer 2026" },
    { type: "set_expression", target: { compositionId: "comp-main", layerId: "layer-title", propertyPath: "ADBE Effect Parade/ADBE Glo2/ADBE Glo2-0002" }, source: "time * 8", enabled: true },
    { type: "create_shape_group", target: { compositionId: "comp-main", layerId: "layer-accent" }, newGroupId: "__new__:group", name: "Badge" },
    { type: "add_shape_item", target: { compositionId: "comp-main", layerId: "layer-accent" }, groupId: "__new__:group", item: "rectangle", newItemId: "__new__:rect", values: { size: [20, 10] } },
    { type: "set_shape_path", target: { compositionId: "comp-main", layerId: "layer-accent" }, groupId: "__new__:group", path: { vertices: [[0, 0], [20, 0], [20, 10]], closed: true } },
    { type: "ensure_shape_fill", target: { compositionId: "comp-main", layerId: "layer-accent" }, groupId: "__new__:group", color: [1, 0.5, 0], opacity: 80 },
    { type: "ensure_shape_stroke", target: { compositionId: "comp-main", layerId: "layer-accent" }, groupId: "__new__:group", color: [0, 0, 0], width: 3 },
    { type: "ensure_effect", target: { compositionId: "comp-main", layerId: "layer-accent" }, capabilityId: "adobe.gaussian-blur", effectMatchName: "ADBE Gaussian Blur 2", effectPath: "ADBE Effect Parade/ADBE Gaussian Blur 2", enabled: true },
    { type: "set_effect_control", target: { compositionId: "comp-main", layerId: "layer-accent", effectPath: "ADBE Effect Parade/ADBE Gaussian Blur 2", propertyPath: "ADBE Effect Parade/ADBE Gaussian Blur 2/ADBE Gaussian Blur 2-0001" }, effectMatchName: "ADBE Gaussian Blur 2", value: 30 },
    { type: "set_track_matte", target: { compositionId: "comp-main", layerId: "layer-accent" }, matteLayerId: "layer-plate", mode: "alpha" },
    { type: "reorder_layer", target: { compositionId: "comp-main", layerId: "layer-accent" }, placement: "beginning" },
  ]);

  assert.deepEqual(result.verdicts.map((verdict) => `${verdict.index}:${verdict.ok}:${verdict.code ?? ""}`), [
    "0:true:", "1:true:", "2:true:", "3:true:", "4:true:", "5:true:", "6:true:", "7:true:", "8:true:", "9:true:", "10:true:", "11:true:",
  ]);

  const main = compositionOf(result.snapshot, "comp-main");
  assert.equal(main.width, 1280);
  assert.equal(main.height, 720);
  assert.equal(main.duration, 8);
  assert.deepEqual(main.backgroundColor, [0.1, 0.2, 0.3]);

  assert.equal(propertyOf(layerOf(result.snapshot, "comp-main", "layer-title"), "ADBE Text Properties/ADBE Text Document").value, "Summer 2026");
  assert.equal(propertyOf(layerOf(result.snapshot, "comp-main", "layer-title"), "ADBE Effect Parade/ADBE Glo2/ADBE Glo2-0002").expression, "time * 8");

  const accent = layerOf(result.snapshot, "comp-main", "layer-accent");
  assertShapeGraph(accent);
  assertEffectMatteAndIndex(accent);
  assertUnknownEffectIsStillAdded(result.snapshot);
  assertSecondInstanceIsAdded(result.snapshot);
}

function assertShapeGraph(accent: LayerSnapshot): void {
  const root = requiredLayerChild(accent, "ADBE Root Vectors Group", `layer ${accent.id} should carry a vectors root`);
  const group = requiredDisplayChild(root, "Badge", "the created shape group should be in the tree");
  const contents = requiredChild(group, "ADBE Vectors Group", "the group should carry its contents group");
  const rectangle = requiredChild(contents, "ADBE Vector Shape - Rect", "the rectangle item should be in the group's contents");
  assert.deepEqual(requiredChild(rectangle, "ADBE Vector Rect Size", "the rectangle should carry a size").value, [20, 10]);
  assert.deepEqual(requiredChild(requiredChild(contents, "ADBE Vector Shape - Group", "the path group should be in the contents"), "ADBE Vector Shape", "the path group should carry a shape").value, { vertices: [[0, 0], [20, 0], [20, 10]], inTangents: [[0, 0], [0, 0], [0, 0]], outTangents: [[0, 0], [0, 0], [0, 0]], closed: true });
  assert.deepEqual(requiredChild(requiredChild(contents, "ADBE Vector Graphic - Fill", "the fill should be in the contents"), "ADBE Vector Fill Color", "the fill should carry a color").value, [1, 0.5, 0]);
  assert.deepEqual(requiredChild(requiredChild(contents, "ADBE Vector Graphic - Stroke", "the stroke should be in the contents"), "ADBE Vector Stroke Width", "the stroke should carry a width").value, 3);
}

function assertEffectMatteAndIndex(accent: LayerSnapshot): void {
  const parade = requiredLayerChild(accent, "ADBE Effect Parade", `layer ${accent.id} should carry an effect parade`);
  const effect = requiredChild(parade, "ADBE Gaussian Blur 2", "the ensured effect should be in the parade");
  assert.equal(requiredChild(effect, "ADBE Gaussian Blur 2-0001", "the effect should carry its first control").value, 30);
  assert.equal(accent.matteLayerId, "layer-plate");
  assert.equal(accent.matteType, "alpha");
  assert.equal(accent.index, 1, "reorder_layer rewrites the stack indices");
}

function assertUnknownEffectIsStillAdded(snapshot: ProjectSnapshot): void {
  const unknownEffect = apply(snapshot, [
    { type: "ensure_effect", target: { compositionId: "comp-main", layerId: "layer-accent" }, capabilityId: "host:ADBE Glo2", effectMatchName: "ADBE Glo2", effectPath: "ADBE Effect Parade/ADBE Glo2" },
  ]);
  assert.equal(unknownEffect.verdicts[0]?.ok, true, "the effect itself is added, which is what the host does");
  const parade = requiredLayerChild(layerOf(unknownEffect.snapshot, "comp-main", "layer-accent"), "ADBE Effect Parade", "the effect parade should exist");
  assert.equal(parade.children?.some((child) => child.matchName === "ADBE Glo2"), true);
}

function assertSecondInstanceIsAdded(snapshot: ProjectSnapshot): void {
  const ensure = (effectPath: string) => ({ type: "ensure_effect", target: { compositionId: "comp-main", layerId: "layer-title", effectPath }, capabilityId: "host:ADBE Glo2", effectMatchName: "ADBE Glo2" });
  const result = apply(snapshot, [
    ensure("ADBE Effect Parade/ADBE Glo2"), ensure("ADBE Effect Parade/ADBE Glo2#2"), ensure("ADBE Effect Parade/ADBE Glo2#2"),
    { type: "set_effect_control", target: { compositionId: "comp-main", layerId: "layer-title", propertyPath: "ADBE Effect Parade/ADBE Glo2#2/ADBE Glo2-0003" }, capabilityId: "host:ADBE Glo2", effectMatchName: "ADBE Glo2", value: 40 },
  ]);
  assert.deepEqual(result.verdicts.map((verdict) => verdict.ok), [true, true, true, true]);
  const title = layerOf(result.snapshot, "comp-main", "layer-title");
  const glows = flattenProperties(title.properties).filter((property) => property.matchName === "ADBE Glo2").map((property) => property.path);
  assert.deepEqual(glows, ["ADBE Effect Parade/ADBE Glo2", "ADBE Effect Parade/ADBE Glo2#2"]);
  assert.equal(findProperty(title, { path: "ADBE Effect Parade/ADBE Glo2#2/ADBE Glo2-0003" })?.value, 40);
}

function refusesEveryUnmodelledPlanType(): void {
  const coverage = fixtureOperationCoverage();
  const modelled = new Set(coverage.implemented);
  assert.equal(coverage.implemented.length + coverage.refused.length, 59, "the 59-type plan vocabulary is split exactly once");
  assert.equal(new Set([...coverage.implemented, ...coverage.refused]).size, 59, "no type is both modelled and refused");
  assert.equal(coverage.implemented.length, 37);

  const input = fixture();
  const result = apply(input, coverage.refused.map((type) => ({ type, target: { compositionId: "comp-main", layerId: "layer-title" } })));
  assert.equal(result.verdicts.length, coverage.refused.length);
  for (const verdict of result.verdicts) {
    assert.equal(verdict.ok, false, `${verdict.type} must be refused`);
    assert.equal(verdict.code, "UNSUPPORTED_IN_FIXTURE", `${verdict.type} must say it is unmodelled`);
    assert.match(verdict.message ?? "", new RegExp(verdict.type));
  }
  assert.equal(result.mutated, false);
  assert.deepEqual(result.snapshot, input);
  assert.ok(modelled.has("animate_property"));

  const stranger = apply(input, [{ type: "make_it_pop" }]);
  assert.equal(stranger.verdicts[0]?.code, "UNSUPPORTED_IN_FIXTURE");
  assert.match(stranger.verdicts[0]?.message ?? "", /not one of the typed plan operations/);
}

function requiredDisplayChild(node: PropertySnapshot, displayName: string, message: string): PropertySnapshot {
  const child = node.children?.find((candidate) => candidate.displayName === displayName);
  assert.ok(child, message);
  return child;
}

function appliesCompositionTimeline(): void {
  const input = fixture();
  const target = { compositionId: "comp-main" };
  const result = apply(input, [
    { type: "set_composition_settings", target, settings: { workAreaStart: 1, workAreaDuration: 3, motionBlur: true, shutterAngle: 270, shutterPhase: -45, motionBlurSamplesPerFrame: 32, motionBlurAdaptiveSampleLimit: 200 } },
    { type: "add_marker", target, time: 2, comment: "Hit", label: 2 },
    { type: "add_marker", target, time: 0.5, comment: "Early" },
    { type: "update_marker", target, time: 2, comment: "Hit hard" },
    { type: "remove_marker", target, time: 0.5, destructive: true },
  ]);
  assert.deepEqual(result.verdicts.map((verdict) => verdict.ok), [true, true, true, true, true], JSON.stringify(result.verdicts));
  const composition = compositionOf(result.snapshot, "comp-main");
  assert.deepEqual(
    [composition.workAreaStart, composition.workAreaDuration, composition.motionBlur, composition.shutterAngle, composition.shutterPhase],
    [1, 3, true, 270, -45],
  );
  assert.deepEqual([composition.motionBlurSamplesPerFrame, composition.motionBlurAdaptiveSampleLimit], [32, 200]);
  assert.equal(composition.markers?.count, 1);
  assert.equal(composition.markers?.markers[0]?.comment, "Hit hard");
  assert.equal(composition.markers?.markers[0]?.label, 2);
}

describe("fake host composition timeline refusals", () => {
  it("refuses a renderer the composition does not list, a duplicate composition marker and a marker with nothing to write", () => {
    const input = fixture();
    const target = { compositionId: "comp-main" };
    const listed = apply({ ...input, compositions: input.compositions.map((composition) => ({ ...composition, renderers: ["Classic 3D", "Advanced 3D"] })) }, [{ type: "set_composition_settings", target, settings: { renderer: "Cinema 4D" } }]);
    assert.equal(listed.verdicts[0]?.ok, false);
    const duplicate = apply(input, [{ type: "add_marker", target, time: 1, comment: "a" }, { type: "add_marker", target, time: 1, comment: "b" }]);
    assert.deepEqual(duplicate.verdicts.map((verdict) => verdict.ok), [true, false]);
    assert.equal(apply(input, [{ type: "add_marker", target, time: 1 }]).verdicts[0]?.ok, false);
    assert.equal(apply(input, [{ type: "remove_marker", target, time: 9, destructive: true }]).verdicts[0]?.ok, false);
  });
  it("keeps the work area inside the composition when the duration shrinks", () => {
    const result = apply(fixture(), [{ type: "set_composition_settings", target: { compositionId: "comp-main" }, settings: { durationSeconds: 2 } }]);
    const composition = compositionOf(result.snapshot, "comp-main");
    assert.ok(composition.workAreaStart + composition.workAreaDuration <= composition.duration + 1e-9);
  });
});
