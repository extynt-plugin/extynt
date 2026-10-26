/**
 * Apply-plan host contract: composition settings, time remap, footage and proxies, the render queue, project items and deletion.
 * The fake host and payload builders live in host-apply-harness.ts.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { FakeFootageItem, loadApplyPlan } from "./host-apply-harness.js";
import { required } from "./host-fake-lookup.js";
import { TITLE_TARGET, applyPlan, assertApplied, assertRefused } from "./host-plan-io.js";
import { fieldOf, listAt, optionalTextAt, textAt } from "./json-narrow.js";

test("apply_plan updates bounded composition settings and toggles time remap", () => {
  const { apply, comp, title } = loadApplyPlan();
  const result = applyPlan(apply, "comp-time", [
    { operation: "set_composition_settings", compositionId: "comp-main", settings: { width: 1280, height: 720, pixelAspect: 1, durationSeconds: 8, frameRate: 24, backgroundColor: [0.1, 0.2, 0.3] } },
    { operation: "set_time_remap", ...TITLE_TARGET, enabled: true },
  ]);
  assertApplied(result);
  assert.equal(comp.width, 1280);
  assert.equal(comp.duration, 8);
  assert.equal(comp.frameRate, 24);
  assert.deepEqual(Array.from(comp.bgColor), [0.1, 0.2, 0.3]);
  assert.equal(title.timeRemapEnabled, true);
});

test("apply_plan accepts a partial composition settings update with field-specific host behavior", () => {
  const { apply, comp } = loadApplyPlan();
  const result = applyPlan(apply, "comp-width-only", [{ operation: "set_composition_settings", compositionId: "comp-main", settings: { width: 1278 } }]);
  assert.equal(fieldOf(result, "ok"), true, optionalTextAt(result, "error", "message"));
  assert.equal(comp.width, 1278);
  assert.equal(comp.height, 1080);
});

test("apply_plan rejects out-of-bounds composition settings and unsupported time remap", () => {
  const { apply, title } = loadApplyPlan();
  title.canSetTimeRemapEnabled = false;
  const badComp = applyPlan(apply, "comp-bad", [{ operation: "set_composition_settings", compositionId: "comp-main", settings: { width: 9000 } }]);
  assertRefused(badComp, "INVALID_VALUE");
  const remap = applyPlan(apply, "remap-bad", [{ operation: "set_time_remap", ...TITLE_TARGET, enabled: true }]);
  assertRefused(remap, "TIME_REMAP_UNSUPPORTED");
});

test("apply_plan replaces footage and sets or clears a proxy without exposing paths in steps", () => {
  const { apply, footage, projectItems } = loadApplyPlan();
  projectItems.push(footage);
  const replace = applyPlan(apply, "footage-1", [{ operation: "replace_footage", itemId: "footage-plate", path: "/fixtures/replacement.mov" }]);
  assertApplied(replace);
  assert.equal(footage.replacedPath, "/fixtures/replacement.mov");
  const steps = JSON.stringify(fieldOf(replace, "steps"));
  assert.equal(steps, steps.replaceAll("/fixtures/replacement.mov", ""));
  const proxy = applyPlan(apply, "footage-2", [{ operation: "set_footage_proxy", itemId: "footage-plate", path: "/fixtures/proxy.mov" }]);
  assertApplied(proxy);
  assert.equal(footage.proxyPath, "/fixtures/proxy.mov");
  const clear = applyPlan(apply, "footage-3", [{ operation: "clear_footage_proxy", itemId: "footage-plate" }]);
  assertApplied(clear);
  assert.equal(footage.proxyPath, null);
  const missing = applyPlan(apply, "footage-bad", [{ operation: "replace_footage", itemId: "footage-plate", path: "/private/missing.mov" }]);
  assert.equal(fieldOf(missing, "ok"), false);
  assert.equal(textAt(missing, "error", "message").includes("/private/missing.mov"), false);
});

test("apply_plan queues a typed render and only executes it with RENDER_NOW", () => {
  const { apply, render } = loadApplyPlan();
  const renderOperation = { operation: "render_composition", compositionId: "comp-main", outputPath: "/renders/title.mov", destinationPolicy: "explicit-local-path" } as const;
  const queued = applyPlan(apply, "render-queue", [{ ...renderOperation, renderSettingsTemplate: "Best Settings", outputModuleTemplate: "Lossless" }]);
  assertApplied(queued);
  assert.equal(fieldOf(queued, "steps", 0, "status"), "queued");
  assert.equal(render.calls, 0);
  const submitted = applyPlan(apply, "render-now", [{ ...renderOperation, executeAuthorization: "RENDER_NOW" }]);
  assertApplied(submitted);
  assert.equal(fieldOf(submitted, "steps", 0, "verification"), "render-file-written");
  assert.equal(render.calls, 1);
  const denied = applyPlan(apply, "render-denied", [{ ...renderOperation, executeAuthorization: "yes" }]);
  assertRefused(denied, "INVALID_VALUE");
});

test("apply_plan creates nested folders, imports into them, and resolves item placeholders without exposing the import path", () => {
  const { apply, projectItems } = loadApplyPlan();
  const result = applyPlan(apply, "project-items-1", [
    { operation: "create_folder", newFolderId: "__new__:folder0", name: "Assets" },
    { operation: "create_folder", newFolderId: "__new__:folder1", name: "Video", parentFolderId: "__new__:folder0" },
    { operation: "import_file", newItemId: "__new__:item2", path: "/fixtures/title.mov", importAs: "footage", destinationFolderId: "__new__:folder1" },
    { operation: "set_item_name", itemId: "__new__:item2", name: "Title Footage" },
  ]);
  assertApplied(result);
  assert.equal(listAt(result, "steps").length, 4);
  assert.equal(fieldOf(result, "steps", 0, "requestedFolderId"), "__new__:folder0");
  assert.match(String(fieldOf(result, "steps", 0, "folderId")), /^created-folder-/);
  assert.equal(fieldOf(result, "steps", 2, "requestedItemId"), "__new__:item2");
  assert.match(String(fieldOf(result, "steps", 2, "itemId")), /^imported-/);
  assert.doesNotMatch(JSON.stringify(result), /\/fixtures\/title\.mov/);
  const imported = required(projectItems.find((item): item is FakeFootageItem => item instanceof FakeFootageItem), "imported footage item");
  assert.equal(imported.name, "Title Footage");
  assert.equal(imported.parentFolder?.name, "Video");
});

test("apply_plan renames and moves existing project items, rejecting folder cycles and redacting import failures", () => {
  const { apply, comp } = loadApplyPlan();
  const setup = applyPlan(apply, "project-items-2", [
    { operation: "create_folder", newFolderId: "__new__:folder0", name: "Parent" },
    { operation: "create_folder", newFolderId: "__new__:folder1", name: "Child", parentFolderId: "__new__:folder0" },
  ]);
  assertApplied(setup);
  const parentId = textAt(setup, "steps", 0, "folderId");
  const childId = textAt(setup, "steps", 1, "folderId");
  const moved = applyPlan(apply, "project-items-3", [
    { operation: "set_item_name", itemId: "comp-main", name: "Main Comp" },
    { operation: "move_item_to_folder", itemId: "comp-main", folderId: parentId },
  ]);
  assertApplied(moved);
  assert.equal(comp.name, "Main Comp");
  assert.equal(comp.parentFolder?.id, parentId);
  const cycle = applyPlan(apply, "project-items-4", [{ operation: "move_item_to_folder", itemId: parentId, folderId: childId }]);
  assertRefused(cycle, "FOLDER_CYCLE");
  const missing = applyPlan(apply, "project-items-5", [{ operation: "import_file", newItemId: "__new__:missing", path: "/private/missing.mov", importAs: "footage" }]);
  assertRefused(missing, "IMPORT_FILE_NOT_FOUND");
  assert.doesNotMatch(textAt(missing, "error", "message"), /private|missing\.mov/);
});

test("apply_plan deletes a project item only with explicit confirmation and rejects an earlier same-plan reference", () => {
  const { apply, comp, projectItems } = loadApplyPlan();
  comp.remove = () => {
    const index = projectItems.indexOf(comp);
    if (index >= 0) projectItems.splice(index, 1);
  };
  const denied = applyPlan(apply, "delete-item-denied", [{ operation: "delete_project_item", itemId: "comp-main" }]);
  assertRefused(denied, "DESTRUCTIVE_CONFIRMATION_REQUIRED");
  const referenced = applyPlan(apply, "delete-item-referenced", [
    { operation: "set_item_name", itemId: "comp-main", name: "Used first" },
    { operation: "delete_project_item", itemId: "comp-main", destructive: true },
  ]);
  assertRefused(referenced, "ITEM_REFERENCED_EARLIER");
  const deleted = applyPlan(apply, "delete-item-ok", [{ operation: "delete_project_item", itemId: "comp-main", destructive: true }]);
  assertApplied(deleted);
  assert.equal(fieldOf(deleted, "steps", 0, "itemId"), "comp-main");
  assert.equal(projectItems.length, 0);
});
