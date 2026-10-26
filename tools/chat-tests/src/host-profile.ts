/**
 * The host capability profile a run is judged against: which profile directory to seed from, how it is copied into an isolated
 * home, and the loud lines that stop a capability-blind run from being mistaken for a bad model.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { platform } from "node:os";
import { join } from "node:path";
import { array, decodeJson, object, string } from "@extynt/decode";
import { lenient } from "./lenient.js";
import { stateDirectory } from "@extynt/host-native";
import { REPO_ROOT } from "./repo-root.js";

const PROFILE_FILE = "host-capability-profile.json";
const PROFILE_FILES = [PROFILE_FILE, "runtime-operation-evidence.json"] as const;

const profileFile = object({ entries: array(object({ kind: lenient(string()), availability: lenient(string()) })) });

function effectEntries(path: string): Array<{ availability?: string | undefined }> {
  try {
    const decoded = decodeJson(readFileSync(path, "utf8"), profileFile);
    return decoded.ok ? decoded.value.entries.filter((entry) => entry.kind === "effect") : [];
  } catch {
    return [];
  }
}

/** The directory the operator's own host profile lives in. */
export function realProfileDirectory(): string {
  return stateDirectory();
}

function fixtureProfileDirectory(): string {
  return join(REPO_ROOT, "tools", "chat-tests", "fixtures", "host-profile");
}

/**
 * Which profile a run seeds from when the caller names none: the operator's own when it is
 * usable, else the committed fixture. "Usable" means at least one effect is `available` — a
 * profile whose scan never completed lists every effect as unavailable and makes a run look
 * like a model that cannot find anything.
 */
export function defaultProfileDirectory(): string {
  const effects = effectEntries(join(realProfileDirectory(), PROFILE_FILE));
  return effects.some((entry) => entry.availability === "available") ? realProfileDirectory() : fixtureProfileDirectory();
}

/**
 * Where a seeded profile lives inside an isolated home: the same relative path
 * `profileDirectory()` resolves under a real home, so a sidecar whose HOME is overridden finds
 * it. Also the state directory a traced sidecar is given, so profile and evidence are read
 * from one place.
 */
export function isolatedProfileDirectory(isolatedHome: string): string {
  if (platform() === "win32") return join(isolatedHome, "AppData", "Local", "extynt");
  return platform() === "darwin" ? join(isolatedHome, "Library", "Application Support", "extynt") : join(isolatedHome, ".config", "extynt");
}

/** Copies the profile files that exist in `source` into the isolated home and returns their names. */
export function seedIsolatedProfile(isolatedHome: string, source = defaultProfileDirectory()): string[] {
  const target = isolatedProfileDirectory(isolatedHome);
  return PROFILE_FILES.filter((file) => copiedInto(source, target, file));
}

function copiedInto(source: string, target: string, file: string): boolean {
  if (!existsSync(join(source, file))) return false;
  try {
    mkdirSync(target, { recursive: true });
    copyFileSync(join(source, file), join(target, file));
    return true;
  } catch {
    return false;
  }
}

/** Which profile files exist to seed, without copying — so the CLI can say so before a run. */
export function availableProfileFiles(source = defaultProfileDirectory()): string[] {
  return PROFILE_FILES.filter((file) => existsSync(join(source, file)));
}

/**
 * A loud line when a run is about to be judged on a host profile that has no effects: a profile whose inventory scan never
 * ran lists every real effect as unavailable, so an agent asked for a Ramp is refused and the run looks like a model that
 * cannot do the work.
 */
export function describeCapabilityHealth(source = defaultProfileDirectory()): string | undefined {
  const path = join(source, PROFILE_FILE);
  const effects = effectEntries(path);
  if (effects.length === 0) return `No host capability profile at ${path}: every ensure_effect will be refused with EFFECT_NOT_INSTALLED. Copy one from a machine that has run the panel against After Effects, or pass --profile.`;
  if (effects.every((entry) => entry.availability !== "available")) return `The host profile at ${path} lists 0 of ${effects.length} effects as available, so every ensure_effect will be refused with EFFECT_NOT_INSTALLED. This is a stale or partial inventory, not a model failure: rebuild it by opening the extynt panel against After Effects, then copy it here or pass --profile.`;
  return undefined;
}

/** One line the CLI prints, because a capability-blind run must never be mistaken for a bad model. */
export function describeSeeding(seeded: string[]): string {
  return seeded.length
    ? `Seeded the host profile: ${seeded.join(", ")} (installed effects and host verification evidence).`
    : "No host capability profile found to seed: every effect will report unavailable. Run the panel once on a real host to build one, or pass --profile.";
}
