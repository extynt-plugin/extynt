// Resolves import specifiers to source files of this repository, mapping built dist output back to its TypeScript source.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { decodeJson, isJsonArray, isJsonObject, jsonValue, object, optional } from "@extynt/decode";
import type { Infer, JsonValue } from "@extynt/decode";

const manifestShape = object({ exports: optional(jsonValue), main: optional(jsonValue), module: optional(jsonValue), types: optional(jsonValue) });

/** The manifest fields entry resolution reads. */
export type Manifest = Infer<typeof manifestShape>;

/** A workspace package as the resolver sees it: its directory and entry paths by subpath. */
export interface PackageEntry {
  readonly directory: string;
  readonly entries: ReadonlyMap<string, ReadonlyArray<string>>;
}

/** Workspace packages by name. */
export type PackageTable = ReadonlyMap<string, PackageEntry>;

const SOURCE_EXTENSIONS: ReadonlyArray<string> = [".ts", ".tsx", ".mjs", ".jsx"];
const EXTENSION_SWAPS: ReadonlyMap<string, ReadonlyArray<string>> = new Map([[".js", [".ts", ".tsx"]], [".jsx", [".tsx"]]]);

function withoutDist(path: string): string | null {
  return path.includes("/dist/") ? path.replace("/dist/", "/") : null;
}

function candidates(path: string): string[] {
  const extension = path.slice(path.lastIndexOf("."));
  const swaps = EXTENSION_SWAPS.get(extension);
  const stem = path.slice(0, path.length - extension.length);
  const swapped = swaps ? swaps.map((swap) => stem + swap) : [];
  const appended = SOURCE_EXTENSIONS.map((suffix) => path + suffix);
  const indexes = SOURCE_EXTENSIONS.map((suffix) => join(path, `index${suffix}`));
  return [path, ...swapped, ...appended, ...indexes];
}

/** The first known source file for an absolute path, trying extension swaps, index files and the dist-to-source mapping. */
export function resolveFile(path: string, knownFiles: ReadonlySet<string>): string | null {
  const unbuilt = withoutDist(path);
  const options = [...candidates(path), ...(unbuilt ? candidates(unbuilt) : [])];
  return options.find((option) => knownFiles.has(option)) ?? null;
}

function exportTargets(value: JsonValue | undefined): string[] {
  if (typeof value === "string") return [value];
  if (isJsonArray(value)) return value.flatMap(exportTargets);
  return isJsonObject(value) ? Object.values(value).flatMap(exportTargets) : [];
}

function subpathEntries(exportsField: JsonValue | undefined): Array<[string, JsonValue]> | null {
  if (!isJsonObject(exportsField)) return null;
  const pairs = Object.entries(exportsField);
  return pairs.every(([key]) => key.startsWith(".")) ? pairs : null;
}

/** Package entry paths declared by `exports`, `main`, `module` and `types`, keyed by subpath ("." for the root). */
export function entryPoints(manifest: Manifest): Map<string, string[]> {
  const entries = new Map<string, string[]>();
  const exportsField = manifest.exports;
  const subpaths = subpathEntries(exportsField);
  if (subpaths) for (const [key, value] of subpaths) entries.set(key, exportTargets(value));
  else if (exportsField) entries.set(".", exportTargets(exportsField));
  const legacy = [manifest.main, manifest.module, manifest.types].filter((entry) => typeof entry === "string");
  if (legacy.length && !entries.has(".")) entries.set(".", legacy);
  return entries;
}

/** Loads a workspace package manifest, or null when the directory has none. */
export function readManifest(directory: string): Manifest | null {
  const file = join(directory, "package.json");
  if (!existsSync(file)) return null;
  const decoded = decodeJson(readFileSync(file, "utf8"), manifestShape);
  if (!decoded.ok) throw new Error(`${file}: not a package manifest`);
  return decoded.value;
}

/** The package name at the front of a bare specifier: `@scope/name` or the first path segment. */
export function packageNameOf(specifier: string): string {
  return specifier.split("/").slice(0, specifier.startsWith("@") ? 2 : 1).join("/");
}

function resolvePackageSpecifier(specifier: string, packages: PackageTable, knownFiles: ReadonlySet<string>): string | null {
  const name = packageNameOf(specifier);
  const info = packages.get(name);
  if (!info) return null;
  const subpath = specifier === name ? "." : `.${specifier.slice(name.length)}`;
  const targets = info.entries.get(subpath) ?? [subpath === "." ? "./src/index.ts" : `./src/${subpath.slice(2)}`];
  for (const target of targets) {
    const file = resolveFile(resolve(info.directory, target), knownFiles);
    if (file) return file;
  }
  return null;
}

/** What to resolve: a specifier written in `importer`, against the workspace packages and the known source files. */
export interface SpecifierRequest {
  readonly specifier: string;
  readonly importer: string;
  readonly packages: PackageTable;
  readonly knownFiles: ReadonlySet<string>;
}

/** Resolves a specifier written in `importer` to a known source file, or null for external packages and unknown paths. */
export function resolveSpecifier({ specifier, importer, packages, knownFiles }: SpecifierRequest): string | null {
  if (specifier.startsWith(".")) return resolveFile(resolve(dirname(importer), specifier), knownFiles);
  return resolvePackageSpecifier(specifier, packages, knownFiles);
}
