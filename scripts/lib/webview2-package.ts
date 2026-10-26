// The pinned Microsoft.Web.WebView2 NuGet package, fetched into .tools/webview2 for the Windows syntax check only.
// The headers are read in place and never committed; the Windows build downloads the same package (build-win.ps1).
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { ROOT } from "./sources.ts";
import { VENV_BIN, runTool } from "./tools.ts";

export const WEBVIEW2_VERSION = "1.0.3485.44";
export const WEBVIEW2_SHA256 = "bc09150b179246ac90189649b13be8e6b11b3ac200e817e18df106e1f3cf489e";
export const WEBVIEW2_DIRECTORY = join(ROOT, ".tools", "webview2");
export const WEBVIEW2_INCLUDE = join(WEBVIEW2_DIRECTORY, "build", "native", "include");

export function webview2Present(): boolean {
  return existsSync(join(WEBVIEW2_INCLUDE, "WebView2.h"));
}

/** Downloads, verifies and unpacks the package; throws on a hash mismatch. */
export async function fetchWebview2(): Promise<void> {
  if (webview2Present()) return;
  const response = await fetch(`https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/${WEBVIEW2_VERSION}`);
  if (!response.ok) throw new Error(`WebView2 download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== WEBVIEW2_SHA256) throw new Error(`WebView2 package hash mismatch: ${hash}`);
  rmSync(WEBVIEW2_DIRECTORY, { recursive: true, force: true });
  mkdirSync(WEBVIEW2_DIRECTORY, { recursive: true });
  const archive = join(WEBVIEW2_DIRECTORY, "package.zip");
  writeFileSync(archive, bytes);
  const python = join(VENV_BIN, "python");
  const unpack = runTool(python, ["-I", "-m", "zipfile", "-e", archive, WEBVIEW2_DIRECTORY]);
  if (!unpack.ok) throw new Error(`unpacking the WebView2 package failed: ${unpack.output}`);
  rmSync(archive);
}
