/**
 * Apply-plan host accounting: a MOGRT or render counts only when the file it names is new or rewritten, a render queue item a failed
 * step added is removed, codes the host throws are reported as themselves, and a run that wrote files outside the project never
 * reports a clean rollback.
 */

import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { type RenderFile, type RenderQueue, fileClassOf, queuedItem, renderQueueOf } from "./host-apply-context.js";
import { FakeFootageItem, loadApplyPlan, loadExtended } from "./host-apply-harness.js";
import { applyPlan, assertApplied } from "./host-plan-io.js";
import { fieldOf } from "./json-narrow.js";

const RENDER_NOW = { operation: "render_composition", compositionId: "comp-main", outputPath: "/renders/title.mov", destinationPolicy: "explicit-local-path", executeAuthorization: "RENDER_NOW" };
const TITLE_RENDER_OUTPUT = [{ path: "/renders/title.mov", operation: "render_composition" }];

function exportMogrt(templateName: string, outputPath: string, overwrite: boolean) {
  return { operation: "export_mogrt", compositionId: "comp-main", templateName, outputPath, overwrite, exportAuthorization: "EXPORT_NOW" };
}

function leaveFile(queue: RenderQueue, writtenFiles: Map<string, number>, bytes: number): void {
  const file = queuedItem(queue, 1).outputModule().file;
  if (file === null) throw new Error("the queue item has no output file");
  writtenFiles.set(file.fsName, bytes);
  file.exists = true;
  file.length = bytes;
}

function caseFoldedFileClass(writtenFiles: Map<string, number>) {
  return class CaseFoldedFile {
    public constructor(public fsName: string) {}

    public key(): string | undefined {
      return [...writtenFiles.keys()].find((name) => name.toLowerCase() === this.fsName.toLowerCase());
    }

    public get exists(): boolean {
      return this.key() !== undefined;
    }

    public get length(): number {
      const key = this.key();
      return key === undefined ? 0 : (writtenFiles.get(key) ?? 0);
    }

    public get name(): string {
      return this.fsName.slice(this.fsName.lastIndexOf("/") + 1);
    }

    public get parent(): { fsName: string; exists: boolean } {
      return { fsName: this.fsName.slice(0, this.fsName.lastIndexOf("/")), exists: true };
    }

    public remove(): boolean {
      const key = this.key();
      if (key !== undefined) writtenFiles.delete(key);
      return true;
    }

    public rename(name: string): boolean {
      const key = this.key();
      if (key === undefined) return false;
      writtenFiles.set(`${this.parent.fsName}/${name}`, writtenFiles.get(key) ?? 0);
      writtenFiles.delete(key);
      return true;
    }
  };
}

test("export_mogrt refuses an existing target without overwrite before After Effects is asked", () => {
  const { apply, comp, writtenFiles } = loadExtended();
  writtenFiles.set("/exports/lower.mogrt", 2048);
  let asked = 0;
  comp.exportAsMotionGraphicsTemplate = () => {
    asked += 1;
    return true;
  };
  const refused = applyPlan(apply, "plan", [exportMogrt("lower", "/exports/lower.mogrt", false)]);
  assert.equal(fieldOf(refused, "error", "code"), "MOGRT_EXPORT_FAILED");
  assert.match(String(fieldOf(refused, "error", "message")), /already exists; set overwrite/);
  assert.equal(asked, 0);
  assert.equal(writtenFiles.get("/exports/lower.mogrt"), 2048, "the existing file is left alone");
});

test("export_mogrt with overwrite reports MOGRT_EXPORT_FAILED when After Effects declines and the old file is unchanged", () => {
  const { apply, comp, writtenFiles } = loadExtended();
  writtenFiles.set("/exports/lower.mogrt", 2048);
  comp.exportAsMotionGraphicsTemplate = () => false;
  const declined = applyPlan(apply, "plan", [exportMogrt("lower", "/exports/lower.mogrt", true)]);
  assert.equal(fieldOf(declined, "error", "code"), "MOGRT_EXPORT_FAILED");
  assert.equal(writtenFiles.get("/exports/lower.mogrt"), 2048);
});

