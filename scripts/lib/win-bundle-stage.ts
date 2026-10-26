// Staging steps of the Windows bundle (scripts/build-win-bundle.ts): each copies one part of the product into the bundle
// directory in the layout packaging/windows/install-parts.ps1 expects. Nothing here follows symlinks into the bundle.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { array, decodeOrThrow, object, string } from "@extynt/decode";
import { sha256Of } from "./win-bundle-node.ts";

/** Scripts the bundle ships, staged under sidecar/scripts/ so their bare imports resolve through sidecar/node_modules. */
export const BUNDLED_SCRIPTS = ["stop-local-sidecar.ts"] as const;
const DECLARATION_OR_MAP = /\.(?:d\.ts|d\.ts\.map|js\.map|tsbuildinfo)$/;
const PACKAGE_NAME = object({ name: string() });
const UI_MANIFEST = object({ files: array(object({ path: string(), sha256: string() })) });

function isShipped(source: string): boolean {
  const name = source.split(/[\\/]/).pop() ?? "";
  if (statSync(source).isDirectory()) return name !== "tests" && name !== ".bin";
  return !DECLARATION_OR_MAP.test(name);
}

function copyBuilt(from: string, to: string): void {
  cpSync(from, to, { recursive: true, dereference: true, filter: isShipped });
}

function workspacePackageDirectories(root: string): string[] {
  return readdirSync(join(root, "packages")).map((name) => join(root, "packages", name))
    .filter((directory) => existsSync(join(directory, "package.json")) && existsSync(join(directory, "dist", "src")));
}

/**
 * sidecar/apps/sidecar/{package.json,dist/src} plus every workspace package under sidecar/node_modules/@extynt/<name>/, so
 * Node's normal lookup finds them without symlinks. The runtime has no third-party dependencies.
 */
export function stageSidecar(root: string, bundle: string): void {
  const sidecar = join(bundle, "sidecar");
  const app = join(sidecar, "apps", "sidecar");
  mkdirSync(app, { recursive: true });
  cpSync(join(root, "apps", "sidecar", "package.json"), join(app, "package.json"));
  copyBuilt(join(root, "apps", "sidecar", "dist", "src"), join(app, "dist", "src"));
  for (const directory of workspacePackageDirectories(root)) {
    const manifest = decodeOrThrow(PACKAGE_NAME, JSON.parse(readFileSync(join(directory, "package.json"), "utf8")));
    const target = join(sidecar, "node_modules", manifest.name);
    mkdirSync(target, { recursive: true });
    cpSync(join(directory, "package.json"), join(target, "package.json"));
    copyBuilt(join(directory, "dist", "src"), join(target, "dist", "src"));
  }
}

/** ui/: exactly the files apps/panel/ui-manifest.json lists (each hash re-checked) plus the manifest itself. */
export function stageServedUi(root: string, bundle: string): number {
  const panel = join(root, "apps", "panel");
  const manifestPath = join(panel, "ui-manifest.json");
  const manifest = decodeOrThrow(UI_MANIFEST, JSON.parse(readFileSync(manifestPath, "utf8")));
  for (const file of manifest.files) {
    const bytes = readFileSync(join(panel, file.path));
    if (sha256Of(bytes) !== file.sha256) throw new Error(`apps/panel/${file.path} does not match ui-manifest.json; run node scripts/build-panel.ts`);
    mkdirSync(dirname(join(bundle, "ui", file.path)), { recursive: true });
    writeFileSync(join(bundle, "ui", file.path), bytes);
  }
  cpSync(manifestPath, join(bundle, "ui", "ui-manifest.json"));
  return manifest.files.length;
}

/** host/: the jsx library with its manifest, written by the same code that serves `node scripts/install-host-library.ts`. */
export function stageHostLibrary(root: string, bundle: string): void {
  const result = spawnSync(process.execPath, [join(root, "scripts", "install-host-library.ts"), "--dest", bundle], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`install-host-library.ts failed: ${result.stderr}`);
  cpSync(join(root, "apps", "panel", "host", "AEQUERY-LICENSE.txt"), join(bundle, "host", "AEQUERY-LICENSE.txt"));
  if (!existsSync(join(bundle, "host", "probe.jsx")) || !existsSync(join(bundle, "host", "manifest.json"))) throw new Error("the host library has no probe.jsx or manifest.json");
}

/** plugin/extyntcore.aex from `aexPath`, which must be a Windows PE file (the MSVC build on a Windows machine). */
export function stagePlugin(aexPath: string, bundle: string): void {
  if (!existsSync(aexPath)) throw new Error(`the plugin ${aexPath} does not exist; build it on Windows with native/extynt-core/build-win.ps1`);
  const bytes = readFileSync(aexPath);
  if (bytes.subarray(0, 2).toString("latin1") !== "MZ") throw new Error(`${aexPath} is not a Windows executable (no MZ header)`);
  mkdirSync(join(bundle, "plugin"), { recursive: true });
  writeFileSync(join(bundle, "plugin", "extyntcore.aex"), bytes);
}

/** installer/ (the PowerShell scripts the installer runs) and sidecar/scripts/ (BUNDLED_SCRIPTS). NOTICE and licenses/ are
 *  staged by stageThirdPartyLicenses() once the Node runtime (whose license is one of them) is in the bundle. */
export function stageInstallerFiles(root: string, bundle: string): void {
  const source = join(root, "packaging", "windows");
  mkdirSync(join(bundle, "installer"), { recursive: true });
  for (const name of readdirSync(source).filter((entry) => entry.endsWith(".ps1"))) cpSync(join(source, name), join(bundle, "installer", name));
  mkdirSync(join(bundle, "sidecar", "scripts"), { recursive: true });
  for (const name of BUNDLED_SCRIPTS) cpSync(join(root, "scripts", name), join(bundle, "sidecar", "scripts", name));
}

/** Removes the staging directory so a build never inherits files from an earlier one. */
export function resetDirectory(directory: string): void {
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
}
