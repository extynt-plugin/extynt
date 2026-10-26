// Which files the repo's gates own: every hand-maintained source file, at any depth.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { decodeJson, object, optional, string } from "@extynt/decode";
import { SHELL_SHEBANG } from "./language.ts";

export const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..", "..");

/** Checked-in bytes of a generator in this repo; scripts/check.ts proves the regeneration matches. */
export const GENERATED_FILES: ReadonlySet<string> = new Set(["apps/panel/main.js", "apps/panel/ui-manifest.json"]);
/** The only code the rules do not cover, each entry with its reason: vendored third-party code and external-API stubs. */
export const EXCLUDED_PREFIXES: ReadonlyMap<string, string> = new Map([
  ["native/extynt-core/third_party/", "vendored third-party code (xxhash), not ours to reformat or measure"],
  ["native/extynt-core/tests/syntax-check/stubs/", "test scaffolding that mirrors Cocoa, WebKit and macOS shim APIs we do not own"],
]);
export const SKIP_DIRECTORIES: ReadonlySet<string> = new Set(["dist", "node_modules", ".check-logs", ".git", ".tools"]);
const MAINTAINED_EXTENSIONS = /\.(?:ts|tsx|mjs|jsx)$/;
const NATIVE_EXTENSIONS = /\.(?:cpp|h|m|mm)$/;

export function rel(file: string): string { return relative(ROOT, file).replaceAll("\\", "/"); }

export function statFile(file: string): boolean {
  try { return statSync(file).isFile(); } catch { return false; }
}

function isSkippedPath(key: string): boolean {
  return key.split("/").some((part) => SKIP_DIRECTORIES.has(part));
}

/** Every file git would show: tracked, plus untracked files that are not ignored. */
export function trackedWorktreeFiles(): string[] {
  const result = spawnSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], { cwd: ROOT });
  if (result.status !== 0) throw new Error(result.stderr.toString("utf8"));
  return result.stdout.toString("utf8").split("\0").filter(Boolean).map((file) => resolve(ROOT, file));
}

/** The hand-maintained set the metric and whitespace gates own, root-level files included. */
export function maintainedFiles(): string[] {
  return trackedWorktreeFiles().filter((file) => {
    const key = rel(file);
    return statFile(file)
      && MAINTAINED_EXTENSIONS.test(file)
      && !isSkippedPath(key)
      && !GENERATED_FILES.has(key);
  });
}

export function isExcludedPath(key: string): boolean {
  return [...EXCLUDED_PREFIXES.keys()].some((prefix) => key.startsWith(prefix));
}

function filesMatching(pattern: RegExp, { includeExcluded = false }: { readonly includeExcluded?: boolean } = {}): string[] {
  return trackedWorktreeFiles().filter((file) => {
    const key = rel(file);
    return statFile(file) && pattern.test(file) && !isSkippedPath(key) && (includeExcluded || !isExcludedPath(key));
  });
}

/** Hand-maintained C++ and Objective-C++ under native/. */
export function nativeFiles(): string[] { return filesMatching(NATIVE_EXTENSIONS); }
function hasShellShebang(file: string): boolean {
  return SHELL_SHEBANG.test(readFileSync(file, "utf8").slice(0, 120));
}

/** Hand-maintained shell: every .sh file, and every extensionless file that starts with a shell shebang. */
export function shellFiles(): string[] { return [...filesMatching(/\.sh$/), ...filesMatching(/(?:^|[\\/])[^./\\]+$/).filter(hasShellShebang)]; }
/** Hand-maintained Inno Setup scripts. */
export function innoFiles(): string[] { return filesMatching(/\.iss$/); }
export function powershellFiles(): string[] { return filesMatching(/\.ps1$/); }

const packageName = object({ name: optional(string()) });

/** A workspace package: its root group (apps, packages, tools), absolute directory and repo-relative directory. */
export interface WorkspacePackage {
  readonly root: string;
  readonly directory: string;
  readonly relative: string;
}

function readPackageName(manifest: string): string | undefined {
  const decoded = decodeJson(readFileSync(manifest, "utf8"), packageName);
  if (!decoded.ok) throw new Error(`${manifest}: not a package manifest`);
  return decoded.value.name;
}

function workspacePackages(): Map<string, WorkspacePackage> {
  const packages = new Map<string, WorkspacePackage>();
  for (const rootName of ["apps", "packages", "tools"]) {
    const root = join(ROOT, rootName);
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root)) {
      const directory = join(root, entry);
      const manifest = join(directory, "package.json");
      if (!statFile(manifest)) continue;
      const name = readPackageName(manifest);
      if (name !== undefined) packages.set(name, { root: rootName, directory, relative: rel(directory) });
    }
  }
  return packages;
}

export const WORKSPACE_PACKAGES = workspacePackages();

export function workspaceRoots(): string[] {
  return ["apps", "packages", "tools"].map((name) => join(ROOT, name)).filter(existsSync);
}
