/** Persists what the sidecar learns about this machine: the host capability profile, the effect control probe evidence it can load, and the runtime operation evidence receipts accumulate. */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodeJson, type Decoder } from "@extynt/decode";
import { stateDirectory } from "@extynt/host-native";
import { emptyFontInventory, materializePresetEntries, withFontsLoading, type EffectProbeEvidence, type HostCapabilityProfile } from "@extynt/capability-catalogue";
import { effectProbeEvidence, legacyHostProfile, runtimeEvidence, type RuntimeEvidenceFile } from "./profile-decoders.js";

export { resolvePresetPath, scanPresetInventory } from "./preset-scan.js";
export type { RuntimeEvidenceFile } from "./profile-decoders.js";

const PROFILE_FILE = "host-capability-profile.json";
const RUNTIME_EVIDENCE_FILE = "runtime-operation-evidence.json";
let evidenceCache: { path: string; mtimeMs: number; value: EffectProbeEvidence } | undefined;

const compareText = (a: string, b: string): number => (a === b ? 0 : a < b ? -1 : 1);

function readDecoded<T>(path: string, decoder: Decoder<T>): T | undefined {
  try {
    const decoded = decodeJson(readFileSync(path, "utf8"), decoder);
    return decoded.ok ? decoded.value : undefined;
  } catch {
    return undefined;
  }
}

function writeAtomically(target: string, text: string): void {
  const temp = `${target}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, text, { mode: 0o600 });
    renameSync(temp, target);
  } finally {
    if (existsSync(temp)) rmSync(temp, { force: true });
  }
}

/** macOS Application Support; Windows %LOCALAPPDATA%\extynt (bearer tokens and the WebView2 profile must not roam); ~/.config/extynt elsewhere. */
export function profileDirectory(): string {
  return stateDirectory();
}

function withPresetEntries(profile: HostCapabilityProfile): HostCapabilityProfile {
  const presetIds = new Set(profile.entries.filter((entry) => entry.kind === "preset").map((entry) => entry.id));
  if (!profile.presetInventory.items.some((preset) => !presetIds.has(`preset:${preset.root}:${preset.id}`))) return profile;
  const entries = profile.entries.filter((entry) => entry.kind !== "preset").concat(materializePresetEntries(profile.presetInventory))
    .sort((a, b) => compareText(a.displayName, b.displayName) || compareText(a.matchName ?? "", b.matchName ?? ""));
  const presetProbeIds = entries.filter((entry) => entry.kind === "preset" && entry.operationStatus === "probeNeeded").map((entry) => entry.id);
  return { ...profile, entries, probeNeeded: Array.from(new Set(profile.probeNeeded.concat(presetProbeIds))), cacheStatus: "fresh" };
}

/** Reads the stored profile back, rebuilding preset entries the scan found but the file lacks; an unreadable, malformed or other-host profile reads as absent. */
export function loadHostProfile(root = profileDirectory(), expectedHost?: HostCapabilityProfile["host"]): HostCapabilityProfile | undefined {
  const stored = readDecoded(join(root, PROFILE_FILE), legacyHostProfile);
  if (!stored || (expectedHost && JSON.stringify(stored.host) !== JSON.stringify(expectedHost))) return undefined;
  try {
    return withPresetEntries({ ...stored, fontInventory: stored.fontInventory ?? emptyFontInventory() });
  } catch {
    return undefined;
  }
}

const storable = (profile: HostCapabilityProfile): HostCapabilityProfile => (profile.fontInventory.loading ? { ...profile, fontInventory: withFontsLoading(profile.fontInventory, false) } : profile);

/** Writes the profile atomically with owner-only permissions; the fonts "loading" marker is a fact about this process, so it is never written. */
export function saveHostProfile(profile: HostCapabilityProfile, root = profileDirectory()): void {
  mkdirSync(root, { recursive: true });
  writeAtomically(join(root, PROFILE_FILE), JSON.stringify(storable(profile)));
}

function effectControlEvidencePath(): string {
  return process.env.EXTYNT_EFFECT_CONTROLS ?? "";
}

function cachedEvidence(path: string): EffectProbeEvidence | undefined {
  const { mtimeMs } = statSync(path);
  if (evidenceCache?.path === path && evidenceCache.mtimeMs === mtimeMs) return evidenceCache.value;
  const value = readDecoded(path, effectProbeEvidence);
  if (value) evidenceCache = { path, mtimeMs, value };
  return value;
}

/** Loads the effect control probe evidence (cached per file modification time); a missing or unreadable file means no evidence. */
export function loadEffectControlEvidence(path = effectControlEvidencePath()): EffectProbeEvidence | undefined {
  try {
    return path ? cachedEvidence(path) : undefined;
  } catch {
    return undefined;
  }
}

/** Loads the runtime operation evidence; a first run or an unreadable file reads as empty. */
export function loadRuntimeEvidence(root = profileDirectory()): RuntimeEvidenceFile {
  return readDecoded(join(root, RUNTIME_EVIDENCE_FILE), runtimeEvidence) ?? { schemaVersion: "0.1", hosts: {} };
}

/** Saves the runtime operation evidence; a read-only home must not fail a receipt, so a failed write is dropped. */
export function saveRuntimeEvidence(evidence: RuntimeEvidenceFile, root = profileDirectory()): void {
  try {
    mkdirSync(root, { recursive: true });
    writeAtomically(join(root, RUNTIME_EVIDENCE_FILE), JSON.stringify(evidence));
  } catch {
    return;
  }
}
