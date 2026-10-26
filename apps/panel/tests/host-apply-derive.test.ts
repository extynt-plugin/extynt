/**
 * Apply-plan host contract for derive_layer and retime_layer: split by duplicate and trim, the menu-command kinds with
 * selection restore and layer-diff readback, path nulls built from expressions, and the time-remap reverse and freeze.
 */

import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { FakeLayer, FakeProperty, loadApplyPlan } from "./host-apply-harness.js";
import { applyPlan, assertApplied } from "./host-plan-io.js";
import { type Found, fieldOf, listAt } from "./json-narrow.js";
import { type JsonObject, type JsonValue } from "@extynt/decode";

type Loaded = ReturnType<typeof loadApplyPlan>;

interface MenuHooks {
  readonly lookUp: (name: string) => number;
  readonly run: (id: number) => void;
}

const ACTIVATE_COMP = "app.project.activeItem = activeComp";
const INSTALL_MENU = [
  "app.findMenuCommandId = function (name) { return lookUpCommand(name); }",
  "app.executeCommand = function (id) { runCommand(id); }",
].join("\n");
const SHAPES_FROM_TEXT: JsonValue = { operation: "derive_layer", compositionId: "comp-main", layerId: "layer-title", kind: "shapes-from-text", newLayerId: "__new__:outlines" };

function send(loaded: Loaded, operations: ReadonlyArray<JsonValue>): JsonObject {
  return applyPlan(loaded.apply, "derive-1", operations);
}

function splitAt(time: number): JsonValue {
  return { operation: "derive_layer", compositionId: "comp-main", layerId: "layer-title", kind: "split", newLayerId: "__new__:half", time };
}

function errorCode(result: JsonObject): Found {
  return fieldOf(result, "error", "code");
}

function errorMessage(result: JsonObject): string {
  return String(fieldOf(result, "error", "message"));
}

function selectedIds(loaded: Loaded): string[] {
  return loaded.comp.layerItems.filter((layer) => layer.selected).map((layer) => layer.id);
}

function activateComp(loaded: Loaded): void {
  Object.assign(loaded.context, { activeComp: loaded.comp });
  vm.runInContext(ACTIVATE_COMP, loaded.context);
}

function installMenu(loaded: Loaded, hooks: MenuHooks): void {
  Object.assign(loaded.context, { lookUpCommand: hooks.lookUp, runCommand: hooks.run });
  vm.runInContext(INSTALL_MENU, loaded.context);
}

function carryLengthWithInPoint(loaded: Loaded): void {
  const { title, comp } = loaded;
  title.duplicate = () => {
    const copy = comp.duplicateLayer(title);
    let start = 0;
    copy.outPoint = title.outPoint;
    const move = (value: number): void => {
      copy.outPoint += value - start;
      start = value;
    };
    Object.defineProperty(copy, "inPoint", { get: () => start, set: move });
    return copy;
  };
}

test("derive_layer split duplicates the layer, ends the first half at the time and starts the copy there", () => {
  const loaded = loadApplyPlan();
  const result = send(loaded, [splitAt(4), { operation: "set_layer_name", compositionId: "comp-main", layerId: "__new__:half", name: "Second half" }]);
  assertApplied(result);
  assert.equal(fieldOf(result, "steps", 0, "kind"), "split");
  assert.equal(fieldOf(result, "steps", 0, "requestedLayerId"), "__new__:half");
  assert.equal(loaded.title.outPoint, 4);
  const copy = loaded.comp.layerItems.find((layer) => layer.name === "Second half");
  assert.ok(copy);
  assert.equal(copy.inPoint, 4);
  assert.equal(copy.outPoint, 10);
  assert.equal(fieldOf(result, "steps", 0, "layerId"), copy.id);
});

test("derive_layer split keeps the copy's end when After Effects carries the layer length along with a moved in point", () => {
  const loaded = loadApplyPlan();
  carryLengthWithInPoint(loaded);
  const result = send(loaded, [splitAt(4)]);
  assertApplied(result);
  const copy = loaded.comp.layerItems.find((layer) => layer.id === fieldOf(result, "steps", 0, "layerId"));
  assert.equal(copy?.inPoint, 4);
  assert.equal(copy?.outPoint, 10);
  assert.equal(loaded.title.outPoint, 4);
});

