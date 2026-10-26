/** Finds and reads the native plugin's discovery file. */
import { readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { decodeJson, fallback, isNotJson, number, object, string } from "@extynt/decode";
import type { Infer } from "@extynt/decode";
import { SpikeError, systemCode } from "./errors.ts";

const DISCOVERY = object({
  port: number({ int: true, min: 1, max: 65535 }),
  token: string({ nonEmpty: true }),
  pid: fallback(number({ int: true }), null),
  aeVersion: fallback(string(), null),
  pluginVersion: fallback(string(), null),
});

/** The facts in the plugin's discovery file: where it listens, its token, and optional identity. */
export type Discovery = Infer<typeof DISCOVERY>;

/** Mirrors the per-user layout the sidecar uses for session.json: macOS Application Support, ~/.config elsewhere. */
export function extyntStateDirectory(): string {
  return platform() === "darwin"
    ? join(homedir(), "Library", "Application Support", "extynt")
    : join(homedir(), ".config", "extynt");
}

/** The per-user path of the plugin's discovery file. */
export function defaultDiscoveryPath(): string {
  return join(extyntStateDirectory(), "native.json");
}

function parseDiscovery(text: string, path: string): Discovery {
  const decoded = decodeJson(text, DISCOVERY);
  if (decoded.ok) return decoded.value;
  if (isNotJson(decoded.error)) {
    throw new SpikeError("DISCOVERY_INVALID", `Discovery file ${path} is not valid JSON; it may be half-written. Restart After Effects and retry.`);
  }
  throw new SpikeError("DISCOVERY_INVALID", `Discovery file ${path} lacks a valid "port" and "token".`);
}

function readDiscoveryText(path: string): string {
  try { return readFileSync(path, "utf8"); } catch (error) {
    if (!(error instanceof Error)) throw error;
    if (systemCode(error) === "ENOENT") {
      throw new SpikeError("DISCOVERY_MISSING", `Discovery file not found at ${path}. After Effects is not running, or the extynt native plugin is not loaded. Start After Effects (the plugin writes the file on startup), or pass --discovery FILE.`);
    }
    throw new SpikeError("DISCOVERY_UNREADABLE", `Cannot read discovery file ${path}: ${error.message}`);
  }
}

/** Reads and validates the discovery file; a missing, unreadable or malformed file is a SpikeError that says what to do. */
export function readDiscovery(path: string): Discovery {
  return parseDiscovery(readDiscoveryText(path), path);
}

/** Sends a signal to a process; the shape of `process.kill`, so a test can stand in for it. */
export type KillProcess = (pid: number, signal: number) => true;

/** True when the process exists; a permission error still means it exists. */
export function pidAlive(pid: number, kill: KillProcess = process.kill): boolean {
  try { return kill(pid, 0); } catch (error) { return error instanceof Error && systemCode(error) === "EPERM"; }
}

/** What assertFresh may be told: skip the check, or replace the process probe. */
export interface FreshnessOptions {
  readonly skipPidCheck?: boolean;
  readonly kill?: KillProcess;
}

/** A dead pid means After Effects exited and left its file behind; the port in it belongs to nobody. */
export function assertFresh(discovery: Discovery, path: string, options: FreshnessOptions = {}): void {
  if (options.skipPidCheck || discovery.pid === null) return;
  if (pidAlive(discovery.pid, options.kill)) return;
  throw new SpikeError("DISCOVERY_STALE", `Discovery file ${path} names pid ${discovery.pid}, which is not running (stale file from a previous After Effects session). Start After Effects, or pass --no-pid-check if the pid is in another namespace.`);
}
