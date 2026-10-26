/**
 * Apply-plan host contract: shape items, precompose and guides, Essential Graphics and MOGRT export, composition duplication,
 * and the routine collection pulse. The fake host and payload builders live in host-apply-harness.ts.
 */
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { appOf } from "./host-apply-context.js";
import { FakeCompItem, type FakeFootageItem, FakeLayer, loadExtended } from "./host-apply-harness.js";
import { childAt, layerAt, positionOf, required } from "./host-fake-lookup.js";
import { TITLE_TARGET, applyPlan, assertApplied, assertRefused, errorCode } from "./host-plan-io.js";
import { hostGlobal, isText } from "./host-vm-context.js";
import { fieldOf, plain, readJson, recordOf } from "./json-narrow.js";
import type { FakeTemplateTarget } from "./host-fake-property.js";
import { loadHostFiles } from "./host-sources.js";
import { type JsonObject } from "@extynt/decode";

type World = ReturnType<typeof loadExtended>;

const SHAPE_LAYER = { compositionId: "comp-main", layerId: "layer-shapes" } as const;

test("add_shape_item and update_shape_item write allowlisted item paths by index", () => {
  const { apply, root } = loadExtended();
  const added = applyPlan(apply, "extended", [
    { operation: "add_shape_item", ...SHAPE_LAYER, groupId: "root", itemMatchName: "ADBE Vector Shape - Rect", newItemId: "__new__:r", writes: [{ path: "ADBE Vector Rect Size", value: [200, 50] }], animations: [] },
    {
      operation: "add_shape_item", ...SHAPE_LAYER, groupId: "root", itemMatchName: "ADBE Vector Filter - Repeater", newItemId: "__new__:rep", name: "Echo",
      writes: [{ path: "ADBE Vector Repeater Copies", value: 6 }, { path: "ADBE Vector Repeater Transform/ADBE Vector Repeater Position", value: [40, 0] }], animations: [],
    },
  ]);
  assertApplied(added);
  assert.equal(fieldOf(added, "steps", 1, "containerPath"), "ADBE Root Vectors Group/ADBE Vector Filter - Repeater");
  const repeater = childAt(root, 1);
  assert.equal(repeater.name, "Echo");
  assert.equal(childAt(repeater, 0).value, 6);
  assert.deepEqual(plain(childAt(childAt(repeater, 2), 0).value), [40, 0]);
  const updated = applyPlan(apply, "extended", [
    { operation: "update_shape_item", ...SHAPE_LAYER, groupId: "root", itemMatchName: "ADBE Vector Filter - Repeater", itemId: "item:1", writes: [{ path: "ADBE Vector Repeater Copies", value: 9 }], animations: [] },
  ]);
  assertApplied(updated);
  assert.equal(childAt(repeater, 0).value, 9);
  const foreignWrite = applyPlan(apply, "extended", [
    { operation: "add_shape_item", ...SHAPE_LAYER, groupId: "root", itemMatchName: "ADBE Vector Filter - Repeater", newItemId: "__new__:x", writes: [{ path: "ADBE Vector Rect Size", value: [1, 1] }], animations: [] },
  ]);
  assert.equal(errorCode(foreignWrite), "INVALID_VALUE");
});

interface Recorded {
  readonly guides: Array<[number, number]>;
  readonly exported: Array<[boolean, string]>;
  readonly essential: Array<[FakeTemplateTarget, string]>;
}

function installPrecompose({ comp, projectItems }: World): void {
  let count = 0;
  const precompose = (indices: ReadonlyArray<number>, name: string): FakeCompItem => {
    count += 1;
    const moved = Array.from(indices, (index) => layerAt(comp, index - 1));
    const nested = new FakeCompItem(`precomp-${count}`, moved.slice(), name);
    projectItems.push(nested);
    for (const layer of moved) comp.layerItems.splice(comp.layerItems.indexOf(layer), 1);
    const precompLayer = new FakeLayer(`precomp-layer-${count}`, [], name);
    precompLayer.source = nested;
    precompLayer.attach(comp);
    comp.layerItems.splice(required(indices[0], "first precompose index") - 1, 0, precompLayer);
    return nested;
  };
  const add = (item: FakeCompItem | FakeFootageItem): FakeLayer => {
    const layer = new FakeLayer(`added-${item.id}`, []);
    layer.source = item;
    layer.attach(comp);
    comp.layerItems.unshift(layer);
    return layer;
  };
  comp.layers.precompose = precompose;
  comp.layers.add = add;
}