test("a MOGRT whose template name differs from the requested path only by case is kept, not deleted as its own duplicate", () => {
  const { apply, comp, context, writtenFiles } = loadExtended();
  Object.assign(context, { File: caseFoldedFileClass(writtenFiles) });
  writtenFiles.set("/exports/lower.mogrt", 2048);
  comp.exportAsMotionGraphicsTemplate = (_overwrite, path) => {
    for (const name of [...writtenFiles.keys()]) {
      if (name.toLowerCase() === `${path}/lower.mogrt`.toLowerCase()) writtenFiles.delete(name);
    }
    writtenFiles.set(`${path}/Lower.mogrt`, 4096);
    return true;
  };
  assertApplied(applyPlan(apply, "plan", [exportMogrt("Lower", "/exports/lower.mogrt", true)]));
  assert.equal(writtenFiles.get("/exports/Lower.mogrt"), 4096, "the file After Effects wrote survives");
  assert.equal(writtenFiles.size, 1);
});

test("a render that stopped, or finished without writing, is not reported as rendered even with an earlier file at the path", () => {
  const { apply, context, writtenFiles } = loadApplyPlan();
  const queue = renderQueueOf(context);
  writtenFiles.set("/renders/title.mov", 4096);
  queue.render = () => {
    queuedItem(queue, 1).status = 3017;
  };
  const stopped = applyPlan(apply, "plan", [RENDER_NOW]);
  assert.equal(fieldOf(stopped, "error", "code"), "RENDER_EXECUTION_FAILED");
  assert.match(String(fieldOf(stopped, "error", "message")), /USER_STOPPED/);
  queue.render = () => {
    queuedItem(queue, 1).status = 3019;
  };
  const silent = applyPlan(apply, "plan", [RENDER_NOW]);
  assert.equal(fieldOf(silent, "error", "code"), "RENDER_EXECUTION_FAILED");
  assert.equal(writtenFiles.get("/renders/title.mov"), 4096);
});

test("a numeric DONE render that wrote a new file is reported as rendered with a named status and its output recorded", () => {
  const { apply } = loadApplyPlan();
  const done = applyPlan(apply, "plan", [RENDER_NOW]);
  assertApplied(done);
  assert.equal(fieldOf(done, "steps", 0, "queueStatus"), "DONE");
  assert.equal(fieldOf(done, "steps", 0, "verification"), "render-file-written");
  assert.deepEqual(fieldOf(done, "externalOutputs") ?? fieldOf(done, "receipt", "externalOutputs"), TITLE_RENDER_OUTPUT);
});

test("an ERR_STOPPED or USER_STOPPED render is failed by name even when a file was left", () => {
  const { apply, context, writtenFiles } = loadApplyPlan();
  const queue = renderQueueOf(context);
  queue.render = () => {
    queuedItem(queue, 1).status = 3018;
    leaveFile(queue, writtenFiles, 1024);
  };
  const failed = applyPlan(apply, "plan", [RENDER_NOW]);
  assert.equal(fieldOf(failed, "error", "code"), "RENDER_EXECUTION_FAILED");
  assert.match(String(fieldOf(failed, "error", "message")), /ERR_STOPPED/);
  assert.equal(fieldOf(failed, "mayHaveMutated"), true, "the partial file is on disk, so rollback is refused");
  assert.deepEqual(fieldOf(failed, "externalOutputs"), TITLE_RENDER_OUTPUT);
});

test("a renamed container over a stale file at the renamed path is not counted as a new render", () => {
  const { apply, context, writtenFiles } = loadApplyPlan();
  const queue = renderQueueOf(context);
  const addToQueue = queue.items.add;
  const FileClass = fileClassOf(context);
  queue.items.add = (queuedComp) => {
    const item = addToQueue(queuedComp);
    const outputModule = item.outputModule();
    let held = outputModule.file;
    Object.defineProperty(outputModule, "file", {
      get: () => held,
      set: (assigned: RenderFile | null) => {
        held = assigned ? new FileClass(assigned.fsName.replace(/\.mov$/, ".mp4")) : assigned;
      },
    });
    return item;
  };
  writtenFiles.set("/renders/title.mp4", 4096);
  queue.render = () => {
    queuedItem(queue, 1).status = 3019;
  };
  const stale = applyPlan(apply, "plan", [RENDER_NOW]);
  assert.equal(fieldOf(stale, "error", "code"), "RENDER_EXECUTION_FAILED");
  assert.equal(writtenFiles.get("/renders/title.mp4"), 4096);
});

