// The strict-compiler ratchet: which projects opted in to tsconfig.strict.json, the strict tsc layer the gate builds, and the clean-but-not-opted-in check.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { array, decodeJson, object, optional, string, union } from "@extynt/decode";
import type { Infer, JsonObject } from "@extynt/decode";
import { LOG_DIR } from "./stage-runner.ts";
import { ROOT } from "./sources.ts";

const STRICT_CONFIG = "tsconfig.strict.json";

const projectReference = object({ path: string() });
const rootConfig = object({ references: array(projectReference) });
const projectConfig = object({ extends: optional(union(string(), array(string()))), references: optional(array(projectReference)) });

type ProjectConfig = Infer<typeof projectConfig>;

/** One project and whether its tsconfig.json extends tsconfig.strict.json. */
export interface ProjectStatus {
  readonly dir: string;
  readonly optedIn: boolean;
}

/** How a strict layer is generated: its directory name under the gate logs and the compiler options it adds. */
export interface LayerOptions {
  readonly layer?: string;
  readonly extraOptions?: JsonObject;
}

function readConfig(file: string): ProjectConfig {
  const decoded = decodeJson(readFileSync(file, "utf8"), projectConfig);
  if (!decoded.ok) throw new Error(`${file}: ${decoded.error.message}`);
  return decoded.value;
}

/** The project directories (repo-relative) the root tsconfig.json references. */
export function projectDirs(): string[] {
  const decoded = decodeJson(readFileSync(join(ROOT, "tsconfig.json"), "utf8"), rootConfig);
  if (!decoded.ok) throw new Error(`tsconfig.json: ${decoded.error.message}`);
  return decoded.value.references.map((reference) => reference.path.replace(/^\.\//, ""));
}

/** True when a tsconfig's extends names tsconfig.strict.json, alone or in a list. */
export function extendsStrict(config: Pick<ProjectConfig, "extends">): boolean {
  const parents = [config.extends ?? []].flat();
  return parents.some((parent) => parent.endsWith(STRICT_CONFIG));
}

/** [{ dir, optedIn }] for every project, from the tsconfig.json beside each one. */
export function projectStatus(dirs: ReadonlyArray<string> = projectDirs()): ProjectStatus[] {
  return dirs.map((dir) => ({ dir, optedIn: extendsStrict(readConfig(join(ROOT, dir, "tsconfig.json"))) }));
}

/** The project directory owning a repo-relative file path, or null. */
export function projectOf(file: string, dirs: ReadonlyArray<string>): string | null {
  return dirs.find((dir) => file.startsWith(`${dir}/`)) ?? null;
}

/** Error counts per project directory for tsc output lines of the form `path(line,col): error TSnnnn`. */
export function errorsByProject(output: string, dirs: ReadonlyArray<string>): Map<string, number> {
  const counts = new Map<string, number>(dirs.map((dir) => [dir, 0]));
  for (const line of output.split(/\r?\n/)) {
    const file = /^(\S[^(]*)\(\d+,\d+\): error TS\d+/.exec(line)?.[1];
    const dir = file ? projectOf(file.replaceAll("\\", "/"), dirs) : null;
    if (dir) counts.set(dir, (counts.get(dir) ?? 0) + 1);
  }
  return counts;
}

/** One violation line for each project that has no strict errors but has not opted in. */
export function ratchetViolations(status: ReadonlyArray<ProjectStatus>, counts: ReadonlyMap<string, number>): string[] {
  return status
    .filter((project) => !project.optedIn && counts.get(project.dir) === 0)
    .map((project) => `${project.dir}: typechecks clean under the strict flags; extend tsconfig.strict.json in its tsconfig.json`);
}

/** The one line naming the projects that opted in and those that have not. */
export function optInLine(status: ReadonlyArray<ProjectStatus>): string {
  const names = (optedIn: boolean): string => status.filter((project) => project.optedIn === optedIn).map((project) => project.dir).join(", ") || "none";
  return `strict opt-in: ${names(true)}; not yet: ${names(false)}`;
}

function layerConfig(dir: string, layerDir: string, extraOptions: JsonObject): JsonObject {
  const original = readConfig(join(ROOT, dir, "tsconfig.json"));
  const here = join(layerDir, dir);
  const references = (original.references ?? []).map((reference) => ({ path: relative(here, join(layerDir, join(dir, reference.path))) }));
  return {
    extends: [relative(here, join(ROOT, dir, "tsconfig.json")), relative(here, join(ROOT, STRICT_CONFIG))],
    compilerOptions: { outDir: "out", tsBuildInfoFile: "out/.tsbuildinfo", composite: true, ...extraOptions },
    references,
  };
}

/**
 * Writes a generated tsconfig for every project plus a root that references them; returns the root path.  The default layer is the
 * strict one; `layer` names another directory under the gate logs and `extraOptions` the compiler options it adds.
 */
export function writeStrictLayer(dirs: ReadonlyArray<string> = projectDirs(), { layer = "strict", extraOptions = {} }: LayerOptions = {}): string {
  const layerDir = join(LOG_DIR, layer);
  for (const dir of dirs) {
    mkdirSync(join(layerDir, dir), { recursive: true });
    writeFileSync(join(layerDir, dir, "tsconfig.json"), JSON.stringify(layerConfig(dir, layerDir, extraOptions), null, 2));
  }
  const root = join(layerDir, "tsconfig.json");
  const references = dirs.map((dir) => ({ path: `./${dir}` }));
  writeFileSync(root, JSON.stringify({ files: [], references }, null, 2));
  return root;
}