function installGuidesAndTemplates({ comp, title, writtenFiles }: World): Recorded {
  const recorded: Recorded = { guides: [[0, 5]], exported: [], essential: [] };
  comp.motionGraphicsTemplateName = "";
  comp.guides = recorded.guides;
  comp.addGuide = (orientation, position) => recorded.guides.push([orientation, position]);
  comp.removeGuide = (index) => {
    recorded.guides.splice(index, 1);
  };
  comp.exportAsMotionGraphicsTemplate = (overwrite, path) => {
    recorded.exported.push([overwrite, path]);
    writtenFiles.set(`${path}/${comp.motionGraphicsTemplateName ?? ""}.mogrt`, 2048);
    return true;
  };
  positionOf(title).addToMotionGraphicsTemplateAs = (target, name) => {
    recorded.essential.push([target, name]);
    return true;
  };
  return recorded;
}

const AUTHORING_PLAN: ReadonlyArray<JsonObject> = [
  { operation: "precompose_layers", compositionId: "comp-main", layerIds: ["layer-anim", "layer-shapes"], name: "Nested", newCompositionId: "__new__:pc", newLayerId: "__new__:pl", moveAllAttributes: true },
  { operation: "set_layer_name", compositionId: "comp-main", layerId: "__new__:pl", name: "Nested Layer" },
  { operation: "create_layer", compositionId: "comp-main", layerId: "__new__:solid", layerType: "solid", name: "BG", color: [0, 0, 1], size: [640, 360] },
  { operation: "create_layer", compositionId: "comp-main", layerId: "__new__:copy", layerType: "footage", name: "Plate", sourceItemId: "__new__:pc" },
  { operation: "set_layer_attribute", ...TITLE_TARGET, role: "motion-blur", value: true, hostProperty: "motionBlur" },
  { operation: "set_layer_attribute", ...TITLE_TARGET, role: "quality", value: "DRAFT", hostProperty: "quality" },
  { operation: "set_composition_guides", compositionId: "comp-main", guides: [{ orientation: "vertical", position: 960 }], replace: true },
  { operation: "add_essential_property", ...TITLE_TARGET, propertyPath: "ADBE Transform Group/ADBE Position", name: "Title Position" },
  { operation: "export_mogrt", compositionId: "comp-main", templateName: "Lower Third", outputPath: "/exports/lower.mogrt", overwrite: true, exportAuthorization: "EXPORT_NOW" },
  { operation: "set_project_settings", settings: { bitsPerChannel: 16, linearBlending: true } },
];

function assertInvalidCommandsStayOutOfUndo({ apply, calls }: World): void {
  const beginsBefore = calls.begin.length;
  const precompose = { operation: "precompose_layers", compositionId: "comp-main", layerIds: ["layer-title", "layer-footage"], name: "Bad", newCompositionId: "__new__:x", newLayerId: "__new__:y", moveAllAttributes: false };
  assert.equal(errorCode(applyPlan(apply, "extended", [precompose])), "INVALID_VALUE");
  const unauthorised = { operation: "export_mogrt", compositionId: "comp-main", templateName: "T", outputPath: "/exports/t.mogrt", overwrite: false };
  assert.equal(errorCode(applyPlan(apply, "extended", [unauthorised])), "INVALID_VALUE");
  const ultra = { operation: "set_layer_attribute", ...TITLE_TARGET, role: "quality", value: "ULTRA", hostProperty: "quality" };
  assert.equal(errorCode(applyPlan(apply, "extended", [ultra])), "INVALID_VALUE");
  assert.equal(calls.begin.length, beginsBefore, "invalid commands never open an undo group");
}

test("precompose, solid/footage layers, switches, guides, Essential Graphics, MOGRT export, and project settings", () => {
  const world = loadExtended();
  const { apply, comp, title, context, writtenFiles } = world;
  const project = appOf(context).project;
  Object.assign(context, { LayerQuality: { BEST: "best", DRAFT: "draft", WIREFRAME: "wireframe" } });
  project.bitsPerChannel = 8;
  project.linearBlending = false;
  installPrecompose(world);
  const { guides, exported, essential } = installGuidesAndTemplates(world);
  const result = applyPlan(apply, "extended", AUTHORING_PLAN);
  assertApplied(result);
  assert.deepEqual(fieldOf(result, "steps", 0), { operation: "precompose_layers", status: "applied", compositionId: "comp-main", requestedNewCompositionId: "__new__:pc", newCompositionId: "precomp-1", requestedLayerId: "__new__:pl", layerId: "precomp-layer-1", name: "Nested", movedLayers: 2 });
  assert.ok(!comp.layerItems.some((layer) => layer.id === "layer-anim"));
  assert.ok(comp.layerItems.some((layer) => layer.name === "Nested Layer"));
  assert.ok(comp.layerItems.some((layer) => layer.name === "BG"));
  assert.equal(comp.layerItems.find((layer) => layer.name === "Plate")?.id, "added-precomp-1");
  assert.equal(title.motionBlur, true);
  assert.equal(title.quality, "draft");
  assert.deepEqual(guides, [[1, 960]]);
  assert.deepEqual(essential, [[comp, "Title Position"]]);
  assert.deepEqual(exported, [[true, "/exports"]]);
  assert.equal(writtenFiles.get("/exports/lower.mogrt"), 2048);
  assert.equal(project.bitsPerChannel, 16);
  assert.equal(project.linearBlending, true);
  assertInvalidCommandsStayOutOfUndo(world);
});

