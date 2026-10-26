/**
 * The ExtendScript-facing corner of the fixture: the JSON precision stage, the enum
 * holders the probe reflects over, the `Folder`/`File` file system, and the role table
 * the fake shares with the production adapter.
 */
import { enumNumber, isProbeArray, probeObjectOf, type Json, type ProbeObject, type ProbeValue } from "./narrow.js";
import type { FakeFolder, FakeProject } from "./layers.js";
import type { FakeProperty, FakePropertyGroup } from "./property.js";

/**
 * The last stage of the real pipeline is ExtendScript's JSON.stringify, which writes
 * about 14 significant digits, so a report-comparable value goes through here.
 */
export function reportPrecision(value: Json): Json {
  if (typeof value === "number") return value === 0 || !Number.isFinite(value) ? value : Number(value.toPrecision(14));
  if (Array.isArray(value)) return value.map(reportPrecision);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, reportPrecision(entry)]));
  return value;
}

export const FAKE_PRESET_PATH = "/Applications/Adobe After Effects 2026/Presets/Transform/Fake Preset.ffx";

/** One Animation Preset exists under the application's Presets folder, so the probe's search finds one. */
export class FakeDiskFile {
  fsName: string;
  constructor(fsName: string) { this.fsName = fsName; }
  get name(): string { return this.fsName.split("/").pop() ?? this.fsName; }
  get exists(): boolean { return true; }
}

export class FakeDiskFolder {
  static myDocuments = new FakeDiskFolder("/Users/fake/Documents");
  fsName: string;
  constructor(fsName: string) { this.fsName = fsName; }
  get exists(): boolean { return this.getFiles().length > 0; }
  getFiles(): Array<FakeDiskFolder | FakeDiskFile> {
    if (this.fsName === "/Applications") return [new FakeDiskFolder("/Applications/Adobe After Effects 2026")];
    if (this.fsName === "/Applications/Adobe After Effects 2026") return [new FakeDiskFolder("/Applications/Adobe After Effects 2026/Presets")];
    if (this.fsName === "/Applications/Adobe After Effects 2026/Presets") return [new FakeDiskFolder("/Applications/Adobe After Effects 2026/Presets/Transform")];
    if (this.fsName === "/Applications/Adobe After Effects 2026/Presets/Transform") return [new FakeDiskFile(FAKE_PRESET_PATH)];
    if (this.fsName === "/Users/fake/Documents") return [new FakeDiskFolder("/Users/fake/Documents/Adobe")];
    return [];
  }
}

export const TRACK_MATTE_TYPE: Record<string, number> = { NO_TRACK_MATTE: 5012, ALPHA: 5011, ALPHA_INVERTED: 5014, LUMA: 5013, LUMA_INVERTED: 5015 };

/** The production adapter's allowlist (apps/panel/host/apply-layers.jsx, `aeApplyNativeLayerProperty`); a test compares the two lists. */
export const LAYER_ROLES: Record<string, string> = { "transform.opacity": "ADBE Transform Group/ADBE Opacity", "transform.scale": "ADBE Transform Group/ADBE Scale", "transform.rotation": "ADBE Transform Group/ADBE Rotate Z", "transform.position": "ADBE Transform Group/ADBE Position", "transform.anchor": "ADBE Transform Group/ADBE Anchor Point" };

interface EnumReflection { properties: Array<{ name: string }>; methods: string[] }

/** An enumeration global: its members by name plus the `reflect` listing the probe walks. */
export type EnumHolder = Readonly<Record<string, number | EnumReflection>>;

export function enumHolder(values: Record<string, number>): EnumHolder {
  const properties = [...Object.keys(values).map((name) => ({ name })), { name: "__proto__" }];
  return { ...values, reflect: { properties, methods: [] } };
}