test("derive_layer split leaves the user's selection as it was", () => {
  const loaded = loadApplyPlan();
  loaded.title.selected = true;
  assertApplied(send(loaded, [splitAt(4)]));
  assert.deepEqual(selectedIds(loaded), [loaded.title.id]);
});

test("derive_layer refuses a split time outside the layer and an unknown kind before writing", () => {
  const loaded = loadApplyPlan();
  const outside = send(loaded, [splitAt(10)]);
  assert.equal(fieldOf(outside, "ok"), false);
  assert.equal(loaded.comp.layerItems.length, 4);
  const unknown = send(loaded, [{ operation: "derive_layer", compositionId: "comp-main", layerId: "layer-title", kind: "explode", newLayerId: "__new__:half" }]);
  assert.equal(errorCode(unknown), "INVALID_VALUE");
  const stray = send(loaded, [{ operation: "derive_layer", compositionId: "comp-main", layerId: "layer-title", kind: "shapes-from-text", newLayerId: "__new__:s", time: 2 }]);
  assert.equal(errorCode(stray), "INVALID_VALUE");
});

test("derive_layer menu commands look the id up by name, keep the selection, and read the new layer back", () => {
  const loaded = loadApplyPlan();
  const asked: string[] = [];
  const ran: number[] = [];
  activateComp(loaded);
  installMenu(loaded, {
    lookUp: (name) => {
      asked.push(name);
      return 4242;
    },
    run: (id) => {
      ran.push(id);
      loaded.comp.layers.addShape().selected = true;
    },
  });
  loaded.shapeLayer.selected = true;
  const result = send(loaded, [SHAPES_FROM_TEXT]);
  assertApplied(result);
  assert.deepEqual(asked, ["Create Shapes from Text"]);
  assert.deepEqual(ran, [4242]);
  assert.equal(loaded.title.selected, false);
  assert.equal(loaded.shapeLayer.selected, true);
  assert.deepEqual(selectedIds(loaded), [loaded.shapeLayer.id], "the command's own result is not left selected");
  assert.equal(fieldOf(result, "steps", 0, "layerId"), loaded.comp.layerItems.at(-1)?.id);
});

test("derive_layer says so when the menu command is missing, did nothing, or the layer cannot take it", () => {
  const loaded = loadApplyPlan();
  activateComp(loaded);
  assert.match(errorMessage(send(loaded, [SHAPES_FROM_TEXT])), /DERIVE_COMMAND_UNAVAILABLE/);
  installMenu(loaded, { lookUp: () => 7, run: () => undefined });
  assert.match(errorMessage(send(loaded, [SHAPES_FROM_TEXT])), /DERIVE_COMMAND_FAILED/);
  const audio: JsonValue = { operation: "derive_layer", compositionId: "comp-main", layerId: "layer-title", kind: "audio-keyframes", newLayerId: "__new__:amp" };
  assert.match(errorMessage(send(loaded, [audio])), /INVALID_TARGET/);
});

function linkPath(layer: FakeLayer, matchNames: ReadonlyArray<string>): void {
  let parent: FakeProperty | null = null;
  matchNames.forEach((matchName, depth) => {
    const siblings: FakeProperty[] = parent ? parent.children : layer.properties;
    const property = siblings.find((candidate) => candidate.matchName === matchName);
    assert.ok(property, matchName);
    Object.assign(property, { parentProperty: parent, propertyDepth: depth });
    parent = property;
  });
}

function positionedTransform(): FakeProperty {
  const position = new FakeProperty("ADBE Position", "Position", [], [0, 0], true);
  const group = new FakeProperty("ADBE Transform Group", "Transform", [position], null, false);
  const find = (name: string): FakeProperty | null => group.children.find((child) => child.matchName === name) ?? null;
  return Object.assign(group, { property: find });
}

function giveNullsATransform(loaded: Loaded): void {
  const addNull = loaded.comp.layers.addNull;
  loaded.comp.layers.addNull = () => {
    const created = addNull();
    created.properties.push(positionedTransform());
    return Object.assign(created, { nullLayer: true });
  };
}

