// The effect catalogue window of the Windows bundle: catalogue-window\extynt Catalogue.exe, built with the plugin
// (native/extynt-core/catalogue-window). The installer opens it after install, the way the macOS package opens
// "extynt Catalogue.app" (ADR 0043), so a bundle without it is refused.
import { cpSync, existsSync, mkdirSync, openSync, readSync, closeSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export const CATALOGUE_WINDOW_DIRECTORY = "catalogue-window";
export const CATALOGUE_WINDOW_FILE = "extynt Catalogue.exe";

/** Where build-win.ps1 leaves the window next to the plugin: <build>\ae\<config>\extyntcore.aex -> <build>\catalogue-window\<config>. */
export function defaultCatalogueWindowPath(aexPath: string): string {
  const config = basename(dirname(aexPath));
  return join(dirname(dirname(dirname(aexPath))), CATALOGUE_WINDOW_DIRECTORY, config, CATALOGUE_WINDOW_FILE);
}

function startsWithMz(path: string): boolean {
  const descriptor = openSync(path, "r");
  try {
    const header = Buffer.alloc(2);
    readSync(descriptor, header, 0, 2, 0);
    return header.toString("latin1") === "MZ";
  } finally {
    closeSync(descriptor);
  }
}

/** catalogue-window/extynt Catalogue.exe from `exePath`, which must be a Windows PE file (the MSVC build on a Windows machine). */
export function stageCatalogueWindow(exePath: string, bundle: string): void {
  if (!existsSync(exePath)) throw new Error(`the catalogue window ${exePath} does not exist; build it on Windows with native/extynt-core/build-win.ps1 (or pass --catalogue-window)`);
  if (!startsWithMz(exePath)) throw new Error(`${exePath} is not a Windows executable (no MZ header)`);
  mkdirSync(join(bundle, CATALOGUE_WINDOW_DIRECTORY), { recursive: true });
  cpSync(exePath, join(bundle, CATALOGUE_WINDOW_DIRECTORY, CATALOGUE_WINDOW_FILE));
}
