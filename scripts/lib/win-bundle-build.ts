// The staging half of scripts/build-win-bundle.ts: runs after the workspace packages are built, so it may import them.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { decodeOrThrow, object, string } from "@extynt/decode";
import { ROOT } from "./sources.ts";
import { stageThirdPartyLicenses } from "./third-party-licenses.ts";
import { stageNodeRuntime } from "./win-bundle-node.ts";
import { resetDirectory, stageHostLibrary, stageInstallerFiles, stagePlugin, stageServedUi, stageSidecar } from "./win-bundle-stage.ts";
import { stageCatalogueWindow } from "./win-bundle-catalogue-window.ts";
import { fileVersionOf } from "./win-bundle-version.ts";

const DEFAULT_MAX_MB = 150;
const PACKAGE_VERSION = object({ version: string() });

export interface StageOptions {
  readonly aex: string;
  readonly out: string;
  readonly catalogueWindow: string;
}

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

function writeChecksums(bundle: string): void {
  const lines = filesUnder(bundle).filter((file) => !file.endsWith("SHA256SUMS")).map((file) => {
    const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
    return `${digest}  ${relative(bundle, file).replaceAll("\\", "/")}`;
  }).sort((left, right) => left.slice(66).localeCompare(right.slice(66)));
  writeFileSync(join(bundle, "SHA256SUMS"), `${lines.join("\n")}\n`);
}

function assertSize(bundle: string, env: NodeJS.ProcessEnv): number {
  const megabytes = filesUnder(bundle).reduce((sum, file) => sum + statSync(file).size, 0) / 1048576;
  const ceiling = Number(env.EXTYNT_MAX_BUNDLE_MB ?? DEFAULT_MAX_MB);
  if (megabytes > ceiling) throw new Error(`bundle is ${megabytes.toFixed(0)} MB, over the ${ceiling} MB ceiling (raise EXTYNT_MAX_BUNDLE_MB deliberately)`);
  return megabytes;
}

export async function stageBundle(options: StageOptions): Promise<void> {
  const { version } = decodeOrThrow(PACKAGE_VERSION, JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")));
  const bundle = join(options.out, `extynt-${version}-win-x64`);
  resetDirectory(bundle);
  stageSidecar(ROOT, bundle);
  const uiFiles = stageServedUi(ROOT, bundle);
  stageHostLibrary(ROOT, bundle);
  stagePlugin(options.aex, bundle);
  stageCatalogueWindow(options.catalogueWindow, bundle);
  stageInstallerFiles(ROOT, bundle);
  const node = await stageNodeRuntime(ROOT, bundle, process.env);
  stageThirdPartyLicenses(ROOT, bundle, join(bundle, "runtime", "LICENSE"));
  writeFileSync(join(bundle, "VERSION"), `${version}\n`);
  writeFileSync(join(bundle, "FILE_VERSION"), `${fileVersionOf(version)}\n`);
  const megabytes = assertSize(bundle, process.env);
  writeChecksums(bundle);
  console.log(`Bundle ${bundle}: ${megabytes.toFixed(0)} MB, Node ${node.version}, ${uiFiles} UI files.`);
  console.log(`Next, on Windows with Inno Setup 6.3+: iscc /DBundleDir="${bundle}" packaging\\windows\\extynt.iss`);
}
