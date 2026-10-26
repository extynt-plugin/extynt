#!/usr/bin/env node

/** Stops the sidecar process started from this checkout. */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { accepts, decode, number, object, string, type Infer } from "@extynt/decode";

const WINDOWS = platform() === "win32";
const SESSION_PATH = WINDOWS
  ? join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "extynt", "session.json")
  : platform() === "darwin"
    ? join(homedir(), "Library", "Application Support", "extynt", "session.json")
    : join(homedir(), ".config", "extynt", "session.json");
const TASK_NAME = `extynt sidecar ${(process.env.USERNAME ?? "").replace(/[^A-Za-z0-9._-]/g, "_")}`;
const LAUNCH_AGENT = join(homedir(), "Library", "LaunchAgents", "com.extynt.sidecar.plist");
const SIDECAR_ENTRY_SUFFIX = "/apps/sidecar/dist/src/main.js";

const sidecarSession = object({ port: number({ int: true, min: 1, max: 65535 }), token: string({ nonEmpty: true }) });
const isSidecarHealth = accepts(object({ service: string({ pattern: /^extynt-sidecar$/ }) }));
type SidecarSession = Infer<typeof sidecarSession>;

interface CommandResult {
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

function sessionFile(): SidecarSession | undefined {
  try {
    const session = decode(sidecarSession, JSON.parse(readFileSync(SESSION_PATH, "utf8")));
    return session.ok ? { port: session.value.port, token: session.value.token } : undefined;
  } catch {
    return undefined;
  }
}

function command(name: string, args: readonly string[]): CommandResult {
  const result = spawnSync(name, args, { encoding: "utf8" });
  return { ok: result.status === 0, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

function markSupervisorStopped(): void {
  mkdirSync(dirname(SESSION_PATH), { recursive: true });
  writeFileSync(join(dirname(SESSION_PATH), "supervisor.stop"), new Date().toISOString());
}

function endScheduledTask(): boolean {
  markSupervisorStopped();
  const result = command("schtasks.exe", ["/End", "/TN", TASK_NAME]);
  if (result.ok) process.stdout.write(`Ended the "${TASK_NAME}" scheduled task.\n`);
  return result.ok;
}

function unloadLaunchAgent(): boolean {
  if (WINDOWS) return endScheduledTask();
  if (platform() !== "darwin" || !existsSync(LAUNCH_AGENT)) return false;
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  if (uid === undefined) return false;
  const result = command("/bin/launchctl", ["bootout", `gui/${uid}`, LAUNCH_AGENT]);
  if (result.ok) process.stdout.write("Unloaded com.extynt.sidecar from the current login session.\n");
  return result.ok;
}

async function healthy(session: SidecarSession): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${session.port}/health`, {
      headers: { Authorization: `Bearer ${session.token}` },
      signal: AbortSignal.timeout(500),
    });
    if (!response.ok) return false;
    return isSidecarHealth(await response.json());
  } catch {
    return false;
  }
}

function windowsListenerPids(port: number): number[] {
  const result = command("netstat.exe", ["-ano", "-p", "tcp"]);
  if (!result.ok) return [];
  const pids = result.stdout.split(/\r?\n/).map((line) => line.trim().split(/\s+/))
    .filter((cells) => cells[3] === "LISTENING" && cells[1] === `127.0.0.1:${port}`).map((cells) => Number(cells[4]));
  return [...new Set(pids.filter((pid) => Number.isInteger(pid) && pid > 4))];
}

function listenerPids(port: number): number[] {
  if (WINDOWS) return windowsListenerPids(port);
  const lsof = existsSync("/usr/sbin/lsof") ? "/usr/sbin/lsof" : "lsof";
  const result = command(lsof, ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]);
  if (!result.ok || !result.stdout) return [];
  return [...new Set(result.stdout.split(/\s+/).map(Number).filter((pid) => Number.isInteger(pid) && pid > 1))];
}

function verifiedSidecarPid(pid: number): boolean {
  if (WINDOWS) {
    const query = command("powershell.exe", ["-NoProfile", "-Command", `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`]);
    return query.ok && query.stdout.replace(/\\/g, "/").includes(SIDECAR_ENTRY_SUFFIX);
  }
  const result = command("/bin/ps", ["-p", String(pid), "-o", "command="]);
  return result.ok && result.stdout.replace(/\\/g, "/").includes(SIDECAR_ENTRY_SUFFIX);
}

async function waitUntilClosed(session: SidecarSession, pids: readonly number[]): Promise<boolean> {
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    const alive = pids.some((pid) => {
      try { process.kill(pid, 0); return true; } catch { return false; }
    });
    if (!alive && !(await healthy(session))) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

const session = sessionFile();
unloadLaunchAgent();

if (!session || !(await healthy(session))) {
  process.stdout.write("No authenticated extynt sidecar is listening at the recorded local session.\n");
  process.exit(0);
}

const pids = listenerPids(session.port);
if (!pids.length || !pids.every(verifiedSidecarPid)) {
  process.stderr.write(`Refusing to signal the listener on port ${session.port}: its process could not be proven to be the extynt sidecar.\n`);
  process.exit(1);
}

for (const pid of pids) process.kill(pid, "SIGTERM");
if (!(await waitUntilClosed(session, pids))) {
  process.stderr.write("The extynt sidecar did not close after SIGTERM; no broader or forced kill was attempted.\n");
  process.exit(1);
}

process.stdout.write(`Stopped the authenticated extynt sidecar on 127.0.0.1:${session.port}.\n`);
