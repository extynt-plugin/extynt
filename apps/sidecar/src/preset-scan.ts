/** Finds After Effects preset files on disk: a bounded scan that fingerprints them, and the lookup from a scanned id back to its path. */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, statSync, type Dirent } from "node:fs";
import { homedir, platform } from "node:os";
import { basename, extname, join, relative, resolve } from "node:path";
import { makePresetInventory, type PresetInventory, type PresetInventoryItem } from "@extynt/capability-catalogue";

type PresetRoot = { path: string; alias: "ae-presets" | "user-presets" };
type ScanState = { base: string; alias: PresetRoot["alias"]; maxEntries: number; maxDepth: number; items: PresetInventoryItem[]; seen: Set<string>; truncated: boolean };
type PresetSearch = { base: string; dir: string; alias: string; id: string; depth: number };

const MAX_SEARCH_DEPTH = 12;
const HIDDEN_FOLDER = /^\(.*\)$/;

const digest = (text: string, length: number): string => createHash("sha256").update(text).digest("hex").slice(0, length);
const posixRelative = (base: string, path: string): string => relative(base, path).split("\\").join("/");

function readFolder(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function adobeDocumentRoots(home: string): PresetRoot[] {
  return readFolder(join(home, "Documents", "Adobe"))
    .filter((entry) => entry.isDirectory() && /^After Effects /.test(entry.name))
    .map((entry): PresetRoot => ({ path: join(home, "Documents", "Adobe", entry.name, "User Presets"), alias: "user-presets" }));
}

function applicationRoots(): PresetRoot[] {
  return readFolder("/Applications")
    .filter((entry) => entry.isDirectory() && /^Adobe After Effects/.test(entry.name))
    .map((entry): PresetRoot => ({ path: join("/Applications", entry.name, "Presets"), alias: "ae-presets" }));
}

function defaultPresetRoots(): PresetRoot[] {
  if (platform() !== "darwin") return [];
  const home = homedir();
  return [{ path: join(home, "Documents", "Adobe", "After Effects", "User Presets"), alias: "user-presets" }, ...adobeDocumentRoots(home), ...applicationRoots()];
}

const isPresetFile = (entry: Dirent): boolean => entry.isFile() && extname(entry.name).toLowerCase() === ".ffx";
const ignoredFolder = (entry: Dirent): boolean => entry.isSymbolicLink() || (entry.isDirectory() && HIDDEN_FOLDER.test(entry.name));

function addPresetFile(state: ScanState, path: string): void {
  try {
    const stat = statSync(path), rel = posixRelative(state.base, path), key = `${state.alias}:${rel}`;
    if (state.seen.has(key)) return;
    state.seen.add(key);
    const segments = rel.split("/").filter((segment) => segment && !HIDDEN_FOLDER.test(segment));
    const category = segments.length > 1 ? segments[0] : undefined;
    state.items.push({ id: digest(key, 20), root: state.alias, name: basename(path, ".ffx"), category: category ?? "Uncategorized", statFingerprint: digest(`${key}:${stat.size}:${stat.mtimeMs}`, 16) });
  } catch {
    return;
  }
}

function visitPresetEntry(state: ScanState, entry: Dirent, dir: string, depth: number): void {
  const path = join(dir, entry.name);
  if (ignoredFolder(entry) || !resolve(path).startsWith(state.base)) return;
  if (entry.isDirectory()) scanPresetDirectory(state, path, depth + 1);
  else if (isPresetFile(entry)) addPresetFile(state, path);
}

function scanPresetDirectory(state: ScanState, dir: string, depth: number): void {
  if (depth > state.maxDepth || state.truncated) return;
  for (const entry of readFolder(dir)) {
    if (state.items.length >= state.maxEntries) {
      state.truncated = true;
      return;
    }
    visitPresetEntry(state, entry, dir, depth);
  }
}

/** Walks the preset folders (symlinks and parenthesised folders skipped, depth and count bounded) and fingerprints every .ffx file. */
export function scanPresetInventory(roots = defaultPresetRoots(), maxEntries = 2_000, maxDepth = 12): PresetInventory {
  const state: ScanState = { base: "", alias: "ae-presets", maxEntries, maxDepth, items: [], seen: new Set(), truncated: false };
  for (const root of roots) {
    const base = resolve(root.path);
    if (!existsSync(base)) continue;
    state.base = base;
    state.alias = root.alias;
    scanPresetDirectory(state, base, 0);
  }
  return makePresetInventory(state.items, state.truncated);
}

function matchingPreset(search: PresetSearch, entry: Dirent, path: string): string | undefined {
  return isPresetFile(entry) && digest(`${search.alias}:${posixRelative(search.base, path)}`, 20) === search.id ? path : undefined;
}

function findPreset(search: PresetSearch): string | undefined {
  if (search.depth > MAX_SEARCH_DEPTH) return undefined;
  for (const entry of readFolder(search.dir)) {
    const path = join(search.dir, entry.name);
    const hidden = ignoredFolder(entry);
    const found = entry.isDirectory() ? (hidden ? undefined : findPreset({ ...search, dir: path, depth: search.depth + 1 })) : matchingPreset(search, entry, path);
    if (found) return found;
  }
  return undefined;
}

function searchRoot(root: PresetRoot, id: string): string | undefined {
  const base = resolve(root.path);
  return existsSync(base) ? findPreset({ base, dir: base, alias: root.alias, id, depth: 0 }) : undefined;
}

/** Absolute path for a scanned preset id; never returned to agents. */
export function resolvePresetPath(presetEntryId: string, roots = defaultPresetRoots()): string | undefined {
  const match = /^preset:(ae-presets|user-presets):([0-9a-f]{20})$/.exec(presetEntryId);
  const [, alias = "", id = ""] = match ?? [];
  for (const root of match ? roots.filter((candidate) => candidate.alias === alias) : []) {
    const found = searchRoot(root, id);
    if (found) return found;
  }
  return undefined;
}
