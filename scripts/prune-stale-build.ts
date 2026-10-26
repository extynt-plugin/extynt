#!/usr/bin/env node
/**
 * Removes compiled output that has no source: a renamed or deleted file under `tests/` or `src/` leaves its dist twin
 * behind, and the test glob would keep running it.  Runs after `tsc -b` in the build and before every full test run,
 * so a merge that renames a test never needs a manual `rm -rf dist`.
 */
import { existsSync, globSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_SUFFIX = /\.(d\.ts\.map|d\.ts|js\.map|js)$/;

function listFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

function hasSource(packageDir: string, subdir: string, relativeOutput: string): boolean {
  const base = relativeOutput.replace(OUTPUT_SUFFIX, "");
  return [".ts", ".tsx", ".mts"].some((extension) => existsSync(join(packageDir, subdir, base + extension)));
}

function isDirectory(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

function staleFiles(packageDir: string, subdir: string): string[] {
  const outputDir = join(packageDir, "dist", subdir);
  if (!isDirectory(outputDir)) return [];
  return listFiles(outputDir).filter((file) => {
    const relativeOutput = relative(outputDir, file).replaceAll("\\", "/");
    return OUTPUT_SUFFIX.test(relativeOutput) && !hasSource(packageDir, subdir, relativeOutput);
  });
}

/** Deletes compiled files under `<package>/dist/{src,tests}` whose TypeScript source is gone; returns the removed paths. */
export function pruneStaleBuild(root: string = ROOT): string[] {
  const packageDirs = globSync("{packages,apps,tools}/*/tsconfig.json", { cwd: root }).map((file) => join(root, dirname(file)));
  const stale = packageDirs.flatMap((packageDir) => ["src", "tests"].flatMap((subdir) => staleFiles(packageDir, subdir)));
  for (const file of stale) rmSync(file);
  return stale.map((file) => relative(root, file));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const removed = pruneStaleBuild();
  if (removed.length) console.log(`Removed ${removed.length} compiled file(s) with no source.`);
}
