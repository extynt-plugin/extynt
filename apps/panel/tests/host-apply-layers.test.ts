/** apply_plan host contract for layers: undo-group batching, effects, 3D options, created text, native layer operations and parenting. */

import assert from "node:assert/strict";
import test from "node:test";
import { type JsonObject } from "@extynt/decode";
import { loadApplyPlan } from "./host-apply-harness.js";
import { childAt, effectParade, justificationOf, layerNamed, layerProperty, propertyAt } from "./host-fake-lookup.js";
import { applyPlan, onLayer } from "./host-plan-io.js";
import { fieldOf, listAt, optionalTextAt } from "./json-narrow.js";

const BLUR = "ADBE Gaussian Blur 2";
const BLUR_PATH = `ADBE Effect Parade/${BLUR}`;
const POSITION = "ADBE Transform Group/ADBE Position";

function markers(count: number, base = 0): JsonObject[] {
  return Array.from({ length: count }, (_unused, index) => onLayer("add_marker", "layer-title", { time: base + index, comment: `m${base + index}` }));
}

function ensureBlur(effectPath: string): JsonObject {
  return onLayer("ensure_effect", "layer-title", { capabilityId: "adobe.gaussian-blur", effectMatchName: BLUR, effectPath });
}

test("a long plan becomes several After Effects undo groups in one apply run", () => {
  const { apply, calls } = loadApplyPlan();
  const batched = applyPlan(apply, "long-1", markers(7), { batchSize: 3 });
  assert.equal(fieldOf(batched, "ok"), true, JSON.stringify(batched).slice(0, 400));
  assert.equal(fieldOf(batched, "undoGroups"), 3, "seven operations at three per group is three undos");
  assert.equal(fieldOf(batched, "batchSize"), 3);
  assert.equal(listAt(batched, "steps").length, 7, "every operation still ran, in one run");
  assert.deepEqual(calls.begin, ["extynt — long-1 (1/3)", "extynt — long-1 (2/3)", "extynt — long-1 (3/3)"], "each group is named, so the undo stack says which piece it is");
  assert.equal(calls.end, 3, "every group is closed");
  calls.begin.length = 0;
  calls.end = 0;
  const single = applyPlan(apply, "short-1", markers(4, 10));
  assert.equal(fieldOf(single, "ok"), true, JSON.stringify(single).slice(0, 400));
  assert.equal(fieldOf(single, "undoGroups"), 1);
  assert.equal(fieldOf(single, "batchSize"), 0);
  assert.deepEqual(calls.begin, ["extynt — short-1"], "an unbatched plan keeps its single group name");
  assert.equal(calls.end, 1);
  calls.begin.length = 0;
  const bogus = applyPlan(apply, "bogus-1", markers(1, 20), { batchSize: -4 });
  assert.equal(fieldOf(bogus, "ok"), true);
  assert.equal(fieldOf(bogus, "undoGroups"), 1);
  assert.deepEqual(calls.begin, ["extynt — bogus-1"]);
});

test("apply_plan resolves exact native paths, creates effects, animates controls, and returns a bounded receipt", () => {
  const { apply, calls, title, shapeLayer } = loadApplyPlan();
  const result = applyPlan(apply, "motion-1", [
      { ...ensureBlur(BLUR_PATH), enabled: false },
      onLayer("animate_control", "layer-title", {
        effectMatchName: BLUR,
        propertyPath: `${BLUR_PATH}/${BLUR}-0001`,
        role: "blur.amount",
        keyframes: [{ time: 0, value: 0 }, { time: 1, value: 24, interpolation: { outType: "EASE_OUT" } }],
      }),
      onLayer("animate_property", "layer-shape", {
        propertyPath: "ADBE Root Vectors Group/ADBE Vector Shape - Group/ADBE Vector Shape",
        role: "shape.path",
        keyframes: [
          { time: 0, value: { vertices: [[0, 0], [1, 0], [1, 1]], closed: true } },
          { time: 1, value: { vertices: [[0, 0], [2, 0], [2, 2]], closed: true } },
        ],
      }),
    ]);
  assert.equal(fieldOf(result, "ok"), true);
  assert.equal(calls.begin.length, 1);
  assert.equal(calls.end, 1);
  assert.equal(listAt(result, "steps").length, 3);
  assert.equal(fieldOf(result, "receipt", "rollback"), "After Effects Undo");
  assert.equal(effectParade(title).children.length, 1);
  assert.equal(childAt(propertyAt(shapeLayer, 0), 0, 0).numKeys, 2);
  assert.equal(childAt(effectParade(title), 0).enabled, false);
  assert.equal(childAt(effectParade(title), 0, 0).temporalEase.length, 2);
});

