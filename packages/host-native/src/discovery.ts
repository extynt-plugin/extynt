// Finds the plugin: native.json in the per-user state directory holds the loopback port and the token. A dead pid means After Effects exited and left its file behind, so the port belongs to nobody.
import { mkdirSync, readFileSync, statSync, watch } from "node:fs";
import { homedir, platform } from "node:os";
import { basename, dirname, join } from "node:path";
import { accepts, decode, decodeJson, number, object, string } from "@extynt/decode";
import type { PluginEndpoint } from "./client-types.js";
import { jsonValue } from "./json-value.js";
import { nullUnlessValid } from "./wire-common.js";

export type DiscoveryFailureCode = "DISCOVERY_MISSING" | "DISCOVERY_INVALID" | "DISCOVERY_STALE" | "DISCOVERY_UNREADABLE";
type DiscoveryFailure = { ok: false; code: DiscoveryFailureCode; message: string };
export type DiscoveryResult = { ok: true; endpoint: PluginEndpoint } | DiscoveryFailure;

const ENDPOINT_POLL_MS = 1_000;
const POSIX_PERMISSION_DENIED = "EPERM";

const endpointFile = object({
  port: number({ int: true, min: 1, max: 65_535 }), token: string({ nonEmpty: true }),
  pid: nullUnlessValid(number({ int: true })), aeVersion: nullUnlessValid(string()), pluginVersion: nullUnlessValid(string()),
});

/** The same per-user layout the sidecar uses for session.json: macOS Application Support, %LOCALAPPDATA% on Windows, ~/.config elsewhere. */
export function stateDirectory(): string {
  if (platform() === "win32") return join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "extynt");
  return platform() === "darwin" ? join(homedir(), "Library", "Application Support", "extynt") : join(homedir(), ".config", "extynt");
}

export function defaultDiscoveryPath(): string {
  return join(stateDirectory(), "native.json");
}

function failure(code: DiscoveryFailureCode, message: string): DiscoveryFailure {
  return { ok: false, code, message };
}

const isErrnoException = accepts(object({ code: string() }));

function parseEndpoint(text: string, path: string): DiscoveryResult {
  const json = decodeJson(text, jsonValue);
  if (!json.ok) return failure("DISCOVERY_INVALID", `Discovery file ${path} is not valid JSON; it may be half-written.`);
  const file = decode(endpointFile, json.value);
  if (!file.ok) return failure("DISCOVERY_INVALID", `Discovery file ${path} lacks a valid "port" and "token".`);
  const { port, token, pid, aeVersion, pluginVersion } = file.value;
  return { ok: true, endpoint: { path, port, token, pid, aeVersion, pluginVersion } };
}

function pidAlive(pid: number, kill: typeof process.kill): boolean {
  try { kill(pid, 0); return true; } catch (error) { return isErrnoException(error) && error.code === POSIX_PERMISSION_DENIED; }
}

function readText(path: string): { ok: true; text: string } | DiscoveryFailure {
  try { return { ok: true, text: readFileSync(path, "utf8") }; } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return failure("DISCOVERY_MISSING", `Discovery file not found at ${path}: After Effects is not running or the extynt plugin is not loaded.`);
    }
    return failure("DISCOVERY_UNREADABLE", `Cannot read discovery file ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Reads and validates the discovery file; `kill` is injectable so tests need no real process. */
export function readPluginEndpoint(path: string = defaultDiscoveryPath(), kill: typeof process.kill = process.kill.bind(process)): DiscoveryResult {
  const read = readText(path);
  if (!read.ok) return read;
  const parsed = parseEndpoint(read.text, path);
  if (!parsed.ok || parsed.endpoint.pid === null || pidAlive(parsed.endpoint.pid, kill)) return parsed;
  return failure("DISCOVERY_STALE", `Discovery file ${path} names pid ${parsed.endpoint.pid}, which is not running (left behind by a previous After Effects session).`);
}

function endpointFingerprint(path: string): string {
  try {
    const stats = statSync(path);
    return `${stats.ino}:${stats.size}:${stats.mtimeMs}`;
  } catch {
    return "missing";
  }
}

interface EndpointPoll { close(): void; rebase(): void }

function pollPluginEndpoint(path: string, onChange: () => void): EndpointPoll {
  let last = endpointFingerprint(path);
  const timer = setInterval(() => {
    const next = endpointFingerprint(path);
    if (next === last) return;
    last = next;
    onChange();
  }, ENDPOINT_POLL_MS);
  timer.unref();
  return { close: () => { clearInterval(timer); }, rebase: () => { last = endpointFingerprint(path); } };
}

const onWatchEnded = (): void => undefined;

/**
 * Calls `onChange` whenever native.json is created, rewritten, renamed into place or removed. The directory is watched, not the file, because the plugin
 * replaces it, and a removed directory ends the watch quietly: the caller's next read reports the missing file. When the system refuses a watch (EMFILE
 * once its watcher limit is spent, or a file system with no change events) the file is polled instead, so a sidecar that cannot watch still finds After
 * Effects about a second later. On macOS the poll also runs beside the watch, because FSEvents drops changes made while its stream is still starting;
 * the poll takes its baseline synchronously and re-bases on every change the watch reports, so neither reports the same change twice.
 */
export function watchPluginEndpoint(path: string, onChange: () => void, watchDirectory: typeof watch = watch): { close(): void } {
  const directory = dirname(path);
  const name = basename(path);
  mkdirSync(directory, { recursive: true });
  const backstop = platform() === "darwin" ? pollPluginEndpoint(path, onChange) : undefined;
  try {
    const watcher = watchDirectory(directory, (_event, filename) => {
      if (filename !== null && filename !== name) return;
      backstop?.rebase();
      onChange();
    });
    watcher.on("error", onWatchEnded);
    return { close: () => { watcher.close(); backstop?.close(); } };
  } catch {
    return backstop ?? pollPluginEndpoint(path, onChange);
  }
}
