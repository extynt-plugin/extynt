/**
 * Assembles the fake host the probe runs against: project, `app`, `$` globals and the
 * ExtendScript context, with one `applyPlan` built from the dispatch table.
 */
import { FakeFolder, FakeProject } from "./layers.js";
import { FakeProperty, FakePropertyGroup } from "./property.js";
import { enumHolder, enumName, hasProperty, messageOf, plain, reflectNames, safe, TRACK_MATTE_TYPE, type EnumHolders, type FakeApp, type FakeGlobals, type FakeHost, type ProbeContext } from "./extendscript.js";
import { createPlanApplier, type HostState } from "./dispatch.js";

const FONT_FAMILIES = [
  [{ familyName: "Helvetica", styleName: "Regular", postScriptName: "Helvetica", isSubstitute: false, isFromAdobeFonts: false }, { familyName: "Helvetica", styleName: "Bold", postScriptName: "Helvetica-Bold", isSubstitute: false, isFromAdobeFonts: false }],
  [{ familyName: "Inter", styleName: "Regular", postScriptName: "Inter-Regular", isSubstitute: true, isFromAdobeFonts: true }],
];

const UNDO_COMMAND_ID = 16;

const createEnumHolders = (): EnumHolders => ({
  TrackMatteType: enumHolder(TRACK_MATTE_TYPE),
  PropertyValueType: enumHolder({ OneD: 1, TwoD: 2, ThreeD: 3, COLOR: 4, SHAPE: 5, NO_VALUE: 6, CUSTOM_VALUE: 7 }),
  PropertyType: enumHolder({ PROPERTY: 1, INDEXED_GROUP: 2, NAMED_GROUP: 3 }),
  MaskMode: enumHolder({ ADD: 1, SUBTRACT: 2 }),
  LightType: enumHolder({ PARALLEL: 1, SPOT: 2, POINT: 3, AMBIENT: 4 }),
});

const createApp = (project: FakeProject, undoOnce: () => void): FakeApp => ({
  version: "26.2.1",
  buildNumber: "2",
  project,
  effects: [],
  fonts: { allFonts: FONT_FAMILIES },
  executeCommand: (commandId: number) => { if (commandId === UNDO_COMMAND_ID) undoOnce(); },
});

const createContext = (applyPlan: (raw: string) => string, undoOnce: () => void, enums: EnumHolders): ProbeContext => ({
  safe,
  plain,
  enumName: (holderName, value) => enumName(holderName, value, enums),
  has: hasProperty,
  message: messageOf,
  iso: () => new Date().toISOString(),
  folder: new FakeFolder(999, "extynt Open Questions Probe"),
  outFolder: "/tmp/extynt-open-questions",
  applyPlan,
  reflectNames,
  undo: undoOnce,
  status: () => undefined,
});

export function createFakeHost(): FakeHost {
  const project = new FakeProject();
  const state: HostState = { project, calls: [], undoStack: [] };
  const undoOnce = (): void => { const step = state.undoStack.pop(); if (step) step(); };
  const enums = createEnumHolders();
  const globals: FakeGlobals = { ...enums, Property: FakeProperty, PropertyGroup: FakePropertyGroup };
  const applyPlan = createPlanApplier(state);
  return { context: createContext(applyPlan, undoOnce, enums), project, app: createApp(project, undoOnce), globals, calls: state.calls, applyPlan };
}
