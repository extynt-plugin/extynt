// Locates the pinned quality tools: the repo-local venv first, then PATH.
import { spawnSync } from "node:child_process";
import type { SpawnSyncOptionsWithStringEncoding } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./sources.ts";

/** The spawnSync options a tool run may override; output is always decoded as UTF-8. */
export type ToolOptions = Omit<SpawnSyncOptionsWithStringEncoding, "encoding">;

/** How a tool run ended: success flag, joined stdout and stderr, exit status (null when killed) and any spawn error. */
export interface ToolResult {
  readonly ok: boolean;
  readonly output: string;
  readonly status: number | null;
  readonly error: Error | undefined;
}

export const SETUP_COMMAND = "pnpm setup:tools";
export const VENV_BIN = join(ROOT, ".tools", "venv", process.platform === "win32" ? "Scripts" : "bin");

function runs(command: string): boolean {
  return spawnSync(command, ["--version"], { stdio: "ignore" }).status === 0;
}

/** Absolute path of a tool in the venv, else its bare name when PATH has it, else null. */
export function toolPath(name: string): string | null {
  const local = join(VENV_BIN, process.platform === "win32" ? `${name}.exe` : name);
  if (existsSync(local)) return local;
  return runs(name) ? name : null;
}

export function missingToolMessage(names: ReadonlyArray<string>): string {
  return `missing tool${names.length > 1 ? "s" : ""}: ${names.join(", ")}. Run: ${SETUP_COMMAND}`;
}

/** Resolves every named tool or throws one error naming the setup command. */
export function requireTools(names: ReadonlyArray<string>): ReadonlyMap<string, string> {
  const paths = new Map<string, string>();
  const missing: string[] = [];
  for (const name of names) {
    const path = toolPath(name);
    if (path) paths.set(name, path);
    else missing.push(name);
  }
  if (missing.length) throw new Error(missingToolMessage(missing));
  return paths;
}

/** Runs a command to completion; returns { ok, output } with stdout and stderr joined. */
export function runTool(command: string, args: ReadonlyArray<string>, options: ToolOptions = {}): ToolResult {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, ...options });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  return { ok: result.status === 0, output, status: result.status, error: result.error };
}
