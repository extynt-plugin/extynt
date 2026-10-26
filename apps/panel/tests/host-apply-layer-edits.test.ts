/**
 * Apply-plan host contract: created-layer resolution, attributes, timing, renames, duplication, removal, eases, Layer
 * Styles and presets. The fake host and payload builders live in host-apply-harness.ts.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { type FakeApp, appOf } from "./host-apply-context.js";
import { FakeCompItem, FakeLayer, FakeProperty, animatePosition, loadApplyPlan } from "./host-apply-harness.js";
import { childAt, easeSample, easeSamples, layerAt, layerProperty, positionOf, required } from "./host-fake-lookup.js";
import { type PlanApply, TITLE_TARGET, applyPlan, assertApplied, assertRefused, errorCode } from "./host-plan-io.js";
import { fieldOf, listAt, plain, recordAt, textAt } from "./json-narrow.js";

test("apply_plan resolves a created layer for later writes and reports its real AE id for receipt verification", () => {
  const { apply, comp } = loadApplyPlan();
  const result = applyPlan(apply, "created-layer-write-1", [
    { operation: "create_layer", compositionId: "comp-main", layerId: "__new__:layer0", layerType: "null", name: "Temporary" },
    { operation: "set_layer_name", compositionId: "comp-main", layerId: "__new__:layer0", name: "Resolved Null" },
    { operation: "set_layer_timing", compositionId: "comp-main", layerId: "__new__:layer0", inPoint: 1, outPoint: 4, startTime: 0.5 },
  ]);

  assertApplied(result);
  assert.equal(listAt(result, "steps").length, 3);
  const createStep = recordAt(result, "steps", 0);
  assert.equal(fieldOf(createStep, "requestedLayerId"), "__new__:layer0");
  assert.match(textAt(createStep, "layerId"), /^created-\d+$/);
  const created = required(comp.layerItems.at(-1), "created layer");
  assert.equal(created.id, fieldOf(createStep, "layerId"));
  assert.equal(created.name, "Resolved Null");
  assert.equal(created.inPoint, 1);
  assert.equal(created.outPoint, 4);
  assert.equal(created.startTime, 0.5);
});

test("apply_plan sets blend-mode, three-d, shy, solo, and enabled attributes", () => {
  const { apply, title } = loadApplyPlan();
  const result = applyPlan(apply, "attribute-1", [
    { operation: "set_layer_attribute", ...TITLE_TARGET, role: "blend-mode", value: "SCREEN" },
    { operation: "set_layer_attribute", ...TITLE_TARGET, role: "three-d", value: true },
    { operation: "set_layer_attribute", ...TITLE_TARGET, role: "shy", value: true },
  ]);
  assertApplied(result);
  assert.equal(title.blendingMode, "screen");
  assert.equal(title.threeDLayer, true);
  assert.equal(title.shy, true);
});

test("apply_plan creates an adjustment layer sized to the composition, for comp-wide grading", () => {
  const { apply } = loadApplyPlan();
  const result = applyPlan(apply, "adjustment-1", [
    { operation: "create_layer", compositionId: "comp-main", layerId: "__new__:grade-1", layerType: "adjustment", name: "Grade" },
  ]);
  assertApplied(result);
  assert.equal(fieldOf(result, "steps", 0, "layerType"), "adjustment");
  assert.equal(fieldOf(result, "steps", 0, "name"), "Grade");
});

test("apply_plan sets a bounded stretch percentage via set_layer_timing", () => {
  const { apply, title } = loadApplyPlan();
  const result = applyPlan(apply, "speed-1", [{ operation: "set_layer_timing", ...TITLE_TARGET, stretch: 50 }]);
  assertApplied(result);
  assert.equal(title.stretch, 50);
  assert.equal(fieldOf(result, "steps", 0, "stretch"), 50);
});

test("apply_plan batch-renames several layers with set_layer_name", () => {
  const { apply, title, shapeLayer } = loadApplyPlan();
  const result = applyPlan(apply, "rename-1", [
    { operation: "set_layer_name", ...TITLE_TARGET, name: "Title_01" },
    { operation: "set_layer_name", compositionId: "comp-main", layerId: "layer-shape", name: "Shape_01" },
  ]);
  assertApplied(result);
  assert.equal(title.name, "Title_01");
  assert.equal(shapeLayer.name, "Shape_01");
  assert.equal(fieldOf(result, "steps", 0, "beforeValue"), "layer-title");
  assert.equal(fieldOf(result, "steps", 0, "afterValue"), "Title_01");
});

test("apply_plan duplicates a layer, resolves its placeholder for later writes, and returns the real layer id", () => {
  const { apply, comp } = loadApplyPlan();
  const result = applyPlan(apply, "duplicate-1", [
    { operation: "duplicate_layer", ...TITLE_TARGET, newLayerId: "__new__:layer0" },
    { operation: "set_layer_name", compositionId: "comp-main", layerId: "__new__:layer0", name: "Title Copy" },
  ]);
  assertApplied(result);
  assert.equal(fieldOf(result, "steps", 0, "requestedLayerId"), "__new__:layer0");
  assert.match(textAt(result, "steps", 0, "layerId"), /^duplicate-layer-title-/);
  assert.equal(layerAt(comp, 0).name, "Title Copy");
});

test("apply_plan requires explicit destructive confirmation before removing a layer", () => {
  const { apply, comp } = loadApplyPlan();
  const denied = applyPlan(apply, "remove-denied", [{ operation: "remove_layer", ...TITLE_TARGET }]);
  assertRefused(denied, "DESTRUCTIVE_CONFIRMATION_REQUIRED");
  assert.equal(comp.layerItems.length, 4);
  const removed = applyPlan(apply, "remove-confirmed", [{ operation: "remove_layer", ...TITLE_TARGET, destructive: true }]);
  assertApplied(removed);
  assert.equal(fieldOf(removed, "steps", 0, "verification"), "layer-absent");
  assert.equal(comp.layerItems.length, 3);
});

test("apply_plan maps a cubic-bezier curve to AE speed/influence with one ease per side on spatial properties", () => {
  const { apply, title } = loadApplyPlan();
  const position = positionOf(title);
  position.isSpatial = true;
  const curve = { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 };
  const result = applyPlan(apply, "curve", [animatePosition([{ time: 0, value: [0, 0], curve }, { time: 2, value: [300, 400] }])]);
  assertApplied(result);
  assert.equal(easeSamples(position, 0, "outEase").length, 1);
  assert.equal(easeSamples(position, 1, "inEase").length, 1);
  const out = easeSample(position, 0, "outEase");
  const incoming = easeSample(position, 1, "inEase");
  assert.ok(Math.abs(out.influence - 25) < 1e-9);
  assert.ok(Math.abs(out.speed - 100) < 1e-9);
  assert.ok(Math.abs(incoming.influence - 75) < 1e-9);
  assert.ok(Math.abs(incoming.speed - 0) < 1e-9);
  assert.deepEqual(plain(position.interpolation[0]), { inType: "linear", outType: "bezier" });
});

test("apply_plan applies explicit eases, spatial tangents, roving, and large keyframe batches", () => {
  const { apply, title } = loadApplyPlan();
  const position = positionOf(title);
  position.isSpatial = true;
  const shaped = applyPlan(apply, "shaped", [
    animatePosition([
      { time: 0, value: [0, 0], ease: { out: { speed: 0, influence: 80 } }, spatial: { outTangent: [50, 0] } },
      { time: 1, value: [100, 0], roving: true },
      { time: 2, value: [200, 0], ease: { in: { speed: 0, influence: 80 } }, spatial: { inTangent: [-50, 0] } },
    ]),
  ]);
  assertApplied(shaped);
  assert.deepEqual(Array.from(easeSamples(position, 0, "outEase"), (ease) => ease.influence), [80]);
  assert.deepEqual(plain(position.spatialTangents[0]), { inTangent: [0, 0, 0], outTangent: [50, 0, 0] });
  assert.equal(position.roving[1], true);
  const frames = Array.from({ length: 600 }, (_, index) => ({ time: 10 + index / 30, value: [index, index] }));
  const bulk = applyPlan(apply, "bulk", [animatePosition(frames, { keyframeMode: "merge" })]);
  assertApplied(bulk);
  assert.equal(position.numKeys, 603);
  const lastCurve = { time: 50, value: [0, 0], curve: { x1: 0.4, y1: 0, x2: 0.2, y2: 1 } };
  const refused = applyPlan(apply, "last-curve", [animatePosition([lastCurve], { keyframeMode: "merge" })]);
  assert.equal(fieldOf(refused, "ok"), false);
});

test("apply_plan animates an unseparated Position even though AE 26 reports isSeparationLeader=true", () => {
  const { apply, calls, title } = loadApplyPlan();
  const position = positionOf(title);
  Object.assign(position, { isSeparationLeader: true, isSpatial: true });
  const curve = { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 };
  const result = applyPlan(apply, "leader", [animatePosition([{ time: 0, value: [200, 540], curve }, { time: 2, value: [1720, 540] }])]);
  assertApplied(result);
  assert.equal(position.numKeys, 2);
  position.dimensionsSeparated = true;
  const beginBefore = calls.begin.length;
  const separated = applyPlan(apply, "separated", [animatePosition([{ time: 3, value: [0, 0] }], { keyframeMode: "merge" })]);
  assertRefused(separated, "SEPARATED_DIMENSIONS_UNSUPPORTED");
  assert.equal(calls.begin.length, beginBefore);
});

test("apply_plan replace mode clears keys in a single-operation plan and shape errors reject before any write", () => {
  const { apply, calls, title } = loadApplyPlan();
  const position = positionOf(title);
  position.setValueAtTime(5, [1, 1]);
  position.setValueAtTime(6, [2, 2]);
  const replacement = [{ time: 1, value: [3, 3] }, { time: 2, value: [4, 4] }];
  const replaced = applyPlan(apply, "replace-only", [animatePosition(replacement, { keyframeMode: "replace" })]);
  assertApplied(replaced);
  assert.equal(fieldOf(replaced, "steps", 0, "keyframeMode"), "replace");
  assert.equal(fieldOf(replaced, "steps", 0, "removedKeys"), 2);
  assert.deepEqual(plain(position.keyframes.map((key) => key.time)), [1, 2]);
  const beginBefore = calls.begin.length;
  const spatialOnFlat = applyPlan(apply, "flat-spatial", [
    { operation: "set_text_document", ...TITLE_TARGET, text: "must not be written" },
    animatePosition([{ time: 7, value: [0, 0], spatial: { outTangent: [10, 0] } }, { time: 8, value: [1, 1] }], { keyframeMode: "merge" }),
  ]);
  assertRefused(spatialOnFlat, "SPATIAL_UNSUPPORTED");
  assert.equal(fieldOf(spatialOnFlat, "mayHaveMutated"), false);
  assert.equal(calls.begin.length, beginBefore);
  assert.equal(position.numKeys, 2);
});

test("apply_plan resolves Layer Style properties whose matchNames contain a slash via escaped path segments", () => {
  const { apply, title } = loadApplyPlan();
  const opacity = new FakeProperty("dropShadow/opacity", "Opacity", [], 75, true);
  const shadow = new FakeProperty("dropShadow/frameFX", "Drop Shadow", [opacity], null, false);
  title.properties.push(new FakeProperty("ADBE Layer Styles", "Layer Styles", [shadow], null, false));
  const result = applyPlan(apply, "styles", [
    {
      operation: "animate_property", ...TITLE_TARGET, propertyPath: "ADBE Layer Styles/dropShadow%2FframeFX/dropShadow%2Fopacity",
      keyframes: [{ time: 0, value: 0 }, { time: 1, value: 75 }],
    },
  ]);
  assertApplied(result);
  assert.equal(opacity.numKeys, 2);
});

interface StyleWorld {
  readonly apply: PlanApply;
  readonly app: FakeApp;
  readonly comp: FakeCompItem;
  readonly other: FakeCompItem;
  readonly title: FakeLayer;
  readonly shapeLayer: FakeLayer;
  readonly shadow: FakeProperty;
  readonly glow: FakeProperty;
  readonly viewer: string[];
  readonly presetSelections: string[][];
  readonly commands: Array<{ id: number; selected: string[] }>;
  stylesLive: boolean;
}

const SHADOW_STYLE = {
  operation: "ensure_layer_style", ...TITLE_TARGET, style: "drop-shadow", styleMatchName: "dropShadow/enabled", menu: "Drop Shadow", commandId: 9000,
} as const;
const GLOW_PATH = "ADBE Effect Parade/ADBE Glo2/ADBE Glo2-0003";
const COLOR_PATH = "ADBE Effect Parade/ADBE Glo2/ADBE Glo2-0010";

function selectedIds(comp: FakeCompItem): string[] {
  return comp.layerItems.filter((layer) => layer.selected).map((layer) => layer.id);
}

function glowControl(propertyPath: string, value: number | number[]) {
  return { operation: "set_effect_control", ...TITLE_TARGET, effectMatchName: "ADBE Glo2", propertyPath, value };
}

function installViewers(app: FakeApp, comp: FakeCompItem, other: FakeCompItem, viewer: string[]): void {
  const { project } = app;
  project.activeItem = other;
  Object.assign(comp, { openInViewer: () => { viewer.push(comp.id); project.activeItem = comp; } });
  Object.assign(other, { openInViewer: () => { viewer.push(other.id); project.activeItem = other; } });
}

function installPreset(world: Pick<StyleWorld, "comp" | "title" | "presetSelections">): void {
  const { comp, title, presetSelections } = world;
  const effects = layerProperty(title, "ADBE Effect Parade");
  const slider = new FakeProperty("ADBE Slider Control", "Slider", [new FakeProperty("ADBE Slider Control-0001", "Slider", [], 0, true)], null, false);
  Object.assign(title, {
    applyPreset: (file: { fsName: string }) => {
      presetSelections.push(selectedIds(comp));
      assert.equal(file.fsName, "/presets/Behaviors/Wiggle.ffx");
      effects.children.push(slider, new FakeProperty("ADBE Geometry2", "Transform", [], null, false));
    },
  });
}

function installMenuCommands(world: StyleWorld): void {
  const { app, comp, title, shadow, commands } = world;
  app.findMenuCommandId = (name: string) => (world.stylesLive && name === "Outer Glow" ? 9002 : 0);
  app.executeCommand = (id: number) => {
    commands.push({ id, selected: selectedIds(comp) });
    if (id === 9000 && title.selected) {
      shadow.enabled = true;
      Object.assign(shadow, { canSetEnabled: true });
    }
  };
}

function buildStyleWorld(): StyleWorld {
  const { apply, comp, title, shapeLayer, context } = loadApplyPlan();
  const app = appOf(context);
  const other = new FakeCompItem("comp-other", [new FakeLayer("layer-other", [])]);
  layerAt(other, 0).selected = true;
  const viewer: string[] = [];
  installViewers(app, comp, other, viewer);
  shapeLayer.selected = true;
  const shadow = new FakeProperty("dropShadow/enabled", "Drop Shadow", [new FakeProperty("dropShadow/opacity", "Opacity", [], 75, true)], null, false);
  shadow.enabled = false;
  Object.assign(shadow, { canSetEnabled: false });
  title.properties.push(new FakeProperty("ADBE Layer Styles", "Layer Styles", [shadow], null, false));
  const glow = new FakeProperty("ADBE Glo2", "Glow", [
    new FakeProperty("ADBE Glo2-0003", "Glow Radius", [], 10, true),
    new FakeProperty("ADBE Glo2-0010", "Color A", [], [1, 1, 1, 1], true),
  ], null, false);
  layerProperty(title, "ADBE Effect Parade").children.push(glow);
  const world: StyleWorld = { apply, app, comp, other, title, shapeLayer, shadow, glow, viewer, presetSelections: [], commands: [], stylesLive: true };
  installPreset(world);
  installMenuCommands(world);
  return world;
}

function assertPresetAndStyleApplied(world: StyleWorld): void {
  const { apply, shadow, glow, title, shapeLayer, other } = world;
  const result = applyPlan(apply, "min-bar", [
    { operation: "apply_preset", compositionId: "comp-main", layerId: "layer-title", presetId: "preset:ae-presets:0123456789abcdef0123", presetPath: "/presets/Behaviors/Wiggle.ffx" },
    { ...SHADOW_STYLE, enabled: true, values: { "dropShadow/opacity": 40 } },
    glowControl(GLOW_PATH, 25),
    glowControl(COLOR_PATH, [1, 0.5, 0]),
  ]);
  assertApplied(result);
  assert.deepEqual(world.presetSelections, [["layer-title"]], "the preset saw only the target layer selected");
  assert.deepEqual(fieldOf(result, "steps", 0, "added"), { effects: ["ADBE Slider Control", "ADBE Geometry2"], animators: 0, keyed: 0, expressions: 0 });
  assert.equal(fieldOf(result, "steps", 0, "changed"), true);
  assert.equal(JSON.stringify(fieldOf(result, "steps")).includes("/presets/"), false, "host steps never echo the preset path");
  assert.deepEqual(world.commands, [{ id: 9000, selected: ["layer-title"] }]);
  assert.equal(fieldOf(result, "steps", 1, "created"), true);
  assert.equal(shadow.enabled, true);
  assert.equal(childAt(shadow, 0).value, 40, "style values are written after the style is added");
  const badKey = applyPlan(apply, "bad-key", [{ ...SHADOW_STYLE, enabled: true, values: { "frameFX/size": 3 } }]);
  assert.equal(errorCode(badKey), "INVALID_VALUE", "a setting from another style is refused");
  assert.equal(childAt(glow, 0).value, 25);
  assert.deepEqual(plain(childAt(glow, 1).value), [1, 0.5, 0, 1], "RGB is padded with alpha for AE color controls");
  assert.deepEqual(world.viewer, ["comp-main", "comp-other"], "the original viewer is reopened");
  assert.equal(shapeLayer.selected, true);
  assert.equal(title.selected, false, "the target comp's selection is restored");
  assert.equal(layerAt(other, 0).selected, true, "the original comp's selection is restored");
}

function assertStylesRefused(world: StyleWorld): void {
  const { apply, shadow, glow, commands } = world;
  const off = applyPlan(apply, "style-off", [{ ...SHADOW_STYLE, enabled: false }]);
  assertApplied(off);
  assert.equal(shadow.enabled, false);
  assert.equal(commands.length, 1);
  const forged = applyPlan(apply, "forged", [{ ...SHADOW_STYLE, commandId: 2072, enabled: true }]);
  assert.equal(fieldOf(forged, "ok"), false);
  assert.equal(errorCode(forged), "INVALID_VALUE", "an unknown menu command id is never executed");
  world.stylesLive = false;
  Object.assign(shadow, { canSetEnabled: false });
  shadow.enabled = false;
  const inert = applyPlan(apply, "inert", [glowControl(GLOW_PATH, 60), { ...SHADOW_STYLE, enabled: true }]);
  assert.equal(errorCode(inert), "LAYER_STYLES_UNSUPPORTED");
  assert.equal(fieldOf(inert, "mutationState"), "not-applied");
  assert.match(textAt(inert, "error", "message"), /ensure_effect/, "the refusal names the effect to use instead");
  assert.equal(childAt(glow, 0).value, 25, "nothing before the style was written");
  assert.equal(commands.length, 1, "the inert command never ran");
  world.stylesLive = true;
}

function assertPresetAndControlRefused(world: StyleWorld): void {
  const { apply, glow } = world;
  const missing = applyPlan(apply, "missing", [
    { operation: "apply_preset", ...TITLE_TARGET, presetId: "preset:ae-presets:0123456789abcdef0123", presetPath: "/gone/Wiggle.ffx" },
  ]);
  assert.equal(errorCode(missing), "PRESET_NOT_FOUND");
  assert.equal(fieldOf(missing, "mutationState"), "not-applied");
  childAt(glow, 0).numKeys = 2;
  assert.equal(errorCode(applyPlan(apply, "keyed", [glowControl(GLOW_PATH, 5)])), "CONFLICTING_KEYS");
}

test("presets, Layer Styles, and static effect controls run through typed host handlers and put the viewer and selection back", () => {
  const world = buildStyleWorld();
  assertPresetAndStyleApplied(world);
  assertStylesRefused(world);
  assertPresetAndControlRefused(world);
});
