/**
 * Apply-plan host contract: project-level edits (locked layers, imports, saving, composition switches, collect and presets).
 * The fake host and payload builders live in host-apply-harness.ts.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { type FakeFile, type FakeProjectFile, appOf, fileClassOf } from "./host-apply-context.js";
import { FakeFootageItem, type FakeFootageSource, loadApplyPlan, loadExtended } from "./host-apply-harness.js";
import { required } from "./host-fake-lookup.js";
import { type PlanApply, TITLE_TARGET, applyPlan, assertApplied, errorCode } from "./host-plan-io.js";
import { fieldOf } from "./json-narrow.js";
import { type JsonObject } from "@extynt/decode";

test("apply_plan unlocks a locked layer, edits it and locks it again, and refuses an edit while it stays locked", () => {
  const { apply, title } = loadExtended();
  const attribute = (value: boolean) => ({ operation: "set_layer_attribute", ...TITLE_TARGET, role: "locked", value });
  const rename = { operation: "set_layer_name", ...TITLE_TARGET, name: "Edited" };
  title.locked = true;
  const refused = applyPlan(apply, "extended", [rename]);
  assert.equal(errorCode(refused), "TARGET_LOCKED");
  assert.equal(title.name === "Edited", false);
  const cycled = applyPlan(apply, "extended", [attribute(false), rename, attribute(true)]);
  assertApplied(cycled);
  assert.equal(fieldOf(cycled, "steps", 0, "verification"), "layer-attribute-read-back");
  assert.equal(fieldOf(cycled, "steps", 0, "readBackMatches"), true);
  assert.equal(title.name, "Edited");
  assert.equal(title.locked, true);
  assert.equal(errorCode(applyPlan(apply, "extended", [attribute(false), attribute(true), { ...rename, name: "Again" }])), "TARGET_LOCKED");
  assert.equal(title.name, "Edited");
});

test("import_file takes .ai, .eps and .pdf files as footage or as a composition with layers, and refuses an import type the file cannot take", () => {
  for (const extension of ["ai", "eps", "pdf"]) {
    for (const importAs of ["footage", "composition"] as const) {
      const { apply } = loadApplyPlan();
      const imported = applyPlan(apply, `import-${extension}-${importAs}`, [
        { operation: "import_file", newItemId: "__new__:art", path: `/fixtures/artwork.${extension}`, importAs },
      ]);
      assertApplied(imported, `${extension} as ${importAs}: `);
      assert.equal(fieldOf(imported, "steps", 0, "requestedItemId"), "__new__:art");
    }
  }
  const { apply } = loadApplyPlan();
  const refused = applyPlan(apply, "import-project", [
    { operation: "import_file", newItemId: "__new__:art", path: "/fixtures/artwork.pdf", importAs: "project" },
  ]);
  assert.equal(errorCode(refused), "INVALID_IMPORT_TYPE");
});

function installProjectSave(context: ReturnType<typeof loadExtended>["context"], writtenFiles: Map<string, number>): string[] {
  const project = appOf(context).project;
  const saves: string[] = [];
  const fileOf = (fsName: string): FakeProjectFile => ({
    fsName,
    name: fsName.slice(fsName.lastIndexOf("/") + 1),
    parent: { fsName: fsName.slice(0, fsName.lastIndexOf("/")), exists: true },
  });
  project.file = null;
  project.save = (target) => {
    const path = target ? target.fsName : required(project.file, "saved project file").fsName;
    saves.push(path);
    writtenFiles.set(path, 2048);
    if (target) project.file = fileOf(path);
  };
  return saves;
}

test("apply_plan save_project saves in place, saves as, increments the name, and refuses an unsaved project or an existing file", () => {
  const { apply, context, writtenFiles } = loadExtended();
  const saves = installProjectSave(context, writtenFiles);
  const save = (fields: JsonObject) => applyPlan(apply, "extended", [{ operation: "save_project", overwrite: false, ...fields }]);
  assert.equal(errorCode(save({ mode: "save" })), "PROJECT_UNSAVED");
  assert.equal(errorCode(save({ mode: "increment" })), "PROJECT_UNSAVED");
  const first = save({ mode: "save_as", path: "/work/walk.aep" });
  assertApplied(first);
  assert.equal(fieldOf(first, "steps", 0, "file"), "/work/walk.aep");
  assert.equal(fieldOf(first, "steps", 0, "verification"), "project-file-saved");
  assertApplied(save({ mode: "save" }));
  assert.equal(saves.at(-1), "/work/walk.aep");
  assert.equal(errorCode(save({ mode: "save_as", path: "/work/walk.aep" })), "PROJECT_SAVE_EXISTS");
  assertApplied(save({ mode: "save_as", path: "/work/walk.aep", overwrite: true }));
  assertApplied(save({ mode: "increment" }));
  assert.equal(saves.at(-1), "/work/walk_002.aep");
  assertApplied(save({ mode: "increment" }));
  assert.equal(saves.at(-1), "/work/walk_003.aep");
  assert.equal(errorCode(save({ mode: "save_as", path: "/work/walk.txt" })), "INVALID_VALUE");
  assert.equal(errorCode(save({ mode: "save", path: "/work/other.aep" })), "INVALID_VALUE");
});

test("apply_plan writes the comp switches frameBlending, draft3d and resolutionFactor, and the layer switches auto-orient and preserve-transparency", () => {
  const { apply, comp, title } = loadExtended();
  const switches = Object.assign(comp, { frameBlending: false, draft3d: false, resolutionFactor: [1, 1] });
  const settings = (fields: JsonObject) => applyPlan(apply, "extended", [{ operation: "set_composition_settings", compositionId: "comp-main", settings: fields }]);
  const done = settings({ frameBlending: true, draft3d: true, resolutionFactor: [2, 2] });
  assertApplied(done);
  assert.deepEqual([switches.frameBlending, switches.draft3d, JSON.stringify(switches.resolutionFactor)], [true, true, "[2,2]"]);
  assert.equal(fieldOf(done, "steps", 0, "verification"), "composition-settings-read-back");
  assert.equal(fieldOf(done, "steps", 0, "checkedSettings"), 3);
  assert.deepEqual(fieldOf(done, "steps", 0, "differingSettings"), []);
  assert.equal(errorCode(settings({ resolutionFactor: [0, 2] })), "INVALID_VALUE");
  assert.equal(errorCode(settings({ draft3d: "yes" })), "INVALID_VALUE");
  const layer = Object.assign(title, { autoOrient: 4212, preserveTransparency: false });
  const attribute = (role: string, value: boolean | string, hostProperty: string) =>
    applyPlan(apply, "extended", [{ operation: "set_layer_attribute", ...TITLE_TARGET, role, value, hostProperty }]);
  const preserved = attribute("preserve-transparency", true, "preserveTransparency");
  assertApplied(preserved);
  assert.equal(fieldOf(preserved, "steps", 0, "verification"), "layer-attribute-read-back");
  assert.equal(layer.preserveTransparency, true);
  assert.equal(errorCode(attribute("auto-orient", "SPIRAL", "autoOrient")), "INVALID_VALUE");
});

test("apply_plan sets the settings of a composition created earlier in the same plan, and refuses an unknown or forward one", () => {
  const { apply, projectItems } = loadExtended();
  const create = { operation: "create_composition", newCompositionId: "__new__:scene", name: "Scene", width: 1280, height: 720, durationSeconds: 6, frameRate: 30 };
  const settingsOn = (compositionId: string, settings: JsonObject) => ({ operation: "set_composition_settings", compositionId, settings });
  const done = applyPlan(apply, "extended", [create, settingsOn("__new__:scene", { frameBlending: true, draft3d: true })]);
  assertApplied(done);
  assert.equal(fieldOf(done, "steps", 1, "status"), "applied");
  assert.equal(projectItems.length, 2, "the composition was created once");
  const forward = applyPlan(apply, "extended", [settingsOn("__new__:scene", { frameBlending: true }), create]);
  assert.equal(errorCode(forward), "TARGET_NOT_FOUND");
  const unknown = applyPlan(apply, "extended", [create, settingsOn("__new__:missing", { frameBlending: true })]);
  assert.equal(errorCode(unknown), "TARGET_NOT_FOUND");
  const renderer = applyPlan(apply, "extended", [create, settingsOn("__new__:scene", { renderer: "No Such Renderer" })]);
  assert.equal(errorCode(renderer), "INVALID_VALUE", "a renderer the new composition does not list is refused by the step");
});

type LinkedSource = FakeFootageSource & { file: FakeFile | null };

interface CollectWorld {
  readonly apply: PlanApply;
  readonly saves: string[];
  readonly items: ReadonlyArray<{ readonly item: FakeFootageItem; readonly source: LinkedSource }>;
}

function installCollectClasses(world: ReturnType<typeof loadExtended>) {
  const { context, writtenFiles } = world;
  const Base = fileClassOf(context);
  const folders = new Set<string>(["/exports"]);
  class FakeFolder {
    public exists: boolean;

    public constructor(public fsName: string) {
      this.exists = folders.has(fsName);
    }

    public create(): boolean {
      folders.add(this.fsName);
      this.exists = true;
      return true;
    }
  }
  class CollectFile extends Base {
    public copy(target: string): boolean {
      writtenFiles.set(target, this.length);
      return true;
    }
  }
  Object.assign(context, { File: CollectFile, Folder: FakeFolder, FootageItem: FakeFootageItem });
  return CollectFile;
}

function installCollectSave(world: ReturnType<typeof loadExtended>): string[] {
  const project = appOf(world.context).project;
  const saves: string[] = [];
  project.file = null;
  project.save = (target) => {
    const path = required(target, "save target").fsName;
    saves.push(path);
    world.writtenFiles.set(path, 4096);
    project.file = { fsName: path };
  };
  return saves;
}

function installCollectFakes(world: ReturnType<typeof loadExtended>): CollectWorld {
  const CollectFile = installCollectClasses(world);
  const saves = installCollectSave(world);
  const makeItem = (id: string, name: string, path: string) => {
    const item = new FakeFootageItem(id, name);
    const source: LinkedSource = Object.assign(item.mainSource, { file: new CollectFile(path) });
    Object.assign(item, { replace: (file: FakeFile) => { source.file = file; } });
    world.projectItems.push(item);
    return { item, source };
  };
  const items = [
    makeItem("f1", "title.mov", "/fixtures/title.mov"),
    makeItem("f2", "again.mov", "/fixtures/title.mov"),
    makeItem("f3", "other.mov", "/fixtures/replacement.mov"),
    makeItem("f4", "frames[0001-0050].png", "/fixtures/proxy.mov"),
  ];
  return { apply: world.apply, saves, items };
}

test("apply_plan collect_project copies footage, relinks the items to the copies, saves the project there, and skips what it cannot carry", () => {
  const { apply, saves, items } = installCollectFakes(loadExtended());
  const collect = (fields: JsonObject = {}) =>
    applyPlan(apply, "extended", [{ operation: "collect_project", destinationFolder: "/exports/job", projectName: "walk", exportAuthorization: "EXPORT_NOW", ...fields }]);
  const done = collect();
  assertApplied(done);
  assert.equal(fieldOf(done, "steps", 0, "copiedFiles"), 2, "two distinct source files; the item that shares a file does not copy it twice");
  const linked = items.map(({ source }) => source.file?.fsName);
  assert.deepEqual(linked, [
    "/exports/job/(Footage)/title.mov",
    "/exports/job/(Footage)/title.mov",
    "/exports/job/(Footage)/replacement.mov",
    "/fixtures/proxy.mov",
  ]);
  assert.match(JSON.stringify(fieldOf(done, "steps", 0, "skipped")), /image sequence/);
  assert.deepEqual(saves, ["/exports/job/walk.aep"]);
  assert.equal(fieldOf(done, "steps", 0, "verification"), "project-file-saved");
  assert.equal(errorCode(collect()), "COLLECT_FAILED");
});

test("apply_plan apply_preset takes one of extynt's own .ffx files by relative name and refuses any path out of the library", () => {
  const { apply, comp, title, context } = loadExtended();
  const project = appOf(context).project;
  Object.assign(context, { aeHostDirectory: "/presets/host" });
  Object.assign(comp, { openInViewer: () => { project.activeItem = comp; } });
  const applied: string[] = [];
  Object.assign(title, { applyPreset: (file: FakeFile) => { applied.push(file.fsName); } });
  const preset = (presetFile: string) => applyPlan(apply, "extended", [{ operation: "apply_preset", ...TITLE_TARGET, presetFile }]);
  const done = preset("presets/Wiggle.ffx");
  assertApplied(done);
  assert.deepEqual(applied, ["/presets/host/presets/Wiggle.ffx"]);
  assert.equal(fieldOf(done, "steps", 0, "presetFile"), "presets/Wiggle.ffx");
  for (const bad of ["../evil.ffx", "/Users/x/evil.ffx", "presets/Wiggle.exe", "a/b/c/d.ffx"]) {
    assert.equal(errorCode(preset(bad)), "INVALID_VALUE", bad);
  }
  Object.assign(context, { aeHostDirectory: "/missing/host" });
  assert.equal(errorCode(preset("presets/Wiggle.ffx")), "PRESET_NOT_FOUND");
});
