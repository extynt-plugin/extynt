// The pinned Node.js runtime for the Windows bundle: read packaging/windows/node-runtime.env, download the official
// win-x64 zip (cached outside the repo), verify its SHA-256 against the pin, and extract node.exe and LICENSE.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { extractTopLevelFile } from "./zip-entry.ts";

export const WINDOWS_RUNTIME_ENV = join("packaging", "windows", "node-runtime.env");

/** KEY=value pairs of a runtime env file; comment and blank lines are ignored. */
export function parseRuntimeEnv(text: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of text.split("\n")) {
    const match = /^([A-Z0-9_]+)=(\S+)\s*$/.exec(line);
    const [, key, value] = match ?? [];
    if (key && value) values.set(key, value);
  }
  return values;
}

/** The pinned Node.js runtime: its version and the SHA-256 of the win-x64 zip. */
export interface NodePin {
  readonly version: string;
  readonly sha256: string;
}

/** The pin: { version, sha256 }, or a thrown error when the file lacks either value. */
export function windowsNodePin(root: string): NodePin {
  const values = parseRuntimeEnv(readFileSync(join(root, WINDOWS_RUNTIME_ENV), "utf8"));
  const version = values.get("NODE_VERSION");
  const sha256 = values.get("NODE_SHA256_WIN_X64");
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`${WINDOWS_RUNTIME_ENV} has no NODE_VERSION=major.minor.patch line`);
  if (!sha256 || !/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`${WINDOWS_RUNTIME_ENV} has no 64-digit NODE_SHA256_WIN_X64 line`);
  return { version, sha256 };
}

export function sha256Of(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function download(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/** The verified zip bytes: the cached copy when it matches the pin, otherwise a fresh download that must match it. */
export async function verifiedNodeZip(pin: NodePin, cacheDirectory: string): Promise<Buffer> {
  const name = `node-v${pin.version}-win-x64.zip`;
  const cached = join(cacheDirectory, name);
  if (existsSync(cached)) {
    const bytes = readFileSync(cached);
    if (sha256Of(bytes) === pin.sha256) return bytes;
  }
  const bytes = await download(`https://nodejs.org/dist/v${pin.version}/${name}`);
  if (sha256Of(bytes) !== pin.sha256) throw new Error(`${name} does not match its pinned SHA-256 (${pin.sha256}); nothing was cached`);
  mkdirSync(cacheDirectory, { recursive: true });
  writeFileSync(`${cached}.part`, bytes);
  renameSync(`${cached}.part`, cached);
  return bytes;
}

/** Where downloads are cached: outside the repository, as the macOS builder does. */
export function nodeCacheDirectory(env: NodeJS.ProcessEnv): string {
  return join(env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "extynt", "node");
}

/** Writes runtime/node.exe and runtime/LICENSE under `bundle`, both taken from the verified zip. */
export async function stageNodeRuntime(root: string, bundle: string, env: NodeJS.ProcessEnv): Promise<NodePin> {
  const pin = windowsNodePin(root);
  const zip = await verifiedNodeZip(pin, nodeCacheDirectory(env));
  const directory = join(bundle, "runtime");
  mkdirSync(directory, { recursive: true });
  const exe = extractTopLevelFile(zip, "node.exe");
  if (exe.subarray(0, 2).toString("latin1") !== "MZ") throw new Error("node.exe from the archive is not a Windows executable");
  writeFileSync(join(directory, "node.exe"), exe);
  writeFileSync(join(directory, "LICENSE"), extractTopLevelFile(zip, "LICENSE"));
  writeFileSync(join(directory, "VERSION"), `${pin.version}\n`);
  return pin;
}