test("export_mogrt on an untitled project is refused before After Effects can open a Save As dialog", () => {
  const { apply, comp, context, calls } = loadExtended();
  const project = appOf(context).project;
  const exported: string[] = [];
  Object.assign(comp, {
    exportAsMotionGraphicsTemplate: (_overwrite: boolean, path: string) => {
      exported.push(path);
      return true;
    },
  });
  const command = [{ operation: "export_mogrt", compositionId: "comp-main", templateName: "T", outputPath: "/exports/t.mogrt", overwrite: true, exportAuthorization: "EXPORT_NOW" }];
  project.file = null;
  const beginsBefore = calls.begin.length;
  const refused = applyPlan(apply, "extended", command);
  assert.equal(errorCode(refused), "MOGRT_PROJECT_UNSAVED");
  assert.match(String(fieldOf(refused, "error", "message")), /save the project/i);
  assert.deepEqual(exported, [], "After Effects is never asked to export");
  assert.equal(calls.begin.length, beginsBefore, "no undo group opens for the refusal");
  project.file = { fsName: "/projects/live.aep" };
  assert.notEqual(errorCode(applyPlan(apply, "extended", command)), "MOGRT_PROJECT_UNSAVED", "a saved project reaches the export");
});

interface PulseProject {
  revision: number | undefined;
  readonly numItems: number;
  item(): never;
  readonly activeItem: never;
}

function pulseProject(revision: number | undefined): PulseProject {
  return {
    revision,
    numItems: 300,
    item(): never {
      throw new Error("Routine pulse must not rediscover items");
    },
    get activeItem(): never {
      throw new Error("Routine pulse must not inspect layers or expressions");
    },
  };
}

test("the routine pulse detects same-count revisions and project switches without reading items or properties", () => {
  const app = { project: pulseProject(4) };
  const context = vm.createContext({ app, JSON });
  loadHostFiles(context, "collection.jsx");
  const pulse = (): JsonObject => recordOf(readJson(hostGlobal(context, "aeCollectionPulse()", isText)));
  const first = pulse();
  assert.equal(fieldOf(first, "coverage"), "revision-only");
  assert.equal(fieldOf(first, "items"), 300);
  app.project.revision = 5;
  const edited = pulse();
  assert.equal(fieldOf(edited, "items"), fieldOf(first, "items"));
  assert.notEqual(fieldOf(edited, "revision"), fieldOf(first, "revision"));
  app.project = pulseProject(5);
  const switched = pulse();
  assert.notEqual(fieldOf(switched, "project"), fieldOf(edited, "project"));
  app.project.revision = undefined;
  assert.equal(fieldOf(pulse(), "revision"), null, "Unavailable native revision is explicit unknown coverage");
});

test("apply_plan duplicates a composition into the source's folder, names the copy, and resolves its placeholder for later steps", () => {
  const { apply, comp, projectItems } = loadExtended();
  let copies = 0;
  Object.assign(comp, {
    duplicate: (): FakeCompItem => {
      copies += 1;
      const copy = new FakeCompItem(`comp-copy-${copies}`, [], `${comp.name} 2`);
      copy.parentFolder = comp.parentFolder;
      projectItems.push(copy);
      return copy;
    },
  });
  const result = applyPlan(apply, "extended", [
    { operation: "duplicate_composition", compositionId: "comp-main", newCompositionId: "__new__:run", name: "Run Cycle" },
    { operation: "create_layer", compositionId: "__new__:run", layerId: "__new__:marker", layerType: "null", name: "Run Null" },
  ]);
  assertApplied(result);
  assert.deepEqual(fieldOf(result, "steps", 0), { operation: "duplicate_composition", status: "applied", sourceCompositionId: "comp-main", requestedCompositionId: "__new__:run", compositionId: "comp-copy-1", name: "Run Cycle", numLayers: 0 });
  const copy = required(projectItems.find((item): item is FakeCompItem => item instanceof FakeCompItem && item.id === "comp-copy-1"), "duplicated composition");
  assert.equal(copy.name, "Run Cycle");
  assert.equal(copy.parentFolder, comp.parentFolder);
  assert.ok(copy.layerItems.some((layer) => layer.name === "Run Null"));
  assert.equal(comp.layerItems.some((layer) => layer.name === "Run Null"), false);
  assertRefused(applyPlan(apply, "extended", [{ operation: "duplicate_composition", compositionId: "comp-missing", newCompositionId: "__new__:x" }]), "TARGET_NOT_FOUND");
  assert.equal(errorCode(applyPlan(apply, "extended", [{ operation: "duplicate_composition", compositionId: "comp-main", newCompositionId: "not-a-placeholder" }])), "INVALID_VALUE");
});
