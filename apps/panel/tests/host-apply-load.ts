/** Loads the host files into a fake After Effects project for the apply_plan suites and returns the handles tests assert against. */

import vm from "node:vm";
import { FakeCompItem, type FakeLayer } from "./host-fake-comp.js";
import { FakeFolderItem, FakeFootageItem } from "./host-fake-footage.js";
import { FakeShape } from "./host-fake-property.js";
import { FOOTAGE_GLOBALS, FakeKeyframeEase, FakeMarkerValue, HOST_ENUM_GLOBALS } from "./host-apply-globals.js";
import { FakeHostFolder, fakeFileClass, importOptionsClass, type FakeFileStore } from "./host-apply-files.js";
import { buildRenderQueue, type RenderLog } from "./host-apply-render.js";
import { fakeSvgImport, type ApplyPlanOptions } from "./host-apply-svg.js";
import { Sequence, buildMainComposition } from "./host-apply-world.js";
import { registerHostFakes } from "./host-apply-context.js";
import { hostTextFunction, loadHostFiles } from "./host-sources.js";
import { fakeProjectCleanup, newOutputControls, type OutputFakeControls } from "./host-output-fake.js";

type ProjectItem = FakeCompItem | FakeFolderItem | FakeFootageItem;

/** The handles `loadApplyPlan` returns. */
export interface LoadedApplyPlan {
  readonly apply: (raw: string) => string;
  readonly output: OutputFakeControls;
  readonly calls: { begin: string[]; end: number };
  readonly render: RenderLog;
  readonly title: FakeLayer;
  readonly shapeLayer: FakeLayer;
  readonly cameraLayer: FakeLayer;
  readonly lightLayer: FakeLayer;
  readonly comp: FakeCompItem;
  readonly footage: FakeFootageItem;
  readonly projectItems: ProjectItem[];
  readonly context: vm.Context;
  readonly writtenFiles: Map<string, number>;
  readonly writtenContents: Map<string, string>;
  readonly dialogs: { begin: number; end: number };
  readonly nativeCalls: { options: number; canImportAs: number; importFile: number };
}

interface ApplyState {
  readonly options: ApplyPlanOptions;
  readonly rootFolder: FakeFolderItem;
  readonly projectItems: ProjectItem[];
  readonly ids: { readonly comp: Sequence; readonly folder: Sequence; readonly footage: Sequence };
  readonly output: OutputFakeControls;
  readonly render: RenderLog;
  readonly store: FakeFileStore;
  readonly nativeCalls: LoadedApplyPlan["nativeCalls"];
}

function addCompTo(state: ApplyState, name: string, settings: readonly number[]): FakeCompItem {
  const [width = 1920, height = 1080, pixelAspect = 1, duration = 10, frameRate = 30] = settings;
  const created = new FakeCompItem(`created-comp-${state.ids.comp.take()}`, [], name);
  Object.assign(created, { width, height, pixelAspect, duration, frameRate });
  if (state.options.shapeLayerFailure) {
    created.layers.addShape = () => {
      throw new Error("no shape layer");
    };
  }
  created.parentFolder = state.rootFolder;
  state.projectItems.push(created);
  return created;
}

function addFolderTo(state: ApplyState, name: string): FakeFolderItem {
  const created = new FakeFolderItem(`created-folder-${state.ids.folder.take()}`, name);
  created.parentFolder = state.rootFolder;
  state.projectItems.push(created);
  return created;
}

function fakeProject(state: ApplyState) {
  const { projectItems, rootFolder } = state;
  return {
    get numItems() {
      return projectItems.length;
    },
    item: (index: number) => projectItems[index - 1] ?? null,
    rootFolder,
    items: {
      addComp: (name: string, ...settings: number[]) => addCompTo(state, name, settings),
      addFolder: (name: string) => addFolderTo(state, name),
    },
    importFile: fakeSvgImport({ nativeSvg: state.options.nativeSvg ?? "ok", importCalls: state.nativeCalls, rootFolder, projectItems, ids: state.ids }),
    renderQueue: buildRenderQueue(state.output, state.render, state.store),
    ...fakeProjectCleanup(state.output, projectItems),
  };
}

function fakeApp(state: ApplyState, calls: LoadedApplyPlan["calls"], dialogs: LoadedApplyPlan["dialogs"]) {
  return {
    project: fakeProject(state),
    beginUndoGroup: (name: string) => calls.begin.push(name),
    endUndoGroup: () => {
      calls.end += 1;
    },
    beginSuppressDialogs: () => {
      dialogs.begin += 1;
    },
    endSuppressDialogs: () => {
      dialogs.end += 1;
    },
  };
}

/** A fresh fake project with the host loaded; `options` selects how the native SVG importer and shape layer creation behave. */
export function loadApplyPlan(options: ApplyPlanOptions = {}): LoadedApplyPlan {
  const nativeSvg = options.nativeSvg ?? "ok";
  const main = buildMainComposition();
  const calls: LoadedApplyPlan["calls"] = { begin: [], end: 0 };
  const dialogs = { begin: 0, end: 0 };
  const state: ApplyState = {
    options,
    rootFolder: new FakeFolderItem("root-folder", "Root"),
    projectItems: [main.comp],
    ids: { comp: new Sequence(), folder: new Sequence(), footage: new Sequence() },
    output: newOutputControls(),
    render: { calls: 0, queued: [] },
    store: { sizes: new Map(), contents: new Map() },
    nativeCalls: { options: 0, canImportAs: 0, importFile: 0 },
  };
  const canImport = (importAs: string): boolean => importAs === "footage" || (importAs === "composition" && nativeSvg !== "refuse");
  const app = fakeApp(state, calls, dialogs);
  const fileClass = fakeFileClass(state.store);
  const context = vm.createContext({
    app,
    CompItem: FakeCompItem,
    FolderItem: FakeFolderItem,
    FootageItem: FakeFootageItem,
    ...FOOTAGE_GLOBALS,
    ...HOST_ENUM_GLOBALS,
    Shape: FakeShape,
    File: fileClass,
    Folder: FakeHostFolder,
    ImportOptions: importOptionsClass(state.nativeCalls, canImport),
    KeyframeEase: FakeKeyframeEase,
    MarkerValue: FakeMarkerValue,
    $: { os: "Macintosh OS" },
  });
  registerHostFakes(context, { app, fileClass });
  loadHostFiles(context, "probe.jsx");
  const footage = new FakeFootageItem("footage-plate", "plate.mov");
  const { output, render, projectItems, store, nativeCalls } = state;
  return { apply: hostTextFunction(context, "aeApplyPlan"), output, calls, render, ...main, footage, projectItems, context, writtenFiles: store.sizes, writtenContents: store.contents, dialogs, nativeCalls };
}
