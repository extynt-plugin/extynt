/** The fake `app.project.importFile`: footage for footage, and for an SVG whatever the configured native importer leaves in the project and returns. */

import { FakeCompItem, FakeLayer } from "./host-fake-comp.js";
import { FakeFolderItem, FakeFootageItem } from "./host-fake-footage.js";
import { FakeShapeRoot } from "./host-fake-groups.js";
import type { Sequence } from "./host-apply-world.js";

/**
 * How the fake native SVG importer behaves: it imports, says it cannot, throws, or returns a composition with no layers.
 * AE 26.2.1 imports the composition but returns null (or nothing): "null" and "undefined" do that; "two" adds a composition and a
 * folder and returns null; "footage" adds a footage item and returns null.
 */
export interface ApplyPlanOptions {
  nativeSvg?: "ok" | "refuse" | "throw" | "empty" | "null" | "undefined" | "two" | "footage" | "emptyWithFolder";
  shapeLayerFailure?: boolean;
}

/** The importer behaviours a run can select. */
export type NativeSvgMode = NonNullable<ApplyPlanOptions["nativeSvg"]>;

/** Everything the fake importer adds to or counts in the project. */
export interface SvgImportWorld {
  readonly nativeSvg: NativeSvgMode;
  readonly importCalls: { importFile: number };
  readonly rootFolder: FakeFolderItem;
  readonly projectItems: Array<FakeCompItem | FakeFolderItem | FakeFootageItem>;
  readonly ids: { readonly comp: Sequence; readonly folder: Sequence; readonly footage: Sequence };
}

interface ImportFileRequest {
  file: { exists: boolean };
  importAs: string | undefined;
  sequence?: boolean;
  forceAlphabetical?: boolean;
}

type ImportedItem = FakeFootageItem | FakeCompItem | null | undefined;

const EMPTY_COMP_MODES: ReadonlySet<NativeSvgMode> = new Set(["empty", "emptyWithFolder"]);
const EXTRA_FOLDER_MODES: ReadonlySet<NativeSvgMode> = new Set(["two", "emptyWithFolder"]);
const NULL_RETURN_MODES: ReadonlySet<NativeSvgMode> = new Set(["null", "two"]);

function addFootage(world: SvgImportWorld, name: string): FakeFootageItem {
  const imported = new FakeFootageItem(`imported-${world.ids.footage.take()}`, name);
  imported.parentFolder = world.rootFolder;
  world.projectItems.push(imported);
  return imported;
}

function importFootage(world: SvgImportWorld, request: ImportFileRequest): FakeFootageItem {
  const footage = addFootage(world, "title.mov");
  if (!request.sequence) return footage;
  footage.sequenceImport = { sequence: true, forceAlphabetical: request.forceAlphabetical === true };
  footage.duration = 4;
  footage.frameRate = 25;
  return footage;
}

function addComp(world: SvgImportWorld): ImportedItem {
  const id = world.ids.comp.take();
  const layers = EMPTY_COMP_MODES.has(world.nativeSvg) ? [] : [new FakeLayer(`svg-shape-${id}`, [new FakeShapeRoot()], "SVG Shape")];
  const importedComp = new FakeCompItem(`imported-comp-${id}`, layers, "vector.svg");
  importedComp.parentFolder = world.rootFolder;
  world.projectItems.push(importedComp);
  if (EXTRA_FOLDER_MODES.has(world.nativeSvg)) world.projectItems.push(new FakeFolderItem(`imported-folder-${world.ids.folder.take()}`, "vector.svg folder"));
  if (NULL_RETURN_MODES.has(world.nativeSvg)) return null;
  return world.nativeSvg === "undefined" ? undefined : importedComp;
}

function importComposition(world: SvgImportWorld): ImportedItem {
  if (world.nativeSvg === "throw") throw new Error("importer exploded");
  if (world.nativeSvg !== "footage") return addComp(world);
  addFootage(world, "vector.svg");
  return null;
}

/** The `importFile` function: footage for any non-composition import, the configured SVG outcome for a composition import, null for a missing file. */
export function fakeSvgImport(world: SvgImportWorld): (request: ImportFileRequest) => ImportedItem {
  return (request) => {
    world.importCalls.importFile += 1;
    if (!request.file.exists) return null;
    if (request.importAs !== "composition") return importFootage(world, request);
    return importComposition(world);
  };
}
