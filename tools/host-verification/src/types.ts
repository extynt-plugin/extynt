/**
 * Live verification case model: planned and compiled here through the real
 * ae_propose_plan and compileV2Plan, executed by the generated runner, and judged here
 * against the raw state After Effects reported. `@comp` / `@layer:key` tokens stand for
 * ids that exist only once the runner has built the fixture.
 */

import type { JsonObject, JsonValue } from "./json.js";

export type FixtureFile = "png-red" | "png-blue" | "wav-tone" | "video-mov" | "video-avi";
/** A footage fixture: a concrete file, or "video", which the runner resolves to whichever of video-avi / video-mov the host imports as a non-still clip. */
export type FootageFile = FixtureFile | "video";
export type FixtureLayerType = "text" | "box-text" | "shape" | "solid" | "null" | "adjustment" | "camera" | "one-node-camera" | "light" | "precomp" | "footage" | "audio";

export interface FixtureLayer {
  key: string;
  type: FixtureLayerType;
  name?: string | undefined;
  text?: string | undefined;
  box?: [number, number] | undefined;
  threeD?: boolean | undefined;
  startTime?: number | undefined;
  inPoint?: number | undefined;
  outPoint?: number | undefined;
  source?: string | undefined;
  lightType?: "PARALLEL" | "SPOT" | "POINT" | "AMBIENT" | undefined;
  effects?: string[] | undefined;
  shapeGroups?: number | undefined;
  masks?: number | undefined;
  motionTrackers?: number | undefined;
  markers?: number[] | undefined;
  keyframes?: Array<{ path: string; times: number[]; values: JsonValue[] }>;
  expression?: { path: string; source: string };
  parent?: string | undefined;
  textAnimators?: number | undefined;
  locked?: boolean | undefined;
  snapshotPaths?: string[] | undefined;
}

export interface Fixture {
  comp?: { name?: string | undefined; width?: number | undefined; height?: number | undefined; duration?: number | undefined; frameRate?: number | undefined };
  layers: FixtureLayer[];
  extraComps?: Array<{
    key: string;
    name: string;
    width?: number | undefined;
    height?: number | undefined;
    duration?: number | undefined;
    frameRate?: number | undefined;
    layers?: number | undefined;
  }>;
  folders?: Array<{ key: string; name: string }>;
  footage?: Array<{ key: string; file: FootageFile }>;
  project?: "saved" | "unsaved" | undefined;
}

export type LayerRef = string | { name: string };
export type CompRef = "case" | { name: string };
export type PropField = "value" | "numKeys" | "expression" | "expressionEnabled" | "expressionError" | "enabled" | "name" | "hidden" | "numProperties" | "separated";

export type Check =
  | { kind: "prop"; layer: LayerRef; path: string; field?: PropField | undefined; equals?: JsonValue | undefined; approx?: number | number[] | undefined; tolerance?: number | undefined; exists?: boolean | undefined; comp?: CompRef | undefined }
  | { kind: "keys"; layer: LayerRef; path: string; times?: number[] | undefined; values?: JsonValue[] | undefined; tolerance?: number | undefined; interpolation?: Array<[string, string]> | undefined; comp?: CompRef | undefined }
  | { kind: "children"; layer: LayerRef; path: string; matchName: string; count: number; comp?: CompRef | undefined }
  | { kind: "layer"; layer: LayerRef; field: string; equals?: JsonValue | undefined; approx?: number | undefined; tolerance?: number | undefined; exists?: boolean | undefined; comp?: CompRef | undefined }
  | { kind: "layerCount"; equals: number; comp?: CompRef | undefined }
  | { kind: "comp"; field: string; equals?: JsonValue | undefined; approx?: number | number[] | undefined; tolerance?: number | undefined; comp?: CompRef | undefined; exists?: boolean | undefined }
  | { kind: "item"; name: string; field?: string | undefined; equals?: JsonValue | undefined; exists?: boolean | undefined; count?: number | undefined }
  | { kind: "host"; step?: number | undefined; ok?: boolean | undefined; code?: string | undefined; field?: string | undefined; equals?: JsonValue | undefined }
  | { kind: "file"; name: string; exists: boolean; minBytes?: number | undefined }
  | { kind: "hostFile"; step?: number | undefined; minBytes?: number | undefined }
  | { kind: "custom"; describe: string; check: (view: ReadbackView) => string | undefined };

/** One plan submitted through ae_propose_plan, or a raw host command that bypasses the planner (defense in depth). */
export type CaseStep = { operations: JsonObject[]; summary?: string | undefined } | { rawCommand: JsonObject };

