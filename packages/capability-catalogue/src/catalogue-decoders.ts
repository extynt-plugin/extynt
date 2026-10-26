// Decoders for everything the catalogue stores or collects: capabilities, inventories, presets and the host capability profile.
import { boolean, lazy, literal, nullable, number, object, optional, string } from "@extynt/decode";
import type { Decoder } from "@extynt/decode";
import type { LayerType } from "@extynt/project-graph";

import {
  AVAILABILITIES, CACHE_STATUSES, CAPABILITY_KINDS, CATALOGUE_SCHEMA, CONFIDENCES, ENUMERATION_STATES, EVIDENCE_SOURCES, HOST_PROFILE_SCHEMA,
  INVENTORY_COMPLETENESS, NATIVE_FAMILIES, OPERATION_STATUSES, PRESET_ROOTS, PROBE_STATES, PROFILE_ENTRY_KINDS, PROFILE_EVIDENCE_KINDS,
  PROFILE_PHASES, SEMANTIC_CONTROL_ROLES, USER_ASSISTED_REASONS,
} from "./catalogue-model.js";
import type {
  Capability, CatalogueGraph, ControlSchema, Evidence, HostCapabilityProfile, HostInstallation, HostProfileEntry, Inventory, InventoryItem,
  PresetInventory, PresetInventoryItem, UsageProfile, UserAssisted, VersionRange,
} from "./catalogue-model.js";
import { jsonValue, list } from "./decoder-kit.js";
import { storedFontInventory } from "./fonts.js";

const LAYER_TYPES = ["av", "text", "shape", "camera", "light", "null", "adjustment", "unknown"] as const satisfies readonly LayerType[];
const enumerationState = literal(...ENUMERATION_STATES);

const evidence: Decoder<Evidence> = object({
  kind: literal(...CONFIDENCES),
  source: literal(...EVIDENCE_SOURCES),
  reference: optional(string()),
  note: optional(string()),
});

/** Decodes one control of an effect or native family, with its children. */
export const controlSchema: Decoder<ControlSchema> = object({
  path: string(),
  matchName: string(),
  displayName: string(),
  valueType: string(),
  dimensions: optional(number()),
  canSetValue: optional(boolean()),
  role: optional(literal(...SEMANTIC_CONTROL_ROLES)),
  children: optional(list(lazy(() => controlSchema))),
  defaultValue: optional(jsonValue),
  min: optional(number()),
  max: optional(number()),
  units: optional(string()),
  menu: optional(list(string())),
  animatable: optional(literal(false)),
  hidden: optional(literal(true)),
});

const versionRange: Decoder<VersionRange> = object({ minVersion: optional(string()), maxVersion: optional(string()) });
const usageProfile: Decoder<UsageProfile> = object({ summary: string(), evidence: list(evidence) });

const capability: Decoder<Capability> = object({
  id: string(),
  version: string(),
  kind: literal(...CAPABILITY_KINDS),
  matchName: optional(string()),
  displayName: string(),
  provider: string(),
  category: optional(string()),
  nativeFamily: optional(literal(...NATIVE_FAMILIES)),
  layerTypes: optional(list(literal(...LAYER_TYPES))),
  semanticRoles: optional(list(literal(...SEMANTIC_CONTROL_ROLES))),
  description: optional(string()),
  controls: optional(list(controlSchema)),
  requirements: optional(list(string())),
  usageProfiles: optional(list(usageProfile)),
  evidence: list(evidence),
  compatibility: optional(versionRange),
});

/** Decodes the After Effects installation a scan describes. */
export const hostInstallation: Decoder<HostInstallation> = object({
  application: literal("After Effects"),
  version: string(),
  buildNumber: nullable(string()),
  platform: string(),
  architecture: string(),
});

/** Decodes a catalogue graph: the capabilities and, per kind, how far the host lets that kind be enumerated. */
export const catalogueGraph: Decoder<CatalogueGraph> = object({
  schemaVersion: literal(CATALOGUE_SCHEMA),
  catalogueVersion: string(),
  enumeration: object({
    effect: enumerationState,
    preset: enumerationState,
    command: enumerationState,
    importer: enumerationState,
    codec: enumerationState,
    renderer: enumerationState,
    panel: enumerationState,
    script: enumerationState,
    utility: enumerationState,
  }),
  host: optional(hostInstallation),
  capabilities: list(capability),
});

const inventoryItem: Decoder<InventoryItem> = object({
  matchName: string(),
  displayName: string(),
  category: optional(string()),
  version: optional(nullable(string())),
  available: boolean(),
  evidence: list(evidence),
  hasOptionsDialog: optional(boolean()),
});

/** Decodes the effects installed on one host, with the verdict of the scan that produced them. */
export const inventory: Decoder<Inventory> = object({
  schemaVersion: literal(CATALOGUE_SCHEMA),
  host: hostInstallation,
  items: list(inventoryItem),
  truncated: boolean(),
  completeness: literal(...INVENTORY_COMPLETENESS),
  fingerprint: string(),
});

const userAssisted: Decoder<UserAssisted> = object({ reason: literal(...USER_ASSISTED_REASONS), note: string() });

const hostProfileEntry: Decoder<HostProfileEntry> = object({
  id: string(),
  kind: literal(...PROFILE_ENTRY_KINDS),
  matchName: optional(string()),
  displayName: string(),
  description: string(),
  version: optional(nullable(string())),
  category: optional(string()),
  provider: optional(string()),
  availability: literal(...AVAILABILITIES),
  controls: optional(list(controlSchema)),
  applicability: optional(list(literal(...LAYER_TYPES))),
  requirements: optional(list(string())),
  operationStatus: literal(...OPERATION_STATUSES),
  evidence: list(literal(...PROFILE_EVIDENCE_KINDS)),
  provenance: string(),
  probeState: literal(...PROBE_STATES),
  userAssisted: optional(userAssisted),
});

const presetInventoryItem: Decoder<PresetInventoryItem> = object({
  id: string(),
  root: literal(...PRESET_ROOTS),
  name: string(),
  category: string(),
  statFingerprint: string(),
});

/** Decodes the animation presets one scan found on this computer. */
export const presetInventory: Decoder<PresetInventory> = object({
  items: list(presetInventoryItem),
  truncated: boolean(),
  fingerprint: string(),
  scannedAt: string(),
});

const hostProfileFields = {
  schemaVersion: literal(HOST_PROFILE_SCHEMA),
  catalogueVersion: string(),
  host: hostInstallation,
  shallowFingerprint: string(),
  profileId: string(),
  cacheStatus: literal(...CACHE_STATUSES),
  inventoryTruncated: boolean(),
  inventoryCompleteness: optional(literal(...INVENTORY_COMPLETENESS)),
  inventoryTotalReported: optional(number()),
  inventoryReturnedCount: optional(number()),
  presetInventory,
  phase: literal(...PROFILE_PHASES),
  entries: list(hostProfileEntry),
  probeNeeded: list(string()),
  removed: list(string()),
  lastShallowScan: string(),
};

/** Decodes a stored host capability profile. */
export const hostCapabilityProfile: Decoder<HostCapabilityProfile> = object({ ...hostProfileFields, fontInventory: storedFontInventory });

/** Decodes a host capability profile stored before fonts were inventoried: the font inventory may be absent. */
export const legacyHostCapabilityProfile = object({ ...hostProfileFields, fontInventory: optional(storedFontInventory) });
