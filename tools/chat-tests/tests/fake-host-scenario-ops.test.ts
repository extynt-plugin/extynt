/**
 * The operations the from-scratch scenarios (title-ident-from-scratch, rocket-orbit) use: each one
 * changes the fixture where a later read finds it, records the evidence the sidecar's verifier
 * reads, and refuses by name what After Effects would. The last test runs the whole set through a
 * real sidecar and asserts its own read-back, not the fixture's say-so.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { type LayerSnapshot, type ProjectSnapshot, type PropertySnapshot } from "@extynt/project-graph";
import { compositionAsset } from "../src/assets.js";
import { applyOperationsToFixture, fixtureOperationCoverage, type FixtureApplyResult } from "../src/fake-host.js";
import { fixtureSnapshotFromProbe } from "../src/fake-host-probe.js";
import { planOperationsFromHostCommand } from "../src/fake-host-translate.js";
import { jsonObject, jsonRows } from "../src/wire-reads.js";
import { startRig } from "./fake-plugin-rig.js";
import type { WireObject, WireValue } from "../src/wire-types.js";

const COMP = "comp-main";

function fixture(): ProjectSnapshot { return fixtureSnapshotFromProbe(compositionAsset("summer-launch").probe); }

function apply(snapshot: ProjectSnapshot, operations: WireObject[]): FixtureApplyResult {
  return applyOperationsToFixture({ snapshot, operations });
}

function layerOf(snapshot: ProjectSnapshot, layerId: string): LayerSnapshot {
  const layer = snapshot.compositions.find((composition) => composition.id === COMP)?.layers.find((candidate) => candidate.id === layerId);
  assert.ok(layer, `layer ${layerId} should exist`);
  return layer;
}

function named(snapshot: ProjectSnapshot, name: string): LayerSnapshot {
  const layer = snapshot.compositions.find((composition) => composition.id === COMP)?.layers.find((candidate) => candidate.name === name);
  assert.ok(layer, `layer "${name}" should exist`);
  return layer;
}

function propertyOf(layer: LayerSnapshot, path: string): PropertySnapshot {
  const visit = (properties: PropertySnapshot[]): PropertySnapshot | undefined => {
    for (const property of properties) {
      if (property.path === path) return property;
      const inner = visit(property.children ?? []);
      if (inner) return inner;
    }
    return undefined;
  };
  const found = visit(layer.properties);
  assert.ok(found, `${path} should exist on ${layer.id}`);
  return found;
}

function hasProperty(layer: LayerSnapshot, matchName: string): boolean {
  return layer.properties.some((property) => property.matchName === matchName);
}

function evidenceAt(result: FixtureApplyResult, index: number): WireObject {
  const evidence = result.evidence.get(index);
  assert.ok(evidence, `operation ${index} should have recorded evidence`);
  return evidence;
}

function assertAllApplied(result: FixtureApplyResult): void {
  assert.deepEqual(result.verdicts.filter((verdict) => !verdict.ok).map((verdict) => `${verdict.type}: ${verdict.code} ${verdict.message}`), []);
}

function create(layerId: string, layerType: string, name: string, extra: WireObject = {}): WireObject {
  return { type: "create_layer", target: { compositionId: COMP, layerId }, layerType, name, ...extra };
}

function brief(value: WireValue | undefined): string { return JSON.stringify(value ?? null).slice(0, 800); }

const target = (layerId: string, extra: WireObject = {}) => ({ compositionId: COMP, layerId, ...extra });

test("the coverage split counts the scenario operations as modelled", () => {
  const coverage = fixtureOperationCoverage();
  assert.equal(coverage.implemented.length + coverage.refused.length, 59);
  for (const type of ["draw_vector_shapes", "animate_control", "add_text_animator", "update_text_animator", "set_camera_options", "set_light_options", "set_material_options", "add_essential_property"]) {
    assert.ok(coverage.implemented.includes(type), `${type} should be modelled`);
  }
});

test("draw_vector_shapes builds the groups, and reads them back in the order the host reports", () => {
  const result = apply(fixture(), [
    create("__new__:art", "shape", "Art"),
    { type: "draw_vector_shapes", target: target("__new__:art"), shapes: [
      { name: "Back", paths: [{ vertices: [[0, 0], [10, 0], [10, 10]], closed: true }], fill: { color: [1, 0, 0], opacity: 80 } },
      { name: "Front", paths: [{ vertices: [[0, 0], [5, 5]], closed: false }], stroke: { color: [0, 0, 1], width: 4, cap: "round" }, opacity: 50 },
    ] },
  ]);
  assertAllApplied(result);
  const readback = jsonObject(evidenceAt(result, 1).readback, "the readback");
  assert.equal(readback.existing, 0);
  assert.equal(readback.total, 2);
  assert.deepEqual(jsonRows(readback.groups, "the groups").map((group) => [group.name, group.ordinal]), [["Back", 2], ["Front", 1]]);
  const art = named(result.snapshot, "Art");
  const contents = propertyOf(art, "ADBE Root Vectors Group");
  assert.deepEqual((contents.children ?? []).map((child) => child.displayName), ["Front", "Back"]);
  assert.equal(propertyOf(art, "ADBE Root Vectors Group/ADBE Vector Group#2/ADBE Vectors Group/ADBE Vector Graphic - Fill/ADBE Vector Fill Color").value?.toString(), "1,0,0");
});

test("draw_vector_shapes refuses a malformed shape and leaves the layer empty", () => {
  const result = apply(fixture(), [
    create("__new__:art", "shape", "Art"),
    { type: "draw_vector_shapes", target: target("__new__:art"), shapes: [{ name: "Bad", paths: [{ vertices: [[0, 0, 1]], closed: true }] }] },
  ]);
  assert.equal(result.verdicts[1]?.ok, false);
  assert.equal(result.verdicts[1]?.code, "INVALID_VALUE");
  assert.deepEqual(propertyOf(named(result.snapshot, "Art"), "ADBE Root Vectors Group").children ?? [], []);
});

test("keyframe writes record a digest that changes when only a value changes", () => {
  const first = apply(fixture(), [{ type: "animate_property", target: target("layer-title", { propertyPath: "ADBE Transform Group/ADBE Opacity" }), keyframes: [{ time: 0, value: 0 }, { time: 1, value: 100 }] }]);
  assertAllApplied(first);
  const digest = propertyOf(layerOf(first.snapshot, "layer-title"), "ADBE Transform Group/ADBE Opacity").keyDigest;
  assert.match(digest ?? "", /^2:2:[0-9a-f]+$/);
  const edited = apply(first.snapshot, [{ type: "animate_property", target: target("layer-title", { propertyPath: "ADBE Transform Group/ADBE Opacity" }), keyframes: [{ time: 0, value: 10 }, { time: 1, value: 100 }], keyframeMode: "replace" }]);
  assertAllApplied(edited);
  assert.notEqual(propertyOf(layerOf(edited.snapshot, "layer-title"), "ADBE Transform Group/ADBE Opacity").keyDigest, digest);
  const evidence = evidenceAt(edited, 0);
  assert.equal(evidence.afterKeys, 2);
  assert.equal(evidence.afterDigest, propertyOf(layerOf(edited.snapshot, "layer-title"), "ADBE Transform Group/ADBE Opacity").keyDigest);
});

test("set_expression reports the expression as enabled and never claims it was evaluated", () => {
  const result = apply(fixture(), [{ type: "set_expression", target: target("layer-title", { propertyPath: "ADBE Transform Group/ADBE Opacity" }), source: "wiggle(2, 10)", enabled: true }]);
  assertAllApplied(result);
  const evidence = evidenceAt(result, 0);
  assert.equal(evidence.expressionEnabled, true);
  assert.equal("expressionSamples" in evidence, false);
  assert.equal("expressionChanges" in evidence, false);
});

test("the 3D switch is read back on the layer, and Material Options follow it", () => {
  const on = apply(fixture(), [
    create("__new__:word", "text", "Word", { text: "HI" }),
    create("__new__:null", "null", "Rig"),
    { type: "set_layer_attribute", target: target("__new__:word"), role: "three-d", value: true },
    { type: "set_layer_attribute", target: target("__new__:null"), role: "three-d", value: true },
  ]);
  assertAllApplied(on);
  assert.equal(named(on.snapshot, "Word").threeD, true);
  assert.equal(hasProperty(named(on.snapshot, "Word"), "ADBE Material Options Group"), true);
  assert.equal(named(on.snapshot, "Rig").threeD, true);
  assert.equal(hasProperty(named(on.snapshot, "Rig"), "ADBE Material Options Group"), false, "a null layer has no material options");

  const wordId = named(on.snapshot, "Word").id;
  const off = apply(on.snapshot, [{ type: "set_layer_attribute", target: target(wordId), role: "three-d", value: false }]);
  assertAllApplied(off);
  assert.equal(layerOf(off.snapshot, wordId).threeD, false);
  assert.equal(hasProperty(layerOf(off.snapshot, wordId), "ADBE Material Options Group"), false);
  assert.equal(apply(on.snapshot, [{ type: "set_layer_attribute", target: target(wordId), role: "three-d", value: "yes" }]).verdicts[0]?.code, "INVALID_VALUE");
});

test("camera, light and material options write the typed leaves and refuse what the layer cannot carry", () => {
  const result = apply(fixture(), [
    create("__new__:cam", "camera", "Camera"),
    { type: "set_camera_options", target: target("__new__:cam"), options: { zoom: 1200, depthOfField: true } },
    create("__new__:light", "light", "Key"),
    { type: "set_light_options", target: target("__new__:light"), options: { intensity: 120, color: [1, 0.9, 0.8] } },
    create("__new__:word", "text", "Word", { text: "HI" }),
    { type: "set_layer_attribute", target: target("__new__:word"), role: "three-d", value: true },
    { type: "set_material_options", target: target("__new__:word"), options: { castsShadows: true, metal: 40 } },
  ]);
  assertAllApplied(result);
  const camera = named(result.snapshot, "Camera");
  assert.equal(propertyOf(camera, "ADBE Camera Options Group/ADBE Camera Zoom").value, 1200);
  assert.equal(propertyOf(camera, "ADBE Camera Options Group/ADBE Camera Depth of Field").value, true);
  assert.equal(propertyOf(camera, "ADBE Camera Options Group/ADBE Camera Aperture").value, null, "an option nobody wrote claims no value");
  const light = named(result.snapshot, "Key");
  assert.equal(propertyOf(light, "ADBE Light Options Group/ADBE Light Intensity").value, 120);
  assert.deepEqual(propertyOf(light, "ADBE Light Options Group/ADBE Light Color").value, [1, 0.9, 0.8]);
  const word = named(result.snapshot, "Word");
  assert.equal(propertyOf(word, "ADBE Material Options Group/ADBE Metal Coefficient").value, 40);

  const refused = apply(result.snapshot, [
    { type: "set_camera_options", target: target(named(result.snapshot, "Word").id), options: { zoom: 10 } },
    { type: "set_camera_options", target: target(camera.id), options: { zoom: 0 } },
    { type: "set_camera_options", target: target(camera.id), options: { shine: 1 } },
    { type: "set_material_options", target: target("layer-title"), options: { metal: 10 } },
    { type: "set_light_options", target: target(named(result.snapshot, "Key").id), options: { color: [2, 0, 0] } },
  ]);
  assert.deepEqual(refused.verdicts.map((verdict) => verdict.code), ["THREED_OPTIONS_UNSUPPORTED", "INVALID_VALUE", "INVALID_VALUE", "THREED_OPTIONS_UNSUPPORTED", "INVALID_VALUE"]);
  assert.equal(refused.mutated, false);
});

test("a text animator is added with its selector, updated by placeholder, and its writes read back", () => {
  const result = apply(fixture(), [
    create("__new__:word", "text", "Word", { text: "SIGNAL" }),
    { type: "add_text_animator", target: target("__new__:word"), newAnimatorId: "__new__:anim", name: "Reveal", properties: { opacity: 0, position: [0, 40] }, selector: { type: "range", settings: { start: 0, end: 100 } }, keyframes: { "selector.offset": [{ time: 0, value: -100 }, { time: 1, value: 100 }] } },
    { type: "update_text_animator", target: target("__new__:word"), animatorId: "__new__:anim", properties: { rotation: 6 } },
  ]);
  assertAllApplied(result);
  const word = named(result.snapshot, "Word");
  const animator = "ADBE Text Properties/ADBE Text Animators/ADBE Text Animator";
  assert.equal(propertyOf(word, animator).displayName, "Reveal");
  assert.equal(propertyOf(word, `${animator}/ADBE Text Animator Properties/ADBE Text Opacity`).value, 0);
  assert.deepEqual(propertyOf(word, `${animator}/ADBE Text Animator Properties/ADBE Text Position 3D`).value, [0, 40]);
  assert.equal(propertyOf(word, `${animator}/ADBE Text Animator Properties/ADBE Text Rotation`).value, 6);
  assert.equal(propertyOf(word, `${animator}/ADBE Text Selectors/ADBE Text Selector/ADBE Text Percent End`).value, 100);
  const offset = propertyOf(word, `${animator}/ADBE Text Selectors/ADBE Text Selector/ADBE Text Percent Offset`);
  assert.equal(offset.keyframeCount, 2);

  const added = evidenceAt(result, 1);
  assert.equal(added.containerPath, animator);
  assert.equal(added.created, true);
  assert.equal(jsonRows(added.animations, "the animations")[0]?.afterKeys, 2);
  assert.equal(evidenceAt(result, 2).created, false);
  assert.equal(result.bindings["__new__:anim"], "animator:1");
});

test("a text animator written in the host's flattened form lands where the plan form does", () => {
  const hostForm = planOperationsFromHostCommand([
    { operation: "create_layer", compositionId: COMP, layerId: "__new__:word", layerType: "text", name: "Word", text: "HI" },
    { operation: "add_text_animator", compositionId: COMP, layerId: "__new__:word", newAnimatorId: "__new__:anim", selectorMatchName: "ADBE Text Selector",
      writes: [{ path: "ADBE Text Animator Properties/ADBE Text Opacity", value: 0 }, { path: "ADBE Text Selectors/ADBE Text Selector/ADBE Text Percent Start", value: 10 }],
      animations: [{ path: "ADBE Text Animator Properties/ADBE Text Rotation", keyframes: [{ time: 0, value: 0 }, { time: 1, value: 90 }], keyframeMode: "reject" }] },
  ]);
  const result = apply(fixture(), hostForm);
  assertAllApplied(result);
  const word = named(result.snapshot, "Word");
  const animator = "ADBE Text Properties/ADBE Text Animators/ADBE Text Animator";
  assert.equal(propertyOf(word, `${animator}/ADBE Text Animator Properties/ADBE Text Opacity`).value, 0);
  assert.equal(propertyOf(word, `${animator}/ADBE Text Selectors/ADBE Text Selector/ADBE Text Percent Start`).value, 10);
  assert.equal(propertyOf(word, `${animator}/ADBE Text Animator Properties/ADBE Text Rotation`).keyframeCount, 2);
});

test("a text animator refuses a non-text layer, an unknown setting, an empty add and an unknown animator, changing nothing", () => {
  const input = fixture();
  const withWord = apply(input, [create("__new__:word", "text", "Word", { text: "HI" }), create("__new__:shape", "shape", "Art")]);
  const wordId = named(withWord.snapshot, "Word").id, shapeId = named(withWord.snapshot, "Art").id;
  const result = apply(withWord.snapshot, [
    { type: "add_text_animator", target: target(shapeId), newAnimatorId: "__new__:a", properties: { opacity: 0 } },
    { type: "add_text_animator", target: target(wordId), newAnimatorId: "__new__:b", properties: { sparkle: 1 } },
    { type: "add_text_animator", target: target(wordId), newAnimatorId: "__new__:c" },
    { type: "add_text_animator", target: target(wordId), newAnimatorId: "__new__:d", properties: { opacity: 0 }, selector: { type: "expression", settings: { start: 1 } } },
    { type: "update_text_animator", target: target(wordId), animatorId: "animator:2", properties: { opacity: 0 } },
    { type: "add_text_animator", target: target(wordId), newAnimatorId: "__new__:f", properties: { opacity: 0 }, selector: { type: "range", amountExpression: "1" } },
  ]);
  assert.deepEqual(result.verdicts.map((verdict) => verdict.code), ["INVALID_TARGET", "INVALID_VALUE", "INVALID_OPERATION", "INVALID_VALUE", "TARGET_NOT_FOUND", "INVALID_VALUE"]);
  assert.equal(result.mutated, false);
  assert.deepEqual(propertyOf(layerOf(result.snapshot, wordId), "ADBE Text Properties/ADBE Text Animators").children ?? [], []);
});

test("an expression selector keeps its amount expression, unevaluated", () => {
  const result = apply(fixture(), [
    create("__new__:word", "text", "Word", { text: "HI" }),
    { type: "add_text_animator", target: target("__new__:word"), newAnimatorId: "__new__:anim", properties: { opacity: 0 }, selector: { type: "expression", amountExpression: "textIndex / textTotal * 100" } },
  ]);
  assertAllApplied(result);
  const amount = propertyOf(named(result.snapshot, "Word"), "ADBE Text Properties/ADBE Text Animators/ADBE Text Animator/ADBE Text Selectors/ADBE Text Expressible Selector/ADBE Text Expressible Amount");
  assert.equal(amount.expression, "textIndex / textTotal * 100");
  assert.equal(amount.expressionEnabled, true);
});

test("animate_control keys an effect control, with the digest the sidecar compares", () => {
  const result = apply(fixture(), [
    create("__new__:word", "text", "Word", { text: "HI" }),
    { type: "ensure_effect", target: target("__new__:word", { effectPath: "ADBE Effect Parade/ADBE Gaussian Blur 2" }), effectMatchName: "ADBE Gaussian Blur 2", effectPath: "ADBE Effect Parade/ADBE Gaussian Blur 2" },
    { type: "animate_control", target: target("__new__:word", { effectPath: "ADBE Effect Parade/ADBE Gaussian Blur 2", propertyPath: "ADBE Effect Parade/ADBE Gaussian Blur 2/ADBE Gaussian Blur 2-0001" }), effectMatchName: "ADBE Gaussian Blur 2", role: "blur", keyframes: [{ time: 0, value: 40 }, { time: 1, value: 0 }] },
  ]);
  assertAllApplied(result);
  const blur = propertyOf(named(result.snapshot, "Word"), "ADBE Effect Parade/ADBE Gaussian Blur 2/ADBE Gaussian Blur 2-0001");
  assert.equal(blur.keyframeCount, 2);
  assert.equal(evidenceAt(result, 2).afterDigest, blur.keyDigest);

  const again = apply(result.snapshot, [
    { type: "animate_control", target: target(named(result.snapshot, "Word").id, { effectPath: "ADBE Effect Parade/ADBE Gaussian Blur 2", propertyPath: "ADBE Effect Parade/ADBE Gaussian Blur 2/ADBE Gaussian Blur 2-0001" }), effectMatchName: "ADBE Gaussian Blur 2", role: "blur", keyframes: [{ time: 0, value: 1 }] },
    { type: "animate_control", target: target("layer-title", { propertyPath: "ADBE Transform Group/ADBE Opacity" }), effectMatchName: "ADBE Gaussian Blur 2", role: "blur", keyframes: [{ time: 0, value: 1 }] },
  ]);
  assert.deepEqual(again.verdicts.map((verdict) => verdict.code), ["CONFLICTING_KEYS", "INVALID_TARGET"]);
});

test("add_essential_property validates the property, records the host's report and changes no project state", () => {
  const input = fixture();
  const result = apply(input, [
    { type: "add_essential_property", target: target("layer-title", { propertyPath: "ADBE Text Properties/ADBE Text Document" }), name: "Headline" },
    { type: "add_essential_property", target: target("layer-title", { propertyPath: "ADBE Transform Group" }) },
    { type: "add_essential_property", target: target("layer-title", { propertyPath: "ADBE Transform Group/ADBE Nothing" }) },
    { type: "add_essential_property", target: target("layer-title") },
  ]);
  assert.deepEqual(result.verdicts.map((verdict) => verdict.code ?? "ok"), ["ok", "ESSENTIAL_GRAPHICS_UNSUPPORTED", "PROPERTY_NOT_FOUND", "INVALID_TARGET"]);
  assert.deepEqual(evidenceAt(result, 0), { propertyPath: "ADBE Text Properties/ADBE Text Document", named: true, verification: "essential-property-added" });
  assert.equal(result.mutated, false, "the snapshot has no Essential Graphics list to change");
  assert.deepEqual(result.snapshot, input);
});

function effectOperation(layerId: string, capabilityId: string, matchName: string): WireObject {
  return { type: "ensure_effect", target: target(layerId, { effectPath: `ADBE Effect Parade/${matchName}` }), capabilityId, effectMatchName: matchName, effectPath: `ADBE Effect Parade/${matchName}` };
}

function backdropAndRingOperations(): WireObject[] {
  return [
    create("__new__:bg", "solid", "Backdrop", { color: [0.05, 0.03, 0.2, 1] }),
    effectOperation("__new__:bg", "adobe.gradient-ramp", "ADBE Ramp"),
    { type: "set_effect_control", target: target("__new__:bg", { effectPath: "ADBE Effect Parade/ADBE Ramp", propertyPath: "ADBE Effect Parade/ADBE Ramp/ADBE Ramp-0005" }), effectMatchName: "ADBE Ramp", value: 2 },
    create("__new__:rings", "shape", "Rings"),
    { type: "create_shape_group", target: target("__new__:rings"), newGroupId: "__new__:ring", name: "Ring" },
    { type: "add_shape_item", target: target("__new__:rings"), groupId: "__new__:ring", item: "ellipse", newItemId: "__new__:ell", values: { size: [200, 200] } },
    { type: "ensure_shape_stroke", target: target("__new__:rings"), groupId: "__new__:ring", color: [0, 0.9, 1], width: 3 },
    { type: "add_shape_item", target: target("__new__:rings"), groupId: "__new__:ring", item: "repeater", newItemId: "__new__:rep", values: { copies: 12 } },
    { type: "animate_property", target: target("__new__:rings", { propertyPath: "ADBE Transform Group/ADBE Scale" }), keyframes: [{ time: 0.4, value: [0, 0] }, { time: 1.4, value: [100, 100] }] },
  ];
}

function wordAndCameraOperations(): WireObject[] {
  return [
    create("__new__:art", "shape", "Planet"),
    { type: "draw_vector_shapes", target: target("__new__:art"), shapes: [{ name: "Disc", paths: [{ vertices: [[0, 0], [10, 0], [10, 10]], closed: true }], fill: { color: [1, 0.5, 0] } }] },
    create("__new__:word", "text", "Word", { text: "SIGNAL" }),
    effectOperation("__new__:word", "adobe.glow", "ADBE Glo2"),
    effectOperation("__new__:word", "adobe.drop-shadow", "ADBE Drop Shadow"),
    { type: "animate_control", target: target("__new__:word", { effectPath: "ADBE Effect Parade/ADBE Glo2", propertyPath: "ADBE Effect Parade/ADBE Glo2/ADBE Glo2-0003" }), effectMatchName: "ADBE Glo2", role: "glow", keyframes: [{ time: 0, value: 0 }, { time: 1, value: 2 }] },
    { type: "add_text_animator", target: target("__new__:word"), newAnimatorId: "__new__:anim", name: "Reveal", properties: { opacity: 0, position: [0, 40] }, selector: { type: "range", settings: { start: 0, end: 100 } } },
    create("__new__:sweep", "shape", "Shine"),
    effectOperation("__new__:sweep", "adobe.gaussian-blur", "ADBE Gaussian Blur 2"),
    { type: "set_track_matte", target: target("__new__:word"), matteLayerId: "__new__:sweep", mode: "alpha" },
    create("__new__:nul", "null", "Title Null"),
    { type: "set_layer_parent", target: target("__new__:word"), parentLayerId: "__new__:nul" },
    { type: "set_layer_attribute", target: target("__new__:word"), role: "three-d", value: true },
    { type: "set_layer_attribute", target: target("__new__:nul"), role: "three-d", value: true },
    { type: "set_material_options", target: target("__new__:word"), options: { castsShadows: true } },
    create("__new__:cam", "camera", "Camera"),
    { type: "set_camera_options", target: target("__new__:cam"), options: { zoom: 1200 } },
    create("__new__:lt", "light", "Key"),
    { type: "set_light_options", target: target("__new__:lt"), options: { intensity: 120 } },
    { type: "add_marker", target: target("__new__:word"), time: 0.5, comment: "Beat 1" },
    { type: "add_marker", target: { compositionId: COMP }, time: 1, comment: "Beat 2" },
    { type: "reorder_layer", target: target("__new__:nul"), placement: "beginning" },
  ];
}

test("the whole title-ident and rocket-orbit operation set verifies exactly through a real sidecar", async (t) => {
  const rig = await startRig("scenario-ops");
  t.after(() => rig.stop());
  const operations: WireObject[] = [...backdropAndRingOperations(), ...wordAndCameraOperations()];
  const proposed = await rig.sidecar.callTool("ae_propose_plan", { summary: "scenario ops", operations });
  assert.equal(proposed.ok, true, brief(proposed.error ?? proposed.data));
  const planId = String(jsonObject(proposed.data, "the proposal").planId);
  const approved = await rig.sidecar.callTool("ae_approve_plan", { planId, waitSeconds: 8, acknowledgeUnverified: true });
  assert.equal(approved.ok, true, brief(approved.error));
  await rig.settle();
  assert.deepEqual(rig.host.batches.flatMap((batch) => batch.refused), []);

  const receipt = jsonObject(jsonObject((await rig.sidecar.callTool("ae_get_receipt", { planId })).data, "the receipt envelope").receipt, "the receipt");
  const steps = jsonRows(jsonObject(receipt.verification, "the verification").steps, "the verification steps");
  assert.equal(steps.length, operations.length);
  assert.deepEqual(steps.filter((step) => step.verificationState !== "exact").map((step) => `${String(step.operation)}: ${String(step.verificationState)} ${String(step.basis)}`), []);
  assert.equal(receipt.postcondition, "passed");
});

test("an enabled expression and an Essential Graphics property stay unverified through a real sidecar, because nothing in the snapshot can confirm them", async (t) => {
  const rig = await startRig("scenario-unverified");
  t.after(() => rig.stop());
  const operations: WireObject[] = [
    create("__new__:rings", "shape", "Rings"),
    { type: "set_expression", target: target("__new__:rings", { propertyPath: "ADBE Transform Group/ADBE Opacity" }), source: "wiggle(2, 10)", enabled: true },
    { type: "add_essential_property", target: target("__new__:rings", { propertyPath: "ADBE Transform Group/ADBE Opacity" }), name: "Fade" },
  ];
  const proposed = await rig.sidecar.callTool("ae_propose_plan", { summary: "unverified ops", operations });
  assert.equal(proposed.ok, true, brief(proposed.error ?? proposed.data));
  const planId = String(jsonObject(proposed.data, "the proposal").planId);
  const approved = await rig.sidecar.callTool("ae_approve_plan", { planId, waitSeconds: 8, acknowledgeUnverified: true });
  assert.equal(approved.ok, true, brief(approved.error));
  await rig.settle();
  const receipt = jsonObject(jsonObject((await rig.sidecar.callTool("ae_get_receipt", { planId })).data, "the receipt envelope").receipt, "the receipt");
  const steps = jsonRows(jsonObject(receipt.verification, "the verification").steps, "the verification steps");
  assert.deepEqual(steps.map((step) => `${String(step.operation)}:${String(step.verificationState)}`), ["create_layer:exact", "set_expression:applied_unverified", "add_essential_property:applied_unverified"]);
});

test("duplicate_layer copies the layer above the original, binds its placeholder, and a later operation renames the copy", () => {
  const before = fixture();
  const original = before.compositions.find((composition) => composition.id === COMP)?.layers[0];
  assert.ok(original, "the fixture comp has a layer to duplicate");
  const result = apply(before, [
    { type: "duplicate_layer", target: target(original.id), newLayerId: "__new__:shine" },
    { type: "set_layer_name", target: target("__new__:shine"), name: "Shine Copy" },
  ]);
  assertAllApplied(result);
  const copy = named(result.snapshot, "Shine Copy");
  const source = layerOf(result.snapshot, original.id);
  assert.notEqual(copy.id, original.id);
  assert.equal(copy.index, source.index - 1, "the copy sits directly above the original");
  assert.equal(source.name, original.name, "the original keeps its name");
  assert.deepEqual(copy.properties, source.properties, "the copy carries the original's properties");
});

test("ensure_layer_style adds an outer glow and a drop shadow to a text layer, and a second apply updates them in place", () => {
  const glow = "ADBE Layer Styles/outerGlow%2Fenabled", shadow = "ADBE Layer Styles/dropShadow%2Fenabled";
  const first = apply(fixture(), [
    create("__new__:word", "text", "Word", { text: "HI" }),
    { type: "ensure_layer_style", target: target("__new__:word"), style: "outer-glow", values: { "outerGlow/size": 12, "outerGlow/opacity": 75 } },
    { type: "ensure_layer_style", target: target("__new__:word"), style: "drop-shadow", values: { "dropShadow/distance": 8 } },
  ]);
  assertAllApplied(first);
  const word = named(first.snapshot, "Word");
  assert.equal(propertyOf(word, glow).enabled, true);
  assert.equal(propertyOf(word, `${glow}/outerGlow%2Fsize`).value, 12);
  assert.equal(propertyOf(word, `${shadow}/dropShadow%2Fdistance`).value, 8);
  assert.equal(evidenceAt(first, 1).created, true);
  const second = apply(first.snapshot, [
    { type: "ensure_layer_style", target: target(word.id), style: "outer-glow", values: { "outerGlow/size": 30 } },
    { type: "ensure_layer_style", target: target(word.id), style: "drop-shadow", enabled: false },
  ]);
  assertAllApplied(second);
  const updated = layerOf(second.snapshot, word.id);
  const styles = (updated.properties.find((property) => property.matchName === "ADBE Layer Styles")?.children ?? []);
  assert.equal(styles.length, 2, "re-applying updates the style rather than duplicating it");
  assert.equal(propertyOf(updated, `${glow}/outerGlow%2Fsize`).value, 30);
  assert.equal(propertyOf(updated, `${glow}/outerGlow%2Fopacity`).value, 75, "settings not rewritten keep their value");
  assert.equal(evidenceAt(second, 0).created, false);
  assert.equal(propertyOf(updated, shadow).enabled, false);
  const bad = apply(first.snapshot, [{ type: "ensure_layer_style", target: target(word.id), style: "outer-glow", values: { "dropShadow/size": 3 } }]);
  assert.equal(bad.verdicts[0]?.ok, false);
});

test("a blend mode is accepted without claiming a read-back, and a malformed one is refused", () => {
  const before = fixture();
  const layer = before.compositions.find((composition) => composition.id === COMP)?.layers[0];
  assert.ok(layer, "the fixture comp has a layer");
  const set = apply(before, [{ type: "set_layer_attribute", target: target(layer.id), role: "blend-mode", value: "SCREEN" }]);
  assertAllApplied(set);
  assert.equal(set.evidence.get(0), undefined, "no evidence: After Effects reports none for a blend mode");
  assert.deepEqual(layerOf(set.snapshot, layer.id), layerOf(before, layer.id), "the snapshot has no blend mode to change");
  const bad = apply(before, [{ type: "set_layer_attribute", target: target(layer.id), role: "blend-mode", value: "screen please" }]);
  assert.equal(bad.verdicts[0]?.ok, false);
  assert.equal(bad.verdicts[0]?.code, "INVALID_VALUE");
});