export interface LiveCase {
  id: string;
  domain: string;
  title: string;
  covers: string[];
  fixture: Fixture;
  steps: CaseStep[];
  expect: Check[];
  outcome?: { kind: "applied" | undefined } | { kind: "planner"; code: string } | { kind: "host"; code: string; mayMutate?: boolean | undefined } | { kind: "dialog" };
  rerun?: boolean | undefined;
  undo?: boolean | undefined;
  external?: boolean | undefined;
  verifies?: string[] | undefined;
  notes?: string | undefined;
}

/** The mask fields the runner reports on a mask-atom group entry; enum members are names when the host resolved one. */
export interface MaskEntry {
  mode?: string | number | undefined;
  inverted?: boolean | undefined;
  rotoBezier?: boolean | undefined;
  locked?: boolean | undefined;
  featherFalloff?: string | number | undefined;
  motionBlur?: string | number | undefined;
}

/** Flattened property entry reported by the runner. */
export interface PropEntry {
  mn: string;
  nm: string;
  pt: "P" | "G" | "I";
  en?: boolean | undefined;
  h?: boolean | undefined;
  c?: number | undefined;
  ix?: number | undefined;
  vt?: string | undefined;
  v?: JsonValue | undefined;
  n?: number | undefined;
  k?: KeyEntry[] | undefined;
  x?: string | undefined;
  xe?: boolean | undefined;
  xr?: string | undefined;
  sep?: boolean | undefined;
  cv?: boolean | undefined;
  min?: number | undefined;
  max?: number | undefined;
  dims?: number | undefined;
  mask?: MaskEntry | undefined;
}
export interface KeyEntry {
  t: number;
  v?: JsonValue | undefined;
  ii?: string | undefined;
  oi?: string | undefined;
  ie?: number[][] | undefined;
  oe?: number[][] | undefined;
  r?: boolean | undefined;
  si?: number[] | undefined;
  so?: number[] | undefined;
}
export interface DumpSections {
  items: Record<string, JsonObject | null>;
  comps: Record<string, JsonObject | null>;
  layers: Record<string, JsonObject | null>;
  props: Record<string, PropEntry | null>;
  files: Record<string, JsonObject | null>;
}

export interface HostStepRecord { phase: "apply" | "rerun"; stepIndex: number; ok: boolean; response: JsonObject | null; durationMs: number; raw?: string | undefined }

/** What the runner recorded about undoing a case. */
export interface UndoRecord {
  attempted: number;
  allowed?: number | undefined;
  restoredAfter?: number | null | undefined;
  overshot?: boolean | undefined;
  errors: string[];
}

/** How far the runner got with one case. */
export type CaseStatus = "ran" | "skipped" | "fixture-failed" | "runner-error" | "host-crashed" | "pending-undo";

export interface CaseRunRecord {
  id: string;
  status: CaseStatus;
  crashPhase?: string | undefined;
  skipReason?: string | undefined;
  error?: string | undefined;
  tokens: Record<string, string>;
  caseCompId: string | null;
  baseline: DumpSections | null;
  afterApply: DumpSections | null;
  afterRerun: DumpSections | null;
  afterUndo: DumpSections | null;
  host: HostStepRecord[];
  undo: UndoRecord | null;
  cleanup: string;
}

/** Which kit generated a report. */
export interface KitStamp { generatedAt: string; packDigest: string; extyntVersion: string }

/** The After Effects host a report was produced on. */
export interface RuntimeInfo { appVersion: string; buildNumber: string | null; platform: string; architecture: string; os: string; locale: string | null }

export interface LiveReport {
  schemaVersion: "0.1";
  kit: KitStamp;
  runtime: RuntimeInfo | null;
  hostKey: string | null;
  startedAt: string;
  finishedAt: string | null;
  cases: CaseRunRecord[];
  apiProbes: JsonObject;
  runnerErrors: string[];
  provenanceProblems?: string[] | undefined;
}

/** Reconstructed state after a phase, with lookups the analyzer and custom checks use. */
export interface ReadbackView {
  sections: DumpSections;
  tokens: Record<string, string>;
  caseCompId: string | null;
  layerId(ref: LayerRef, comp?: CompRef): string | null;
  prop(ref: LayerRef, path: string, comp?: CompRef): PropEntry | null;
  layer(ref: LayerRef, comp?: CompRef): JsonObject | null;
  comp(ref?: CompRef): JsonObject | null;
}