test("apply_plan adds a second instance of an effect and writes and animates the controls under the instance its effectPath names", () => {
  const { apply, title } = loadApplyPlan();
  const second = `${BLUR_PATH}#2`;
  const control = `${second}/${BLUR}-0001`;
  const result = applyPlan(apply, "second-blur", [
      ensureBlur(BLUR_PATH),
      ensureBlur(second),
      onLayer("set_effect_control", "layer-title", { effectMatchName: BLUR, effectPath: second, propertyPath: control, value: 12 }),
      onLayer("animate_control", "layer-title", {
        effectMatchName: BLUR,
        effectPath: second,
        propertyPath: control,
        role: "blur.amount",
        keyframes: [{ time: 0, value: 12 }, { time: 1, value: 30 }],
      }),
    ]);
  assert.equal(fieldOf(result, "ok"), true, JSON.stringify(fieldOf(result, "error")));
  const blurs = effectParade(title).children;
  assert.equal(blurs.length, 2, "the #2 path adds a second blur beside the first rather than reusing it");
  assert.equal(childAt(effectParade(title), 0, 0).numKeys, 0, "the first blur is untouched");
  assert.equal(childAt(effectParade(title), 1, 0).numKeys, 2, "the controls land on the instance the path names");
});

test("apply_plan writes only allowlisted camera, light, and material option matchNames", () => {
  const { apply, cameraLayer, lightLayer, shapeLayer } = loadApplyPlan();
  const result = applyPlan(apply, "three-d-options", [
      onLayer("set_camera_options", "layer-camera", { options: { zoom: 2500, depthOfField: true, aperture: 120 } }),
      onLayer("set_light_options", "layer-light", { options: { intensity: 300, color: [1, 0.5, 0], coneAngle: 45 } }),
      onLayer("set_material_options", "layer-shape", { options: { acceptsShadows: false, diffuse: 70, metal: 20 } }),
    ]);
  assert.equal(fieldOf(result, "ok"), true);
  assert.equal(listAt(result, "steps").length, 3);
  assert.equal(childAt(propertyAt(cameraLayer, 0), 0).value, 2500);
  assert.equal(childAt(propertyAt(lightLayer, 0), 0).value, 300);
  assert.equal(childAt(layerProperty(shapeLayer, "ADBE Material Options Group"), 0).value, false);
});

test("apply_plan writes camera and light options on layers created earlier in the same plan", () => {
  const { apply, comp } = loadApplyPlan();
  const result = applyPlan(apply, "created-three-d-options", [
      onLayer("create_layer", "__new__:camera", { layerType: "camera", name: "Camera 1" }),
      onLayer("set_camera_options", "__new__:camera", { options: { zoom: 2500, depthOfField: true } }),
      onLayer("create_layer", "__new__:light", { layerType: "light", name: "Light 1" }),
      onLayer("set_light_options", "__new__:light", { options: { intensity: 300, coneAngle: 45 } }),
    ]);
  assert.equal(fieldOf(result, "ok"), true, optionalTextAt(result, "error", "message"));
  const camera = propertyAt(layerNamed(comp, "Camera 1"), 0);
  const light = propertyAt(layerNamed(comp, "Light 1"), 0);
  assert.equal(childAt(camera, 0).value, 2500);
  assert.equal(childAt(camera, 1).value, true);
  assert.equal(childAt(light, 0).value, 300);
  assert.equal(childAt(light, 2).value, 45);
});

test("apply_plan centre-justifies created text by default and honours a requested justification", () => {
  const { apply, comp } = loadApplyPlan();
  const result = applyPlan(apply, "created-text-justification", [
      onLayer("create_layer", "__new__:default", { layerType: "text", name: "Default text", text: "Hello" }),
      onLayer("create_layer", "__new__:right", { layerType: "text", name: "Right text", text: "Hello", justification: "RIGHT_JUSTIFY" }),
    ]);
  assert.equal(fieldOf(result, "ok"), true, optionalTextAt(result, "error", "message"));
  assert.equal(justificationOf(layerNamed(comp, "Default text")), 7415, "AE created it left-justified (7413); the host sets CENTER_JUSTIFY");
  assert.equal(justificationOf(layerNamed(comp, "Right text")), 7414);
  const wrongLayer = applyPlan(apply, "created-null-justification", [onLayer("create_layer", "__new__:null", { layerType: "null", name: "Null", justification: "RIGHT_JUSTIFY" })]);
  assert.equal(fieldOf(wrongLayer, "ok"), false);
  assert.equal(fieldOf(wrongLayer, "error", "code"), "INVALID_VALUE");
});

