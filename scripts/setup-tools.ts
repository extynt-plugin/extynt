#!/usr/bin/env node
// Creates the repo-local venv at .tools/venv, installs the pinned tools from scripts/requirements-tools.txt, and fetches the
// pinned WebView2 headers into .tools/webview2 for the Windows syntax check, and
// unpacks the pinned mingw-w64 cross compiler into ~/.cache/extynt/toolchains (Linux x64, no root).
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { ROOT } from "./lib/sources.ts";
import { VENV_BIN } from "./lib/tools.ts";
import { fetchMingw } from "./lib/mingw-toolchain.ts";
import { fetchWebview2 } from "./lib/webview2-package.ts";

function run(command: string, args: ReadonlyArray<string>): void {
  const result = spawnSync(command, args, { cwd: ROOT, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed`);
}

const python = process.env.PYTHON ?? (process.platform === "win32" ? "python" : "python3");
run(python, ["-m", "venv", join(ROOT, ".tools", "venv")]);
run(join(VENV_BIN, "python"), ["-m", "pip", "install", "--require-virtualenv", "-r", join(ROOT, "scripts", "requirements-tools.txt")]);
await fetchWebview2();
await fetchMingw();
console.log("tools ready in .tools/venv and .tools/webview2");
