/** Fake After Effects render-output and project-cleanup surface: settings holders, queueInAME and the three cleanup calls. */

/** An output module "Resize to" reading: the pair After Effects reports back. */
export interface ResizePair {
  readonly x: number;
  readonly y: number;
}

/** A setting value an output module or render queue item reports. */
export type OutputSettingValue = string | number | boolean | ResizePair;

export type OutputSettingInput = OutputSettingValue | readonly [number, number];

/** Controls a test flips at run time to make the fake host refuse, adjust or lack something. */
export interface OutputFakeControls {
  readonly refuseKeys: Set<string>;
  readonly adjust: Map<string, string>;
  readonly hideKeys: Set<string>;
  ame: "ok" | "missing" | "fails";
  readonly ameCalls: Array<{ start: boolean; rendering: string[] }>;
  readonly cleanupCalls: string[];
  readonly unusedIds: Set<string>;
  readonly duplicateIds: Set<string>;
}

/** The setSettings/getSettings pair After Effects puts on an output module and on a render queue item. */
export interface SettingsHolder {
  setSettings(update: Readonly<Record<string, OutputSettingInput>>): void;
  getSettings(): Record<string, OutputSettingInput>;
}

/** The project item shape the cleanup fakes need: an id. */
export interface IdentifiedItem {
  readonly id: string;
}

const REAL_OUTPUT_MODULE: ReadonlyArray<readonly [string, OutputSettingValue]> = [
  ["Format", "H.264"],
  ["Video Codec", "H.264"],
  ["Video Output", true],
  ["Channels", "RGB"],
  ["Depth", "Millions of Colors"],
  ["Color", "Premultiplied (Matted)"],
  ["Resize", false],
  ["Lock Aspect Ratio", true],
  ["Resize to", { x: 640, y: 360 }],
  ["Resize Quality", "High"],
  ["Crop", false],
  ["Crop Top", 0],
  ["Crop Left", 0],
  ["Crop Bottom", 0],
  ["Crop Right", 0],
  ["Output Audio", "Auto"],
  ["Audio Sample Rate", "48.000 kHz"],
  ["Audio Bit Depth", "16 Bit"],
  ["Audio Channels", "Stereo"],
];

const REAL_RENDER_ITEM: ReadonlyArray<readonly [string, OutputSettingValue]> = [
  ["Quality", "Best"],
  ["Resolution", "Full"],
  ["Motion Blur", "On for Checked Layers"],
  ["Frame Blending", "On for Checked Layers"],
  ["Effects", "All On"],
  ["Time Span", "Length of Comp"],
];

const READ_ONLY_KEYS: ReadonlySet<string> = new Set(["Channels"]);

function isPair(input: OutputSettingInput): input is readonly [number, number] {
  return Array.isArray(input);
}

function resizeToValue(input: OutputSettingInput): ResizePair {
  if (isPair(input)) return { x: Number(input[0]), y: Number(input[1]) };
  if (typeof input === "object") return { x: Number(input.x), y: Number(input.y) };
  return { x: Number.NaN, y: Number.NaN };
}

function storedValue(controls: OutputFakeControls, key: string, input: OutputSettingInput): OutputSettingInput {
  if (key === "Resize to") return resizeToValue(input);
  return controls.adjust.get(key) ?? input;
}

function settingsHolder(controls: OutputFakeControls, initial: ReadonlyArray<readonly [string, OutputSettingValue]>): SettingsHolder {
  const values = new Map<string, OutputSettingInput>(initial);
  return {
    setSettings(update) {
      for (const [key, input] of Object.entries(update)) {
        if (!values.has(key) || controls.refuseKeys.has(key)) throw new Error(`Invalid Key: <${key}>`);
        if (READ_ONLY_KEYS.has(key)) throw new Error(`Invalid Value for key: <${key}>. Property is read-only`);
        values.set(key, storedValue(controls, key, input));
      }
    },
    getSettings() {
      const reported = Array.from(values).filter(([key]) => !controls.hideKeys.has(key));
      return Object.fromEntries(reported);
    },
  };
}

function removeMatching(projectItems: IdentifiedItem[], matches: (item: IdentifiedItem) => boolean): number {
  const kept = projectItems.filter((item) => !matches(item));
  const removed = projectItems.length - kept.length;
  projectItems.splice(0, projectItems.length, ...kept);
  return removed;
}

/** Fresh controls: nothing refused, adjusted or hidden, Media Encoder present, no calls recorded. */
export function newOutputControls(): OutputFakeControls {
  return { refuseKeys: new Set(), adjust: new Map(), hideKeys: new Set(), ame: "ok", ameCalls: [], cleanupCalls: [], unusedIds: new Set(), duplicateIds: new Set() };
}

/** reduceProject / removeUnusedFootage / consolidateFootage over the harness's project item list; each returns how many items it removed. */
export function fakeProjectCleanup(controls: OutputFakeControls, projectItems: IdentifiedItem[]) {
  return {
    reduceProject: (kept: readonly IdentifiedItem[]): number => {
      controls.cleanupCalls.push("reduce");
      const keptIds = new Set(Array.from(kept, (item) => item.id));
      return removeMatching(projectItems, (item) => !keptIds.has(item.id) && item.id.startsWith("imported-"));
    },
    removeUnusedFootage: (): number => {
      controls.cleanupCalls.push("remove_unused_footage");
      return removeMatching(projectItems, (item) => controls.unusedIds.has(item.id));
    },
    consolidateFootage: (): number => {
      controls.cleanupCalls.push("consolidate_footage");
      return removeMatching(projectItems, (item) => controls.duplicateIds.has(item.id));
    },
  };
}

/** A queueInAME that records the start flag and the rendering items, or throws as a missing or unreachable encoder does. */
export function fakeQueueInAME(controls: OutputFakeControls, renderingNow: () => string[]) {
  return (start: boolean): void => {
    if (controls.ame === "missing") throw new Error("Adobe Media Encoder is not installed.");
    if (controls.ame === "fails") throw new Error("Could not reach the encoder queue.");
    controls.ameCalls.push({ start, rendering: renderingNow() });
  };
}

/** The settings pair of a new output module, over After Effects 26.5 H.264 keys (confirmed live): an unknown key throws Invalid Key and Channels is read-only. */
export function fakeOutputModuleSettings(controls: OutputFakeControls): SettingsHolder {
  return settingsHolder(controls, REAL_OUTPUT_MODULE);
}

/** The settings pair of a new render queue item. */
export function fakeRenderItemSettings(controls: OutputFakeControls): SettingsHolder {
  return settingsHolder(controls, REAL_RENDER_ITEM);
}