test("a render that failed after writing a file records that output and refuses rollback", () => {
  const { apply, context, writtenFiles } = loadApplyPlan();
  const queue = renderQueueOf(context);
  queue.render = () => {
    leaveFile(queue, writtenFiles, 2048);
    throw new Error("engine crashed");
  };
  const failed = applyPlan(apply, "plan", [RENDER_NOW]);
  assert.equal(fieldOf(failed, "error", "code"), "RENDER_EXECUTION_FAILED");
  assert.equal(fieldOf(failed, "mayHaveMutated"), true);
  assert.deepEqual(fieldOf(failed, "externalOutputs"), TITLE_RENDER_OUTPUT);
});

test("a Media Encoder send refused on Windows adds no render queue item", () => {
  const { apply, context } = loadApplyPlan();
  Object.assign(context, { $: { os: "Windows 10" } });
  const queued = { operation: "render_composition", compositionId: "comp-main", outputPath: "/renders/title.mov", destinationPolicy: "explicit-local-path", mediaEncoder: "queue" };
  const refused = applyPlan(apply, "plan", [queued]);
  assert.equal(fieldOf(refused, "error", "code"), "MEDIA_ENCODER_UNSUPPORTED");
  assert.equal(vm.runInContext("app.project.renderQueue.items.length", context), 0, "no orphan queue item is left behind");
});

test("a render that fails after its queue item is added removes that item", () => {
  const { apply, context } = loadApplyPlan();
  const queue = renderQueueOf(context);
  queue.render = () => {
    throw new Error("render engine refused");
  };
  const failed = applyPlan(apply, "plan", [RENDER_NOW]);
  assert.equal(fieldOf(failed, "error", "code"), "RENDER_EXECUTION_FAILED");
  assert.equal(queue.items.length, 0, "the failed render's queue item is removed");
});

test("a footage failure is reported with its own known code, not HOST_MUTATION_FAILED", () => {
  const { apply, footage, projectItems } = loadApplyPlan();
  if (!projectItems.includes(footage)) projectItems.push(footage);
  const missing = applyPlan(apply, "plan", [{ operation: "replace_footage", itemId: "footage-plate", path: "/missing/nothing.mov" }]);
  assert.equal(fieldOf(missing, "error", "code"), "FOOTAGE_REPLACE_FAILED");
});

test("a failed run that already wrote a MOGRT reports the file and does not claim a clean rollback", () => {
  const { apply, comp, writtenFiles } = loadExtended();
  writtenFiles.set("/exports/taken.mogrt", 2048);
  comp.exportAsMotionGraphicsTemplate = (_overwrite, path) => {
    writtenFiles.set(`${path}/lower.mogrt`, 4096);
    return true;
  };
  const failed = applyPlan(apply, "plan", [exportMogrt("lower", "/exports/lower.mogrt", true), exportMogrt("taken", "/exports/taken.mogrt", false)]);
  assert.equal(fieldOf(failed, "error", "code"), "MOGRT_EXPORT_FAILED");
  assert.equal(fieldOf(failed, "rolledBack"), false);
  assert.equal(fieldOf(failed, "mayHaveMutated"), true);
  assert.deepEqual(fieldOf(failed, "externalOutputs"), [{ path: "/exports/lower.mogrt", operation: "export_mogrt" }]);
});

test("a collect_project that fails after copying footage reports the copies it left behind", () => {
  const { apply, context, projectItems, writtenFiles } = loadExtended();
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
  const item = new FakeFootageItem("f-relink", "title.mov");
  Object.assign(item.mainSource, { file: new CollectFile("/fixtures/title.mov") });
  Object.assign(item, {
    replace: () => {
      throw new Error("relink refused");
    },
  });
  projectItems.push(item);
  const failed = applyPlan(apply, "plan", [{ operation: "collect_project", destinationFolder: "/exports/job", projectName: "walk", exportAuthorization: "EXPORT_NOW" }]);
  assert.equal(fieldOf(failed, "error", "code"), "COLLECT_FAILED");
  assert.equal(fieldOf(failed, "rolledBack"), false);
  assert.deepEqual(fieldOf(failed, "externalOutputs"), [{ path: "/exports/job/(Footage)/title.mov", operation: "collect_project" }]);
});