const OBJECT_PROTOTYPE_NAMES = new Set(["constructor", "toString", "toLocaleString", "valueOf", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable", "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__", "__proto__"]);

interface PrototypeMember { name: string; isMethod: boolean; isGetter: boolean }

const prototypeMembers = (target: ProbeObject): PrototypeMember[] => {
  const prototype = Reflect.getPrototypeOf(target);
  return Object.getOwnPropertyNames(prototype)
    .filter((name) => !OBJECT_PROTOTYPE_NAMES.has(name))
    .map((name) => ({ name, isMethod: typeof target[name] === "function", isGetter: Boolean(Object.getOwnPropertyDescriptor(prototype, name)?.get) }));
};

/** Reflection the way ExtendScript's `reflect` does: own data fields and prototype accessors as properties, real functions as methods. */
export function reflectNames(object: ProbeObject): { properties: string[]; methods: string[] } {
  const own = Object.keys(object).filter((name) => typeof object[name] !== "function");
  const members = prototypeMembers(object);
  const accessors = members.filter((member) => !member.isMethod && member.isGetter && !own.includes(member.name)).map((member) => member.name);
  const methods = members.filter((member) => member.isMethod).map((member) => member.name);
  return { properties: [...own, ...accessors].sort(), methods: [...new Set(methods)].sort() };
}

/** One probe call the fake plan applier answered: the operation, whether it applied, and the refusal code when it did not. */
export interface HostCall { operation: string; ok: boolean; code?: string }

/** Every probe read and write goes through this, so one unreadable property leaves a marker instead of stopping the run. */
export const safe = <T>(call: () => T, fallback: T): T => { try { return call(); } catch { return fallback; } };

export const hasProperty = (object: ProbeObject, key: string): boolean => Object.prototype.hasOwnProperty.call(object, key);

export const messageOf = (error: ProbeValue | Error): string => {
  const detail = error instanceof Error ? error.message : probeObjectOf(error).message;
  return String(typeof detail === "string" ? detail : error).slice(0, 400);
};

const plainObject = (value: ProbeObject, depth: number): Json => {
  const out: Record<string, Json> = {};
  for (const [key, entry] of Object.entries(value)) if (typeof entry !== "function") out[key] = plain(entry, depth + 1);
  return out;
};

const isScalar = (value: ProbeValue): value is number | string | boolean => typeof value === "number" || typeof value === "string" || typeof value === "boolean";

/** A JSON-safe copy for the report, with functions dropped and depth capped. */
export const plain = (value: ProbeValue, depth = 0): Json => {
  if (value === null || value === undefined) return null;
  if (isScalar(value)) return value;
  if (depth > 4) return "[depth]";
  if (isProbeArray(value)) return value.map((entry) => plain(entry, depth + 1));
  if (typeof value === "object") return plainObject(value, depth);
  return String(value);
};

/** The enum member name a host enum value stands for, or the raw value when the holder does not list it. */
export const enumName = (holderName: string, value: ProbeValue, holders: Readonly<Record<string, EnumHolder>>): ProbeValue => {
  const numeric = enumNumber(value);
  if (numeric === null) return value;
  const holder = holders[holderName] ?? {};
  return Object.entries(holder).find(([, member]) => member === numeric)?.[0] ?? numeric;
};

type EnumHolderName = "TrackMatteType" | "PropertyValueType" | "PropertyType" | "MaskMode" | "LightType";

/** The enumeration globals the probe reflects over, by global name. */
export type EnumHolders = { readonly [name in EnumHolderName]: EnumHolder };

/** The globals the probe reads from `$.global`: the enumerations and the property classes. */
export type FakeGlobals = EnumHolders & { readonly Property: typeof FakeProperty; readonly PropertyGroup: typeof FakePropertyGroup };

/** The `app` object the probe runs against. */
export interface FakeApp {
  version: string;
  buildNumber: string;
  project: FakeProject;
  effects: Json[];
  fonts: { allFonts: Json[][] };
  executeCommand: (commandId: number) => void;
}

/** The helper bundle the probe receives as its context argument. */
export type ProbeContext = {
  readonly safe: typeof safe;
  readonly plain: typeof plain;
  readonly enumName: (holderName: string, value: ProbeValue) => ProbeValue;
  readonly has: typeof hasProperty;
  readonly message: typeof messageOf;
  readonly iso: () => string;
  readonly folder: FakeFolder;
  readonly outFolder: string;
  readonly applyPlan: (raw: string) => string;
  readonly reflectNames: typeof reflectNames;
  readonly undo: () => void;
  readonly status: () => undefined;
};

/** The fake host: what the probe is handed plus the project and call log the tests inspect. */
export interface FakeHost {
  context: ProbeContext;
  project: FakeProject;
  app: FakeApp;
  globals: FakeGlobals;
  calls: HostCall[];
  applyPlan: (raw: string) => string;
}