test("derive_layer path-null builds a null whose position expression follows the mask point", () => {
  const loaded = loadApplyPlan();
  giveNullsATransform(loaded);
  linkPath(loaded.shapeLayer, ["ADBE Mask Parade", "ADBE Mask Atom", "ADBE Mask Shape"]);
  loaded.shapeLayer.name = "Outline";
  const result = send(loaded, [
    { operation: "derive_layer", compositionId: "comp-main", layerId: "layer-shape", kind: "path-null", newLayerId: "__new__:pt", propertyPath: "ADBE Mask Parade/ADBE Mask Atom/ADBE Mask Shape", pointIndex: 2, pointKind: "outTangent", name: "Handle" },
  ]);
  assertApplied(result);
  const created = loaded.comp.layerItems.find((layer) => layer.name === "Handle");
  assert.ok(created);
  const position = created.property("ADBE Transform Group")?.children[0];
  assert.equal(position?.expression, 'var L = thisComp.layer("Outline"); var P = L.mask("Mask 1").maskPath; var q = L.toComp(P.points()[2] + P.outTangents()[2]); [q[0], q[1]];');
  assert.equal(fieldOf(result, "steps", 0, "name"), "Handle");
});

test("derive_layer path-null refuses a path that is not a mask or shape path", () => {
  const loaded = loadApplyPlan();
  const result = send(loaded, [{ operation: "derive_layer", compositionId: "comp-main", layerId: "layer-title", kind: "path-null", newLayerId: "__new__:pt", propertyPath: "ADBE Transform Group/ADBE Position", pointIndex: 0 }]);
  assert.equal(fieldOf(result, "ok"), false);
  assert.equal(loaded.comp.layerItems.length, 4);
});

function remapLayer(layer: FakeLayer): FakeProperty {
  const remap = new FakeProperty("ADBE Time Remapping", "Time Remap", [], 0, true);
  const writeKey = (index: number, value: number): void => {
    const key = remap.keyframes[index - 1];
    if (key) key.value = value;
  };
  Object.assign(remap, { setValueAtKey: writeKey });
  let enabled = false;
  const enable = (value: boolean): void => {
    if (value && !enabled) {
      remap.setValueAtTime(0, 0);
      remap.setValueAtTime(10, 8);
      layer.properties.push(remap);
    }
    enabled = value;
  };
  Object.defineProperty(layer, "timeRemapEnabled", { get: () => enabled, set: enable });
  return remap;
}

function retime(mode: string, time?: number): JsonValue {
  const operation = { operation: "retime_layer", compositionId: "comp-main", layerId: "layer-title", mode };
  return time === undefined ? operation : { ...operation, time };
}

test("retime_layer reverse swaps the two time remap keys and freeze holds the value at the chosen time", () => {
  const loaded = loadApplyPlan();
  const reversed = remapLayer(loaded.title);
  const result = send(loaded, [retime("reverse")]);
  assertApplied(result);
  assert.deepEqual(reversed.keyframes.map((key) => key.value), [8, 0]);
  assert.equal(fieldOf(result, "steps", 0, "verification"), "time-remap-keys");
  const other = loadApplyPlan();
  const held = remapLayer(other.title);
  assertApplied(send(other, [retime("freeze", 5)]));
  assert.deepEqual(held.keyframes.map((key) => key.value), [4, 4]);
});

test("retime_layer reverse is idempotent: replaying the plan does not flip the layer back", () => {
  const loaded = loadApplyPlan();
  const reversed = remapLayer(loaded.title);
  assertApplied(send(loaded, [retime("reverse")]));
  assertApplied(send(loaded, [retime("reverse")]));
  assert.deepEqual(reversed.keyframes.map((key) => key.value), [8, 0]);
});

test("retime_layer then animate_property on Time Remapping is accepted in one plan, and a keyed remap is refused", () => {
  const loaded = loadApplyPlan();
  const remap = remapLayer(loaded.title);
  const animate: JsonValue = { operation: "animate_property", compositionId: "comp-main", layerId: "layer-title", propertyPath: "ADBE Time Remapping", keyframeMode: "replace", keyframes: [{ time: 0, value: 8 }, { time: 10, value: 0 }] };
  const result = send(loaded, [retime("reverse"), animate]);
  assertApplied(result);
  assert.equal(listAt(result, "steps").length, 2);
  assert.ok(remap.numKeys >= 2);
  const keyed = loadApplyPlan();
  const existing = remapLayer(keyed.title);
  keyed.title.timeRemapEnabled = true;
  existing.setValueAtTime(5, 3);
  const refused = send(keyed, [retime("reverse")]);
  assert.equal(fieldOf(refused, "ok"), false);
});