test("apply_plan rejects arbitrary or out-of-bounds 3D options", () => {
  const { apply } = loadApplyPlan();
  const arbitrary = applyPlan(apply, "three-d-bad", [onLayer("set_camera_options", "layer-camera", { options: { propertyPath: "ADBE Camera Zoom" } })]);
  assert.equal(fieldOf(arbitrary, "ok"), false);
  assert.equal(fieldOf(arbitrary, "error", "code"), "INVALID_VALUE");
  const bounds = applyPlan(apply, "three-d-bounds", [onLayer("set_light_options", "layer-light", { options: { coneAngle: 181 } })]);
  assert.equal(fieldOf(bounds, "ok"), false);
  assert.equal(fieldOf(bounds, "error", "code"), "INVALID_VALUE");
});

test("apply_plan rejects duplicate keyframe times before opening an undo group", () => {
  const { apply, calls } = loadApplyPlan();
  const result = applyPlan(apply, "bad-keys", [onLayer("animate_property", "layer-title", { propertyPath: POSITION, role: "transform.position", keyframes: [{ time: 1, value: [0, 0] }, { time: 1, value: [1, 1] }] })]);
  assert.equal(fieldOf(result, "ok"), false);
  assert.equal(fieldOf(result, "error", "code"), "INVALID_VALUE");
  assert.equal(calls.begin.length, 0);
});

test("apply_plan handles bounded native layer property, timing, audio, and create-layer operations", () => {
  const { apply, calls } = loadApplyPlan();
  const result = applyPlan(apply, "native-1", [
      onLayer("set_layer_property", "layer-title", { role: "transform.position", propertyPath: POSITION, value: [10, 20] }),
      onLayer("set_layer_timing", "layer-title", { inPoint: 1, outPoint: 5, startTime: 0.5 }),
      onLayer("set_audio", "layer-title", { enabled: false, levelDb: -6 }),
    ]);
  assert.equal(fieldOf(result, "ok"), true);
  assert.equal(listAt(result, "steps").length, 3);
  const created = applyPlan(apply, "create-1", [onLayer("create_layer", "__new__:shape-1", { layerType: "shape", name: "Generated Shape" })]);
  assert.equal(fieldOf(created, "ok"), true);
  assert.equal(fieldOf(created, "steps", 0, "layerType"), "shape");
  const unsupported = applyPlan(apply, "loop-1", [onLayer("set_loop", "layer-title", { mode: "cycle" })]);
  assert.equal(fieldOf(unsupported, "ok"), false);
  assert.equal(fieldOf(unsupported, "error", "code"), "UNSUPPORTED_OPERATION");
  assert.equal(calls.begin.length, 2);
});

test("apply_plan sets and clears a layer's parent, and rejects self-parenting", () => {
  const { apply, title, shapeLayer } = loadApplyPlan();
  const setParent = (planId: string, parentLayerId: string | null): JsonObject => applyPlan(apply, planId, [onLayer("set_layer_parent", "layer-title", { parentLayerId })]);
  assert.equal(fieldOf(setParent("parent-1", "layer-shape"), "ok"), true);
  assert.equal(title.parent, shapeLayer);
  assert.equal(fieldOf(setParent("parent-2", null), "ok"), true);
  assert.equal(title.parent, null);
  const selfParented = setParent("parent-3", "layer-title");
  assert.equal(fieldOf(selfParented, "ok"), false);
  assert.equal(fieldOf(selfParented, "error", "code"), "INVALID_VALUE");
});

test("apply_plan parents a layer to a null created earlier in the same plan", () => {
  const { apply, title, comp } = loadApplyPlan();
  const result = applyPlan(apply, "parent-planned-1", [
      onLayer("create_layer", "__new__:tracker", { layerType: "null", name: "Tracker" }),
      onLayer("set_layer_parent", "layer-title", { parentLayerId: "__new__:tracker" }),
    ]);
  assert.equal(fieldOf(result, "ok"), true);
  const createdNull = layerNamed(comp, "Tracker");
  assert.equal(comp.layerItems[comp.layerItems.length - 1], createdNull);
  assert.equal(title.parent, createdNull);
});
