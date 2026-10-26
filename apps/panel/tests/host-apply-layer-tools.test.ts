/**
 * Apply-plan host contract: Puppet pins, source replacement, anchors, text paths, analysis, solids and tracker nulls.
 * The fake host and payload builders live in host-apply-harness.ts.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { appOf } from "./host-apply-context.js";
import { FakeCompItem, FakeEffectParade, FakeFootageItem, FakeLayer, FakeMaskParade, FakeProperty, loadExtended } from "./host-apply-harness.js";
import { childAt, layerAt, layerProperty, positionOf, required } from "./host-fake-lookup.js";
import { type PlanApply, TITLE_TARGET, applyPlan, assertApplied, errorCode } from "./host-plan-io.js";
import vm from "node:vm";
import { fieldOf, listAt, numberAt, plain, textAt } from "./json-narrow.js";
import { decodeOrThrow, string, type JsonObject, type JsonValue } from "@extynt/decode";

test("apply_plan set_puppet_pins refuses layers that cannot be wrapped in a carrier, and bad pin values, before touching the project", () => {
  const { apply, context, comp, title } = loadExtended();
  Object.assign(context, { AVLayer: FakeLayer });
  const pins = (list: ReadonlyArray<JsonValue>, fields: JsonObject = {}) =>
    applyPlan(apply, "extended", [{ operation: "set_puppet_pins", ...TITLE_TARGET, pins: list, ...fields }]);
  const layersBefore = comp.layerItems.length;
  title.threeDLayer = true;
  assert.equal(errorCode(pins([{ x: 100, y: 100 }])), "PUPPET_LAYER_UNSUPPORTED");
  title.threeDLayer = false;
  title.adjustmentLayer = true;
  assert.equal(errorCode(pins([{ x: 100, y: 100 }])), "PUPPET_LAYER_UNSUPPORTED");
  title.adjustmentLayer = false;
  title.parent = layerAt(comp, 1);
  assert.equal(errorCode(pins([{ x: 100, y: 100 }])), "PUPPET_LAYER_UNSUPPORTED");
  assert.equal(comp.layerItems.length, layersBefore, "a refused layer is left alone");
  title.parent = null;
  assert.equal(errorCode(pins([])), "INVALID_VALUE");
  assert.equal(errorCode(pins([{ x: Number.NaN, y: 1 }])), "INVALID_VALUE");
  assert.equal(errorCode(pins([{ x: 1, y: 1, keyframes: [{ time: 1, x: 0, y: 0 }, { time: 1, x: 1, y: 1 }] }])), "INVALID_VALUE");
  assert.equal(errorCode(pins([{ x: 1, y: 1 }], { relative: "yes" })), "INVALID_VALUE");
});

function replaceSourceStep(apply: PlanApply, world: ReturnType<typeof loadExtended>): void {
  const { title, projectItems } = world;
  const plate = new FakeFootageItem("footage-plate", "plate.mov");
  projectItems.push(plate);
  const replacements: string[] = [];
  Object.assign(title, { replaceSource: (item: FakeFootageItem) => { replacements.push(item.id); title.source = item; } });
  const replace = (sourceItemId: string) => applyPlan(apply, "extended", [{ operation: "replace_layer_source", ...TITLE_TARGET, sourceItemId }]);
  assertApplied(replace(plate.id));
  assert.deepEqual(replacements, [plate.id]);
  assert.equal(errorCode(replace("nowhere")), "TARGET_NOT_FOUND");
}

function centreAnchorStep(apply: PlanApply, world: ReturnType<typeof loadExtended>): void {
  const { title } = world;
  const transform = layerProperty(title, "ADBE Transform Group");
  const position = positionOf(title);
  position.value = [500, 300];
  const anchor = new FakeProperty("ADBE Anchor Point", "Anchor Point", [], [0, 0], true);
  const scale = new FakeProperty("ADBE Scale", "Scale", [], [200, 100], true);
  transform.children.push(anchor, scale, new FakeProperty("ADBE Rotate Z", "Rotation", [], 90, true));
  Object.assign(title, { sourceRectAtTime: () => ({ left: 0, top: 0, width: 100, height: 40 }) });
  const centre = () => applyPlan(apply, "extended", [{ operation: "center_anchor", ...TITLE_TARGET }]);
  assertApplied(centre());
  assert.equal(JSON.stringify(anchor.value), "[50,20]");
  const moved = plain(position.value);
  assert.ok(Math.abs(numberAt(moved, 0) - 480) < 1e-6 && Math.abs(numberAt(moved, 1) - 400) < 1e-6, `position ${JSON.stringify(moved)}`);
  scale.setValueAtTime(0, [100, 100]);
  assert.equal(errorCode(centre()), "CONFLICTING_KEYS");
}

test("apply_plan replaces a layer's source, centres the anchor without moving the layer, and copies effects between layers", () => {
  const world = loadExtended();
  const { apply, shapeLayer } = world;
  replaceSourceStep(apply, world);
  centreAnchorStep(apply, world);
  const hasStack = shapeLayer.properties.some((property) => property.matchName === "ADBE Effect Parade");
  assert.equal(hasStack, false, "the shape layer starts without an effect stack, so copying onto it is refused");
  const copy = { operation: "copy_effects", compositionId: "comp-main", layerId: "layer-shape", source: TITLE_TARGET };
  assert.equal(errorCode(applyPlan(apply, "extended", [copy])), "EFFECT_NOT_FOUND");
});

function addTextPathOptions(title: FakeLayer): FakeProperty {
  const pathOptions = new FakeProperty("ADBE Text Path Options", "Path Options", [
    new FakeProperty("ADBE Text Path", "Path", [], 0, true),
    new FakeProperty("ADBE Text First Margin", "First Margin", [], 0, true),
    new FakeProperty("ADBE Text Last Margin", "Last Margin", [], 0, true),
  ], null, false);
  layerProperty(title, "ADBE Text Properties").children.push(pathOptions);
  title.properties.push(new FakeMaskParade([new FakeProperty("ADBE Mask Atom", "Mask 1", [], null, false)]));
  return pathOptions;
}

function installWarpStabilizer(parade: FakeEffectParade): void {
  Object.assign(parade, {
    canAddProperty: (matchName: string) => matchName === "ADBE SubspaceStabilizer",
    addProperty: (matchName: string) => {
      const status = new FakeProperty("ADBE SubspaceStabilizer-0011", "Analyzing in background (step 1 of 2)", [], 0, true);
      const effect = new FakeProperty(matchName, "Warp Stabilizer", [status], null, false);
      parade.children.push(effect);
      return effect;
    },
  });
}

function assertAnalysisStates(apply: PlanApply, parade: FakeEffectParade): void {
  const analysis = (kind: string) => applyPlan(apply, "extended", [{ operation: "start_analysis", compositionId: "comp-main", layerId: "layer-shape", kind }]);
  const started = analysis("warp-stabilizer");
  assertApplied(started);
  assert.equal(fieldOf(started, "steps", 0, "effectAdded"), true);
  assert.equal(fieldOf(started, "steps", 0, "analyzing"), true);
  childAt(childAt(parade, 0), 0).name = "";
  const polled = analysis("warp-stabilizer");
  assert.equal(fieldOf(polled, "steps", 0, "effectAdded"), false);
  assert.equal(fieldOf(polled, "steps", 0, "analyzing"), false);
  assert.equal(parade.children.length, 1, "a second call reads the status and never adds a second effect");
  assert.equal(errorCode(analysis("camera-tracker-3d")), "TRACKER_IGNORES_EFFECTS");
}

test("apply_plan sets text path options, opens a composition and leaves the viewer there, and reports analysis state", () => {
  const { apply, comp, title, context, shapeLayer } = loadExtended();
  const pathOptions = addTextPathOptions(title);
  const textPath = (fields: JsonObject) => applyPlan(apply, "extended", [{ operation: "set_text_path", ...TITLE_TARGET, ...fields }]);
  const set = textPath({ maskIndex: 1, firstMargin: 25 });
  assertApplied(set);
  assert.deepEqual(pathOptions.children.map((child) => child.value), [1, 25, 0]);
  assert.equal(errorCode(textPath({ maskIndex: 5 })), "INVALID_VALUE");
  assert.equal(errorCode(textPath({})), "INVALID_VALUE");

  const project = appOf(context).project;
  const other = new FakeCompItem("comp-other", []);
  project.activeItem = other;
  Object.assign(comp, { openInViewer: () => { project.activeItem = comp; } });
  Object.assign(other, { openInViewer: () => { project.activeItem = other; } });
  const opened = applyPlan(apply, "extended", [{ operation: "open_composition", compositionId: "comp-main" }]);
  assertApplied(opened);
  assert.equal(project.activeItem?.id, "comp-main", "the viewer stays on the opened composition");
  assert.equal(fieldOf(opened, "steps", 0, "activeCompositionId"), "comp-main", "the step carries the observed active composition id for the receipt to compare");

  const parade = new FakeEffectParade();
  shapeLayer.properties.push(parade);
  installWarpStabilizer(parade);
  assertAnalysisStates(apply, parade);
});

test("apply_plan resize_solid resizes a solid, and refuses while other layers share it unless allUsers is set", () => {
  const { apply, comp, title, context } = loadExtended();
  class FakeSolidSource {}
  const solid = Object.assign(new FakeFootageItem("solid-item", "Solid 1"), { width: 100, height: 100, pixelAspect: 1, mainSource: new FakeSolidSource() });
  Object.assign(context, { SolidSource: FakeSolidSource, CompItem: FakeCompItem });
  title.source = solid;
  const second = new FakeLayer("layer-second", []);
  second.attach(comp);
  comp.layerItems.push(second);
  second.source = solid;
  const resize = (fields: JsonObject) => applyPlan(apply, "extended", [{ operation: "resize_solid", ...TITLE_TARGET, allUsers: false, ...fields }]);
  const shared = resize({ width: 640, height: 360 });
  assert.equal(errorCode(shared), "SOLID_SHARED");
  assert.match(textAt(shared, "error", "message"), /layer-second|Layer|comp/i);
  assert.equal(solid.width, 100);
  const all = resize({ width: 640, height: 360, pixelAspect: 1.5, allUsers: true });
  assertApplied(all);
  assert.deepEqual([solid.width, solid.height, solid.pixelAspect], [640, 360, 1.5]);
  assert.equal(errorCode(resize({})), "INVALID_VALUE");
});

function installTrackerNulls(comp: FakeCompItem): FakeProperty[] {
  const positions: FakeProperty[] = [];
  Object.assign(comp.layers, {
    addNull: () => {
      const position = new FakeProperty("ADBE Position", "Position", [], [0, 0], true);
      const transform = new FakeProperty("ADBE Transform Group", "Transform", [position], null, false);
      const added = Object.assign(new FakeLayer(`null-${positions.length + 1}`, [transform]), { moveBefore: () => undefined });
      added.attach(comp);
      comp.layerItems.push(added);
      positions.push(position);
      return added;
    },
  });
  return positions;
}

test("apply_plan tracker_to_nulls makes one following null per track point and refuses a layer without tracker data", () => {
  const { apply, comp, title } = loadExtended();
  const toNulls = (fields: JsonObject) => applyPlan(apply, "extended", [{ operation: "tracker_to_nulls", ...TITLE_TARGET, point: "attach-point", ...fields }]);
  assert.equal(errorCode(toNulls({})), "TRACKER_DATA_MISSING");
  const point = (name: string) => new FakeProperty("ADBE MTracker Pt", name, [new FakeProperty("ADBE MTracker Pt Attach Pt", "Attach Point", [], [10, 20], true)], null, false);
  const tracker = new FakeProperty("ADBE MTracker", "Tracker 1", [point("Track Point 1"), point("Track Point 2")], null, false);
  title.properties.push(new FakeProperty("ADBE MTrackers", "Motion Trackers", [tracker], null, false));
  const positions = installTrackerNulls(comp);
  const made = toNulls({ trackerName: "Tracker 1" });
  assertApplied(made);
  assert.equal(listAt(made, "steps", 0, "nulls").length, 2);
  const first = required(positions[0], "first null position");
  assert.match(first.expression, /thisComp\.layer\("[^"]*"\); L\.toComp\(L\.motionTracker\("Tracker 1"\)\("Track Point 1"\)\.attachPoint\)/);
  assert.equal(first.expressionEnabled, true);
  assert.equal(errorCode(toNulls({ trackerName: "Nope" })), "TARGET_NOT_FOUND");
});

function presetNameFor(context: vm.Context, count: number, major: number): string {
  Reflect.set(context, "presetPinCount", count);
  Reflect.set(context, "presetMajorVersion", major);
  return decodeOrThrow(string(), vm.runInContext("aePuppetPresetName(presetPinCount, presetMajorVersion)", context));
}

test("the Puppet preset name is the AE 2025 copy below major 26 and the plain name from 26 on, for few and many pins", () => {
  const { context } = loadExtended();
  const presetName = (count: number, major: number): string => presetNameFor(context, count, major);
  assert.equal(presetName(16, 25), "puppet-grid-4x4-ae25-1080.ffx");
  assert.equal(presetName(17, 25), "puppet-grid-12x12-ae25-1080.ffx");
  assert.equal(presetName(16, 26), "puppet-grid-4x4-1080.ffx");
  assert.equal(presetName(64, 26), "puppet-grid-12x12-1080.ffx");
  assert.equal(presetName(4, 27), "puppet-grid-4x4-1080.ffx");
  assert.equal(presetName(64, 27), "puppet-grid-12x12-1080.ffx");
});
