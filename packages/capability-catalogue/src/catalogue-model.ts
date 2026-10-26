// The catalogue's vocabulary: capabilities, controls, evidence, inventories and the host capability profile built from them.
import type { LayerType } from "@extynt/project-graph";
import type { JsonValue } from "@extynt/decode";

import type { FontInventory } from "./fonts.js";

export const CATALOGUE_SCHEMA = "0.1" as const;
export const HOST_PROFILE_SCHEMA = "0.1" as const;

export const CONFIDENCES = ["discovered", "observed", "documented", "verified", "inferred", "unsupported"] as const;
export type Confidence = (typeof CONFIDENCES)[number];

export const CAPABILITY_KINDS = ["effect", "preset", "command", "importer", "codec", "renderer", "panel", "script", "utility"] as const;
export type CapabilityKind = (typeof CAPABILITY_KINDS)[number];

export const ENUMERATION_STATES = ["enumerable", "manually-registered", "partially-observable", "unsupported-by-adapter", "unknown"] as const;
export type EnumerationState = (typeof ENUMERATION_STATES)[number];

export const NATIVE_FAMILIES = ["transform", "text", "masks", "shape", "footage", "camera", "light", "audio"] as const;
export type NativeFamily = (typeof NATIVE_FAMILIES)[number];

export const SEMANTIC_CONTROL_ROLES = [
  "transform.anchor-point", "transform.position", "transform.scale", "transform.rotation", "transform.opacity",
  "text.source", "text.font-size", "text.fill-color",
  "mask.shape", "mask.opacity", "mask.feather", "mask.expansion",
  "shape.path", "shape.fill-color", "shape.stroke-color", "shape.stroke-width",
  "footage.source", "camera.zoom", "camera.focus-distance", "camera.depth-of-field",
  "light.intensity", "light.color", "light.cone-angle", "audio.level",
  "blur.amount", "blur.repeat-edges", "glow.threshold", "glow.radius", "glow.intensity",
  "color.levels", "color.curves", "color.hue-saturation", "color.tint", "color.exposure",
  "sharpen.amount", "noise.amount", "distort.amount", "stylize.amount", "keying.amount", "transition.amount",
  "gradient.start-point", "gradient.start-color", "gradient.end-point", "gradient.end-color", "gradient.shape",
] as const;
export type SemanticControlRole = (typeof SEMANTIC_CONTROL_ROLES)[number];

export const EVIDENCE_SOURCES = ["host", "catalogue", "documentation", "fixture"] as const;

/** One piece of evidence behind a catalogue claim: how confident it is, where it came from and, optionally, a reference and note. */
export interface Evidence {
  kind: Confidence;
  source: (typeof EVIDENCE_SOURCES)[number];
  reference?: string;
  note?: string;
}

/**
 * One property of an effect or native family. `units` is After Effects' unitsText label and is absent when it reports none;
 * `defaultValue` is the value the live probe read, as JSON.
 */
export interface ControlSchema {
  path: string;
  matchName: string;
  displayName: string;
  valueType: string;
  dimensions?: number;
  canSetValue?: boolean;
  role?: SemanticControlRole;
  children?: ControlSchema[];
  defaultValue?: JsonValue;
  min?: number;
  max?: number;
  units?: string;
  menu?: string[];
  animatable?: false;
  hidden?: true;
}

/** A capability's lowest and highest supported After Effects version. */
export interface VersionRange {
  minVersion?: string;
  maxVersion?: string;
}

/** A sentence about how a capability is used, with the evidence behind it. */
export interface UsageProfile {
  summary: string;
  evidence: Evidence[];
}

/** One thing the host can do: an effect, a native property family, a preset or another kind, identified by id and, for effects, by `matchName`. */
export interface Capability {
  id: string;
  version: string;
  kind: CapabilityKind;
  matchName?: string;
  displayName: string;
  provider: string;
  category?: string;
  nativeFamily?: NativeFamily;
  layerTypes?: LayerType[];
  semanticRoles?: SemanticControlRole[];
  description?: string;
  controls?: ControlSchema[];
  requirements?: string[];
  usageProfiles?: UsageProfile[];
  evidence: Evidence[];
  compatibility?: VersionRange;
}

/** The After Effects installation a scan describes. */
export interface HostInstallation {
  application: "After Effects";
  version: string;
  buildNumber: string | null;
  platform: string;
  architecture: string;
}

/** The curated capabilities with, per kind, how far the host lets that kind be enumerated. */
export interface CatalogueGraph {
  schemaVersion: typeof CATALOGUE_SCHEMA;
  catalogueVersion: string;
  enumeration: Record<CapabilityKind, EnumerationState>;
  host?: HostInstallation;
  capabilities: Capability[];
}

/**
 * One effect the host census reported. `hasOptionsDialog` is set when the plugin declares an options dialog
 * (PF_OutFlag_I_DO_DIALOG), so adding it may ask the user for something; it is absent until the native census reports it.
 */
export interface InventoryItem {
  matchName: string;
  displayName: string;
  category?: string;
  version?: string | null;
  available: boolean;
  evidence: Evidence[];
  hasOptionsDialog?: boolean;
}

export const INVENTORY_COMPLETENESS = ["complete", "partial", "failed"] as const;
export type InventoryCompleteness = (typeof INVENTORY_COMPLETENESS)[number];

/** The effects installed on one host, in canonical order, with the verdict of the scan that produced them. */
export interface Inventory {
  schemaVersion: typeof CATALOGUE_SCHEMA;
  host: HostInstallation;
  items: InventoryItem[];
  truncated: boolean;
  completeness: InventoryCompleteness;
  fingerprint: string;
}

