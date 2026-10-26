#!/usr/bin/env node
// Installs the host jsx library where the native plugin looks for it: <stateDir>/host/*.jsx plus manifest.json.
// Usage: node scripts/install-host-library.ts [--dest <stateDir>]
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decode, object, string } from "@extynt/decode";

const SCHEMA = "extynt-host-library/1";
const ENTRY = "probe.jsx";
const VERSION_PATTERN = /^[0-9A-Za-z._+-]{1,64}$/;
const BASE_VERSION_LIMIT = 64 - 13;
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The sorted names of the .jsx files directly inside `source`; nothing else is part of the library. */
export function hostFileNames(source: string): string[] {
  return readdirSync(source).filter((name) => name.endsWith(".jsx") && statSync(join(source, name)).isFile()).sort();
}

/** The package version made safe for the manifest, or a thrown error when nothing usable is left. */
export function sanitiseVersion(packageVersion: string): string {
  const base = packageVersion.replace(/[^0-9A-Za-z._+-]/g, "-").slice(0, BASE_VERSION_LIMIT);
  if (!VERSION_PATTERN.test(base)) throw new Error(`Package version ${JSON.stringify(packageVersion)} cannot form a library version.`);
  return base;
}

function libraryVersion(source: string, names: readonly string[], packageVersion: string): string {
  const hash = createHash("sha256");
  for (const name of names) hash.update(readFileSync(join(source, name)));
  const version = `${sanitiseVersion(packageVersion)}+${hash.digest("hex").slice(0, 12)}`;
  if (!VERSION_PATTERN.test(version)) throw new Error(`Library version ${version} is not valid.`);
  return version;
}

function writeAtomically(path: string, bytes: Buffer | string): void {
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, bytes);
  renameSync(temporary, path);
}

function sameBytes(path: string, bytes: Buffer): boolean {
  try { return readFileSync(path).equals(bytes); } catch { return false; }
}

function copyLibraryFiles(source: string, directory: string, names: readonly string[]): void {
  for (const name of names) {
    const bytes = readFileSync(join(source, name));
    if (!sameBytes(join(directory, name), bytes)) writeAtomically(join(directory, name), bytes);
  }
}

function copyPuppetPresets(source: string, directory: string): string[] {
  const from = join(source, "puppet");
  if (!existsSync(from)) return [];
  const names = readdirSync(from).filter((name) => /^puppet-grid-[0-9a-z]+(-ae[0-9]+)?-1080\.ffx$/.test(name) && statSync(join(from, name)).isFile()).sort();
  if (names.length === 0) return names;
  mkdirSync(join(directory, "puppet"), { recursive: true });
  for (const name of names) {
    const bytes = readFileSync(join(from, name));
    if (!sameBytes(join(directory, "puppet", name), bytes)) writeAtomically(join(directory, "puppet", name), bytes);
  }
  return names;
}

function removeStaleFiles(directory: string, names: readonly string[]): void {
  for (const name of readdirSync(directory)) if (name.endsWith(".jsx") && !names.includes(name)) rmSync(join(directory, name), { force: true });
}

/** Where to read the host library from, which state directory to install into, and the package version to derive the library version from. */
export interface InstallRequest {
  readonly source: string;
  readonly destination: string;
  readonly packageVersion: string;
}

/** The installed host directory, its manifest version and the .jsx files it holds. */
export interface InstallResult {
  readonly directory: string;
  readonly version: string;
  readonly files: readonly string[];
}

/**
 * Copies `source/*.jsx` into `<destination>/host/` (destination is the state directory), removes .jsx files the source no
 * longer has, and writes `host/manifest.json` last. The same sources always give the same manifest.
 */
export function installHostLibrary({ source, destination, packageVersion }: InstallRequest): InstallResult {
  const names = hostFileNames(source);
  if (!names.includes(ENTRY)) throw new Error(`${source} has no ${ENTRY}.`);
  const version = libraryVersion(source, names, packageVersion);
  const directory = join(destination, "host");
  mkdirSync(directory, { recursive: true });
  copyLibraryFiles(source, directory, names);
  copyPuppetPresets(source, directory);
  removeStaleFiles(directory, names);
  writeAtomically(join(directory, "manifest.json"), `${JSON.stringify({ schema: SCHEMA, version, entry: ENTRY })}\n`);
  return { directory, version, files: names };
}

