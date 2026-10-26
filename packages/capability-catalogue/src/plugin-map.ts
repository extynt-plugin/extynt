// Joins the host profile to caller-supplied plugin package registrations. Installation is inventory evidence, never proof that a control or outcome works.
import { literal, object, optional, record, string } from "@extynt/decode";
import type { Decoder } from "@extynt/decode";

import type { ControlSchema, HostCapabilityProfile, HostProfileEntry, ProfileEvidenceKind } from "./catalogue-model.js";
import { controlSchema } from "./catalogue-decoders.js";
import { list } from "./decoder-kit.js";

/** Where a capability comes from. */
export type CapabilityOrigin = "adobe-bundled" | "third-party" | "user" | "unknown";

/** A plugin package the caller registers: the effects it provides and the evidence its controls rest on. */
export interface PluginPackageRegistration {
  id: string;
  provider: string;
  package: string;
  version?: string;
  matchNames: string[];
  licenseRequirement?: string;
  runtimeRequirements?: string[];
  evidence: Array<"documentation" | "host-inventory" | "control-probe" | "receipt" | "visual-review">;
  controls?: Readonly<Record<string, ControlSchema[]>>;
}

/** One profile entry joined to its registration, with its origin, known controls and drift from the registered version. */
export interface MappedHostCapability {
  entryId: string;
  matchName: string | null;
  displayName: string;
  origin: CapabilityOrigin;
  provider: string;
  package: string | null;
  packageVersion: string | null;
  availability: HostProfileEntry["availability"];
  operationStatus: HostProfileEntry["operationStatus"];
  controls: ControlSchema[];
  evidence: ProfileEvidenceKind[];
  capabilitiesKnown: boolean;
  drift: "none" | "version-unregistered" | "version-mismatch" | "controls-unprobed";
  requirements: string[];
}

/** Decodes the plugin package registrations a caller supplies. */
export const pluginPackageRegistrations: Decoder<PluginPackageRegistration[]> = list(object({
  id: string(),
  provider: string(),
  package: string(),
  version: optional(string()),
  matchNames: list(string()),
  licenseRequirement: optional(string()),
  runtimeRequirements: optional(list(string())),
  evidence: list(literal("documentation", "host-inventory", "control-probe", "receipt", "visual-review")),
  controls: optional(record(string(), list(controlSchema))),
}));

function byMatchName(registrations: readonly PluginPackageRegistration[]): Map<string, PluginPackageRegistration> {
  const mapped = new Map<string, PluginPackageRegistration>();
  for (const registration of registrations) for (const matchName of registration.matchNames) {
    if (mapped.has(matchName)) throw new Error(`Plugin matchName ${matchName} is registered by more than one package.`);
    mapped.set(matchName, registration);
  }
  return mapped;
}

function isAdobe(entry: HostProfileEntry): boolean {
  return entry.provider === "Adobe" || entry.id.startsWith("adobe.") || entry.id.startsWith("ae:");
}

function capabilityOrigin(entry: HostProfileEntry, registration: PluginPackageRegistration | undefined): CapabilityOrigin {
  if (isAdobe(entry)) return "adobe-bundled";
  if (registration) return "third-party";
  if (entry.kind === "preset" && entry.provider === "User presets") return "user";
  return "unknown";
}

function capabilityDrift(entry: HostProfileEntry, registration: PluginPackageRegistration | undefined, controls: ControlSchema[]): MappedHostCapability["drift"] {
  if (!registration) return "none";
  if (entry.version && registration.version && entry.version !== registration.version) return "version-mismatch";
  if (entry.version && !registration.version) return "version-unregistered";
  return controls.length === 0 ? "controls-unprobed" : "none";
}

function capabilityRequirements(entry: HostProfileEntry, registration: PluginPackageRegistration | undefined): string[] {
  const license = registration?.licenseRequirement ? [registration.licenseRequirement] : [];
  return [...new Set([...(entry.requirements ?? []), ...(registration?.runtimeRequirements ?? []), ...license])];
}

function controlsAreKnown(entry: HostProfileEntry, registration: PluginPackageRegistration | undefined, controls: ControlSchema[]): boolean {
  if (controls.length === 0) return false;
  return registration ? registration.evidence.includes("control-probe") : entry.evidence.includes("probed");
}

function mappedControls(entry: HostProfileEntry, registration: PluginPackageRegistration | undefined): ControlSchema[] {
  if (registration && entry.matchName) return registration.controls?.[entry.matchName] ?? entry.controls ?? [];
  return entry.controls ?? [];
}

function mappedProvider(entry: HostProfileEntry, registration: PluginPackageRegistration | undefined): string {
  return registration?.provider || entry.provider || "Unknown provider";
}

function mappedPackageVersion(entry: HostProfileEntry, registration: PluginPackageRegistration | undefined): string | null {
  return registration?.version || entry.version || null;
}

function mappedEntry(entry: HostProfileEntry, registration: PluginPackageRegistration | undefined): MappedHostCapability {
  const controls = mappedControls(entry, registration);
  return {
    entryId: entry.id,
    matchName: entry.matchName ?? null,
    displayName: entry.displayName,
    origin: capabilityOrigin(entry, registration),
    provider: mappedProvider(entry, registration),
    package: registration ? registration.package : null,
    packageVersion: mappedPackageVersion(entry, registration),
    availability: entry.availability,
    operationStatus: entry.operationStatus,
    controls,
    evidence: entry.evidence,
    capabilitiesKnown: controlsAreKnown(entry, registration, controls),
    drift: capabilityDrift(entry, registration, controls),
    requirements: capabilityRequirements(entry, registration),
  };
}

/** Every profile entry joined to the registration that names its match name; a match name two registrations claim is an error. */
export function mapHostCapabilities(profile: HostCapabilityProfile, registrations: readonly PluginPackageRegistration[] = []): MappedHostCapability[] {
  const registered = byMatchName(registrations);
  return profile.entries.map((entry) => mappedEntry(entry, entry.matchName ? registered.get(entry.matchName) : undefined));
}

/** How many installed non-Adobe capabilities are registered, have known controls, are quarantined or have an unknown provider. */
export function thirdPartyCapabilitySummary(mapped: readonly MappedHostCapability[]): { installed: number; mapped: number; controlsKnown: number; quarantined: number; unknownProvider: number } {
  const installed = mapped.filter((entry) => entry.origin !== "adobe-bundled" && entry.availability === "available");
  return {
    installed: installed.length,
    mapped: installed.filter((entry) => entry.origin === "third-party").length,
    controlsKnown: installed.filter((entry) => entry.capabilitiesKnown).length,
    quarantined: installed.filter((entry) => entry.operationStatus === "unsupported" || entry.drift !== "none").length,
    unknownProvider: installed.filter((entry) => entry.origin === "unknown").length,
  };
}