/** What changed between two inventories of the same host. */
export interface InventoryDiff {
  added: InventoryItem[];
  removed: InventoryItem[];
  changed: Array<{ before: InventoryItem; after: InventoryItem }>;
  unchanged: number;
}

export const PROFILE_EVIDENCE_KINDS = ["documented", "curated", "installed", "observed", "probed", "inferred", "unsupported", "unknown"] as const;
export type ProfileEvidenceKind = (typeof PROFILE_EVIDENCE_KINDS)[number];

export const USER_ASSISTED_REASONS = ["opens-dialog", "observed-interactive", "may-ask-options", "analyzes-in-background"] as const;

/**
 * Why an effect needs the user: its dialog is known, was seen holding After Effects while this machine was scanned,
 * the plugin says it may ask for options, or it analyses the footage after it is added and only the user can finish that.
 */
export type UserAssistedReason = (typeof USER_ASSISTED_REASONS)[number];

/** Present on a profile entry when adding the effect may show a dialog the user must finish; the agent may still plan it. */
export interface UserAssisted {
  reason: UserAssistedReason;
  note: string;
}

export const OPERATION_STATUSES = ["supported", "read-only", "probeNeeded", "unsupported", "unknown"] as const;
export const PROBE_STATES = ["manual-unavailable", "probeNeeded", "probed", "quarantined"] as const;
export const AVAILABILITIES = ["available", "unavailable", "unknown"] as const;
export const PROFILE_ENTRY_KINDS = [...CAPABILITY_KINDS, "native"] as const;

/** One capability or installed effect as the host profile states it, with what is known about using it here. */
export interface HostProfileEntry {
  id: string;
  kind: CapabilityKind | "native";
  matchName?: string | undefined;
  displayName: string;
  description: string;
  version?: string | null | undefined;
  category?: string | undefined;
  provider?: string | undefined;
  availability: (typeof AVAILABILITIES)[number];
  controls?: ControlSchema[] | undefined;
  applicability?: LayerType[] | undefined;
  requirements?: string[] | undefined;
  operationStatus: (typeof OPERATION_STATUSES)[number];
  evidence: ProfileEvidenceKind[];
  provenance: string;
  probeState: (typeof PROBE_STATES)[number];
  userAssisted?: UserAssisted | undefined;
}

export const PRESET_ROOTS = ["ae-presets", "user-presets", "unknown"] as const;

/** One animation preset file found on this computer. */
export interface PresetInventoryItem {
  id: string;
  root: (typeof PRESET_ROOTS)[number];
  name: string;
  category: string;
  statFingerprint: string;
}

/** The animation presets found on this computer by one scan. */
export interface PresetInventory {
  items: PresetInventoryItem[];
  truncated: boolean;
  fingerprint: string;
  scannedAt: string;
}

export const PROFILE_PHASES = ["shallow", "partial", "complete"] as const;
export const CACHE_STATUSES = ["fresh", "unchanged", "restored"] as const;

/**
 * Everything known about this host's capabilities: the curated catalogue joined to the live inventory, presets and fonts.
 * `inventoryCompleteness` is the census verdict the profile was built from; `inventoryTruncated` cannot say "the scan failed",
 * so an entry's absence is evidence of absence only when it is "complete".
 */
export interface HostCapabilityProfile {
  schemaVersion: typeof HOST_PROFILE_SCHEMA;
  catalogueVersion: string;
  host: HostInstallation;
  shallowFingerprint: string;
  profileId: string;
  cacheStatus: (typeof CACHE_STATUSES)[number];
  inventoryTruncated: boolean;
  inventoryCompleteness?: InventoryCompleteness;
  inventoryTotalReported?: number;
  inventoryReturnedCount?: number;
  presetInventory: PresetInventory;
  fontInventory: FontInventory;
  phase: (typeof PROFILE_PHASES)[number];
  entries: HostProfileEntry[];
  probeNeeded: string[];
  removed: string[];
  lastShallowScan: string;
}

export const PROBE_ROW_KINDS = ["OneD", "TwoD", "TwoD_SPATIAL", "ThreeD", "ThreeD_SPATIAL", "COLOR", "LAYER_INDEX", "MASK_INDEX", "SHAPE", "TEXT_DOCUMENT", "CUSTOM_VALUE", "NO_VALUE", "MARKER"] as const;

/**
 * One row of the live control probe, flattened depth-first: `m` match name, `n` display name, `t` value type, `v` default,
 * `min` and `max` bounds, `u` After Effects' unitsText, `dd` a dropdown with `items`, `static` not animatable, `hid` hidden,
 * and `g` the number of rows a group row contains. A member the probe did not report, or reported in the wrong type, is undefined.
 */
export interface EffectProbeRow {
  m?: string | undefined;
  n?: string | undefined;
  t?: string | null | undefined;
  v?: JsonValue | undefined;
  min?: number | undefined;
  max?: number | undefined;
  u?: string | undefined;
  dd?: boolean | undefined;
  items?: string[] | null | undefined;
  static?: boolean | undefined;
  hid?: boolean | undefined;
  g?: number | undefined;
}

/** One effect's probe result: its names and flattened control rows. */
export interface EffectProbeEffect {
  name?: string | undefined;
  category?: string | undefined;
  controls?: EffectProbeRow[] | undefined;
}

/** Live effect-control evidence collected on this machine; `userAssisted` holds the match names whose add held After Effects on a window while it was scanned. */
export interface EffectProbeEvidence {
  host?: { version?: string | null | undefined } | undefined;
  userAssisted?: string[] | undefined;
  effects: Record<string, EffectProbeEffect>;
}
