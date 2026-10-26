#!/usr/bin/env node
// Assembles the Windows x64 bundle that packaging/windows/extynt.iss turns into extynt-<version>-setup.exe.
// Runs on Linux, macOS or Windows (Node only); the plugin must already be built on Windows with MSVC.
//
//   node scripts/build-win-bundle.ts <path to extyntcore.aex> [--out <dir>] [--catalogue-window <exe>] [--no-build]
//
// The effect catalogue window ("extynt Catalogue.exe", built with the plugin) is staged as catalogue-window\ and is required;
// by default it is read from where build-win.ps1 leaves it next to the plugin.
//
// The sidecar is rebuilt from scratch. --no-build stages what is in dist/. This entry imports no workspace package until the
// rebuild has run (scripts/lib/win-bundle-build.ts stages), so it also works in a checkout whose packages are not built yet.
// Environment: EXTYNT_MAX_BUNDLE_MB (default 150) is the size ceiling; XDG_CACHE_HOME moves the Node download cache.
import { spawnSync } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultCatalogueWindowPath } from "./lib/win-bundle-catalogue-window.ts";
import { fileVersionOf } from "./lib/win-bundle-version.ts";

export { fileVersionOf };

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const PATH_OPTIONS = { "--catalogue-window": "catalogueWindow", "--out": "out" } as const;

interface BundleOptions {
  aex: string;
  out: string;
  build: boolean;
  catalogueWindow: string;
}

function isPathOption(argument: string): argument is keyof typeof PATH_OPTIONS {
  return Object.hasOwn(PATH_OPTIONS, argument);
}

function readArgument(options: BundleOptions, args: readonly string[], index: number): number {
  const argument = args[index] ?? "";
  if (argument === "--no-build") {
    options.build = false;
    return index + 1;
  }
  if (isPathOption(argument)) {
    options[PATH_OPTIONS[argument]] = resolve(args[index + 1] ?? "");
    return index + 2;
  }
  if (argument.startsWith("-") || options.aex) throw new Error(`unexpected argument ${argument}`);
  options.aex = resolve(argument);
  return index + 1;
}

function parseArguments(args: readonly string[]): BundleOptions {
  const options: BundleOptions = { aex: "", out: join(ROOT, "artifacts", "win-bundle"), build: true, catalogueWindow: "" };
  for (let index = 0; index < args.length;) index = readArgument(options, args, index);
  if (!options.aex) throw new Error("usage: node scripts/build-win-bundle.ts <path to extyntcore.aex> [--out <dir>] [--catalogue-window <exe>] [--no-build]");
  options.catalogueWindow ||= defaultCatalogueWindowPath(options.aex);
  return options;
}

function run(command: string, args: readonly string[], env: NodeJS.ProcessEnv): void {
  const result = spawnSync(command, args, { cwd: ROOT, env, stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed`);
}

function rebuildRelease(): void {
  const env = { ...process.env };
  for (const group of ["apps", "packages", "tools"]) {
    for (const name of readdirSync(join(ROOT, group))) rmSync(join(ROOT, group, name, "dist"), { recursive: true, force: true });
  }
  run("pnpm", ["-w", "exec", "tsc", "-b"], env);
  run(process.execPath, ["scripts/build-panel.ts"], env);
}

async function main(args: readonly string[]): Promise<void> {
  const options = parseArguments(args);
  if (options.build) rebuildRelease();
  const { stageBundle } = await import("./lib/win-bundle-build.ts");
  await stageBundle(options);
}

async function enter(args: readonly string[]): Promise<void> {
  try {
    await main(args);
  } catch (error) {
    console.error(`build-win-bundle: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) await enter(process.argv.slice(2));