/** The state directory the plugin and sidecar share, honouring $HOME. */
export function defaultStateDirectory(env: NodeJS.ProcessEnv = process.env, os: NodeJS.Platform = platform()): string {
  const home = env.HOME || homedir();
  if (os === "win32") return join(env.LOCALAPPDATA || join(home, "AppData", "Local"), "extynt");
  return os === "darwin" ? join(home, "Library", "Application Support", "extynt") : join(home, ".config", "extynt");
}

/** The user's Trash folder on macOS and Linux; null on Windows, where the Recycle Bin has no folder to move into. */
export function defaultTrashDirectory(): string | null {
  if (platform() === "darwin") return join(homedir(), ".Trash");
  if (platform() === "win32") return null;
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "Trash", "files");
}

function isCrossDeviceError(error: Error): boolean {
  return "code" in error && error.code === "EXDEV";
}

function moveIntoDirectory(path: string, trashDirectory: string): void {
  mkdirSync(trashDirectory, { recursive: true });
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  let target = join(trashDirectory, basename(path));
  for (let attempt = 1; existsSync(target); attempt += 1) target = join(trashDirectory, `${basename(path)}.${stamp}${attempt > 1 ? `.${attempt}` : ""}`);
  try { renameSync(path, target); } catch (error) {
    if (!(error instanceof Error) || !isCrossDeviceError(error)) throw error;
    cpSync(path, target, { recursive: true });
    rmSync(path, { recursive: true, force: true });
  }
}

function moveToRecycleBin(path: string): void {
  const script = "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($args[0], 'OnlyErrorDialogs', 'SendToRecycleBin')";
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script, path], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`Could not move ${path} to the Recycle Bin: ${result.stderr || result.error?.message || "unknown error"}`);
}

/**
 * Moves the state directory to the Trash when its on-disk name is the old capitalised one and returns its path, else
 * null. Nothing is hard-deleted. A path test cannot tell: the volume is usually case-insensitive, so the lowercase path
 * exists for a folder named Extynt too. The lowercase directory holds the user's chats and settings and is never touched.
 */
export function removeCapitalisedStateDirectory(destination: string, trashDirectory: string | null = defaultTrashDirectory()): string | null {
  if (basename(destination) !== "extynt") return null;
  const parent = dirname(destination);
  const names = existsSync(parent) ? readdirSync(parent) : [];
  if (!names.includes("Extynt")) return null;
  const old = join(parent, "Extynt");
  if (trashDirectory) moveIntoDirectory(old, trashDirectory); else moveToRecycleBin(old);
  return old;
}

function parseArguments(args: readonly string[]): { destination: string | null } {
  if (args.length === 0) return { destination: null };
  if (args.length === 2 && args[0] === "--dest" && args[1]) return { destination: resolve(args[1]) };
  throw new Error("Usage: node scripts/install-host-library.ts [--dest <stateDir>]");
}

const versionedManifest = object({ version: string() });

function versionOfManifest(manifestText: string): string {
  const manifest = decode(versionedManifest, JSON.parse(manifestText));
  if (manifest.ok) return manifest.value.version;
  throw new Error("package.json has no version string.");
}

function main(args: readonly string[]): void {
  const { destination } = parseArguments(args);
  const removed = removeCapitalisedStateDirectory(destination ?? defaultStateDirectory());
  if (removed) console.log(`Moved old install to the Trash: ${removed}`);
  const packageVersion = versionOfManifest(readFileSync(join(REPOSITORY_ROOT, "package.json"), "utf8"));
  const result = installHostLibrary({ source: join(REPOSITORY_ROOT, "apps", "panel", "host"), destination: destination ?? defaultStateDirectory(), packageVersion });
  console.log(`Installed ${result.files.length} host files to ${result.directory} (version ${result.version})`);
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
