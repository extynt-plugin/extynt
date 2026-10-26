// A small project in the shape the native plugin produces.
import type { NativeReadResult, WatchState } from "@extynt/host-native";
import type { WireObject, WireValue } from "./wire.js";

/** One property row of a layer, as the plugin reads it. */
export type FixtureEntry = {
  path: string; matchName: string; displayName: string; kind: string; valueType: string; value: WireValue;
  canSetValue: boolean; expression: string | null; expressionEnabled: boolean; keyframeCount?: number;
};

/** A layer row. Members beyond the named ones are open because the plugin's rows carry many more (hashes, flags) that tests add as they need them. */
export type FixtureLayer = { id: string; index: number; name: string; propertyPaths: FixtureEntry[]; [member: string]: WireValue };

/** A composition row, open for the same reason as the layer row. */
export type FixtureComposition = { id: string; name: string; layers: FixtureLayer[]; [member: string]: WireValue };

/** The `read_project` answer the fake serves: the plugin's own shape, with its rows typed as wire data. */
export type FixtureProject = Omit<NativeReadResult, "items" | "sources" | "compositions"> & {
  items?: WireObject[];
  sources?: WireObject[];
  compositions: FixtureComposition[];
};

/** What the plugin's watch reports, as a type alias rather than an interface so it is assignable to a wire value. */
export type WatchReport = Pick<WatchState, keyof WatchState>;

/** A property row at `path`; the match name is the last path segment unless overridden. */
export function entry(path: string, overrides: Partial<FixtureEntry> = {}): FixtureEntry {
  return {
    path, matchName: path.split("/").at(-1) ?? path, displayName: path, kind: "property", valueType: "number",
    value: 0, canSetValue: true, expression: null, expressionEnabled: false, ...overrides,
  };
}

/** A layer with a transform group, position and opacity rows. */
export function makeLayer(id: string, index: number, overrides: Partial<FixtureLayer> = {}): FixtureLayer {
  return {
    id, index, name: `Layer ${id}`, selected: false, type: "solid", enabled: true, locked: false, startTime: 0, inPoint: 0,
    outPoint: 10, parentId: null, sourceId: "7",
    propertyPaths: [
      entry("ADBE Transform Group", { kind: "group", valueType: "unknown", value: null, canSetValue: false }),
      entry("ADBE Transform Group/ADBE Position", { valueType: "vector", value: [960, 540] }),
      entry("ADBE Transform Group/ADBE Opacity", { value: 100 }),
    ],
    ...overrides,
  };
}

/** The default project: one composition `Main` (id 5) with layers 11 and 12, a folder and a solid. */
export function makeProject(): FixtureProject {
  return {
    source: "native",
    project: { name: "Test.aep", filePath: "/tmp/Test.aep", dirty: false },
    itemCount: 3,
    activeCompositionId: "5",
    currentTime: 0,
    selectedLayerIds: [],
    items: [
      { id: "5", name: "Main", type: "composition", parentFolderId: "0", compositionId: "5", sourceId: null },
      { id: "6", name: "Folder", type: "folder", parentFolderId: "0", compositionId: null, sourceId: null },
      { id: "7", name: "Solid", type: "footage", parentFolderId: "6", compositionId: null, sourceId: "7" },
    ],
    sources: [{ id: "7", name: "Solid", type: "solid", missing: false, width: 1920, height: 1080, duration: 0 }],
    compositions: [{
      id: "5", name: "Main", width: 1920, height: 1080, pixelAspect: 1, duration: 10, frameRate: 25, currentTime: 0,
      truncated: false, layers: [makeLayer("11", 1), makeLayer("12", 2)],
    }],
    warnings: [],
  };
}

/** The watch state a fresh plugin reports for `project`: epoch 1, revision 100 (null when the guard is off), nothing selected. */
export function initialWatchState(project: FixtureProject, revisionGuard: "on" | "off" = "on"): WatchReport {
  const active = project.compositions[0];
  return {
    epoch: 1, revision: revisionGuard === "on" ? 100 : null, items: project.itemCount, projectName: project.project.name, projectPath: project.project.filePath,
    activeCompId: active?.id ?? null, activeCompName: active?.name ?? null, time: 0, selection: [], selectedLayers: [],
  };
}
