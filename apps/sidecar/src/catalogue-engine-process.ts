// The After Effects the effect catalogue runs in: the user's own app started hidden with -noui as a second, private instance, whose crash or hang costs a restart of that instance and never the user's session.
import { execFileSync, spawn } from "node:child_process";
import { closeSync, existsSync, openSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readPluginEndpoint } from "@extynt/host-native";
import type { PluginEndpoint } from "@extynt/host-native";

/** One installed After Effects whose app can collect its catalogue: `appPath` is the .app bundle on macOS and the "Adobe After Effects <year>" install folder on Windows, where `executable` is its AfterFX.exe. */
export interface EngineHost { year: string; appPath: string; executable?: string }

/** A running engine: its pid once it is known, whether it is still up, and how to stop it. */
export interface EngineProcess { readonly pid: number | undefined; alive(): boolean; stop(): void }

interface LaunchDeps { platform?: NodeJS.Platform; spawn?: typeof spawn; kill?: (pid: number, host?: EngineHost) => void; isAlive?: (pid: number) => boolean }

/** The file the engine's plugin publishes instead of the user's native.json. */
export const ENGINE_DISCOVERY_FILE = "native-engine.json";

type ListProcesses = () => string;
type ListChildren = (pid: number) => string;
type Launch = { pid: number | undefined; ended(): boolean };
type Listed = { pid: number; command: string };

const ENGINE_FLAG = "-extynt_engine";
const WINDOWS_ENGINE_ARGUMENTS = ["-m", "-noui"];
const UNREADABLE = "unreadable:";
const ENGINE_ENVIRONMENT = "EXTYNT_ENGINE";
const YEAR_FOLDER = /^Adobe After Effects (20\d\d)$/;
const LISTED_PROCESS = /^\s*(\d+)\s+(.*)$/;
const FIRST_WINDOWS_YEAR = 2025;
const COMMAND_TIMEOUT_MS = 20_000;
const WINDOWS_LISTING = "$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.Encoding]::UTF8;"
  + "Get-CimInstance Win32_Process -Filter \"Name='AfterFX.exe'\" | ForEach-Object { $c = $_.CommandLine; if (-not $c) { $c = 'unreadable:' + (Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue).MainWindowTitle }; '{0} {1}' -f $_.ProcessId, $c }";

function system32(...parts: string[]): string {
  return join(process.env.SystemRoot || process.env.windir || "C:\\Windows", "System32", ...parts);
}

function attempt(action: () => void): boolean {
  try {
    action();
    return true;
  } catch {
    return false;
  }
}

function listedProcess(line: string): Listed | undefined {
  const [, pid, command] = LISTED_PROCESS.exec(line) ?? [];
  return pid === undefined || command === undefined ? undefined : { pid: Number(pid), command };
}

/** wmic's `/format:csv` rows (Node,CommandLine,ProcessId) as "<pid> <command line>" lines; a command line may hold commas. */
export function wmicListing(csv: string): string {
  const lines: string[] = [];
  for (const row of csv.split(/\r?\n/)) {
    const first = row.indexOf(","), last = row.lastIndexOf(",");
    const pid = /^\d+$/.exec(row.slice(last + 1).trim())?.[0];
    if (first >= 0 && last > first && pid) lines.push(`${pid} ${row.slice(first + 1, last)}`);
  }
  return lines.join("\n");
}

function windowsProcesses(): string {
  const options = { encoding: "utf8", windowsHide: true, timeout: COMMAND_TIMEOUT_MS, maxBuffer: 8 << 20 } as const;
  try {
    return execFileSync(system32("WindowsPowerShell", "v1.0", "powershell.exe"), ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_LISTING], options);
  } catch {
    return wmicListing(execFileSync(system32("wbem", "wmic.exe"), ["process", "where", "name='AfterFX.exe'", "get", "CommandLine,ProcessId", "/format:csv"], options));
  }
}

const listProcesses: ListProcesses = () => process.platform === "win32" ? windowsProcesses() : execFileSync("/bin/ps", ["-axo", "pid=,command="], { encoding: "utf8" });

function executableOf(host: EngineHost): string {
  return host.executable ?? join(host.appPath, "Contents", "MacOS", "After Effects");
}

/** Where After Effects is installed: /Applications on macOS, the Adobe folder of Program Files on Windows, or EXTYNT_ENGINE_APPLICATIONS for a test sidecar that must never start a real engine. */
export function engineApplications(env: Readonly<Record<string, string | undefined>> = process.env, platform: NodeJS.Platform = process.platform): string {
  if (env.EXTYNT_ENGINE_APPLICATIONS) return env.EXTYNT_ENGINE_APPLICATIONS;
  if (platform !== "win32") return "/Applications";
  return join(env.ProgramW6432 || env.ProgramFiles || "C:\\Program Files", "Adobe");
}

function hostInFolder(applications: string, folder: string, year: string, platform: NodeJS.Platform): EngineHost | undefined {
  if (platform === "win32") {
    const executable = join(applications, folder, "Support Files", "AfterFX.exe");
    return Number(year) >= FIRST_WINDOWS_YEAR && existsSync(executable) ? { year, appPath: join(applications, folder), executable } : undefined;
  }
  const appPath = join(applications, folder, `Adobe After Effects ${year}.app`);
  return existsSync(executableOf({ year, appPath })) ? { year, appPath } : undefined;
}

function foldersOf(applications: string): string[] {
  try {
    return readdirSync(applications);
  } catch {
    return [];
  }
}

function hostOfFolder(applications: string, folder: string, platform: NodeJS.Platform): EngineHost[] {
  const year = YEAR_FOLDER.exec(folder)?.[1];
  const host = year ? hostInFolder(applications, folder, year, platform) : undefined;
  return host ? [host] : [];
}

/** Every installed After Effects, newest first. */
export function installedEngineHosts(applications = "/Applications", platform: NodeJS.Platform = process.platform): EngineHost[] {
  if (platform !== "darwin" && platform !== "win32") return [];
  const hosts = foldersOf(applications).flatMap((folder) => hostOfFolder(applications, folder, platform));
  return hosts.sort((left, right) => Number(right.year) - Number(left.year));
}

/** The engine for an After Effects version as the census reports it ("26.5x89" is After Effects 2026). */
export function engineHostForVersion(hosts: readonly EngineHost[], appVersion: string): EngineHost | undefined {
  const major = Number(/^(\d+)\./.exec(appVersion)?.[1]);
  return Number.isFinite(major) ? hosts.find((host) => Number(host.year) === 2000 + major) : undefined;
}

function argumentsAfter(command: string, executable: string, windows: boolean): string | undefined {
  const text = windows && command.startsWith("\"") ? command.slice(1) : command;
  const head = text.slice(0, executable.length);
  if (windows ? head.toLowerCase() !== executable.toLowerCase() : head !== executable) return undefined;
  const rest = text.slice(executable.length);
  return rest === "" || /^["\s]/.test(rest) ? rest : undefined;
}

function isEngine(pid: number, rest: string, enginePid: number | undefined): boolean {
  return rest.includes(` ${ENGINE_FLAG}`) || (pid === enginePid && rest.trim().replace(/^"/, "").trim() === "-m");
}

function listing(list: ListProcesses): string {
  try {
    return list();
  } catch {
    return "";
  }
}

function unreadableIsHost(command: string, host: EngineHost): boolean {
  const title = command.slice(UNREADABLE.length);
  return title.includes(`After Effects ${host.year}`) || !/After Effects 20\d\d/.test(title);
}

function pidOfLine(line: string, host: EngineHost, ours: boolean, enginePid?: number): number[] {
  const entry = listedProcess(line), windows = host.executable !== undefined;
  if (!entry) return [];
  if (windows && entry.command.startsWith(UNREADABLE)) return !ours && unreadableIsHost(entry.command, host) ? [entry.pid] : [];
  const rest = argumentsAfter(entry.command, executableOf(host), windows);
  return rest !== undefined && isEngine(entry.pid, rest, enginePid) === ours ? [entry.pid] : [];
}

function afterEffectsPids(host: EngineHost, ours: boolean, list: ListProcesses, enginePid?: number): number[] {
  return listing(list).split(/\r?\n/).flatMap((line) => pidOfLine(line, host, ours, enginePid));
}

/** The pid the running engine's plugin published in its discovery file, while that process lives. */
export function engineDiscoveryPid(discoveryPath: string, read = readPluginEndpoint): number | undefined {
  const found = read(discoveryPath);
  return found.ok ? found.endpoint.pid ?? undefined : undefined;
}

/** The user has this After Effects open: a second instance next to it is not started (it is collected another time). `enginePid` is the engine's own, which is never the user's. */
export function userAfterEffectsOpen(host: EngineHost, list: ListProcesses = listProcesses, enginePid?: number): boolean {
  return afterEffectsPids(host, false, list, enginePid).length > 0;
}

function isAlive(pid: number): boolean {
  return attempt(() => process.kill(pid, 0));
}

const listChildren: ListChildren = (pid) => execFileSync(system32("WindowsPowerShell", "v1.0", "powershell.exe"), ["-NoProfile", "-NonInteractive", "-Command",
  `$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.Encoding]::UTF8;Get-CimInstance Win32_Process -Filter "ParentProcessId=${pid}" | ForEach-Object { '{0} {1}' -f $_.ProcessId, $_.ExecutablePath }`],
{ encoding: "utf8", windowsHide: true, timeout: COMMAND_TIMEOUT_MS });

function childListing(pid: number, children: ListChildren): string {
  try {
    return children(pid);
  } catch {
    return "";
  }
}

/** The children of a Windows engine that run from its own After Effects folder: its crash handler and the Adobe crash report window, which a crashed engine leaves behind where taskkill's /T no longer reaches them. */
export function engineLeftovers(pid: number, host: EngineHost, children: ListChildren = listChildren): number[] {
  const folder = `${host.appPath.toLowerCase().replace(/\\+$/, "")}\\`;
  return childListing(pid, children).split(/\r?\n/).flatMap((line) => {
    const child = listedProcess(line);
    return child && child.command.trim().toLowerCase().startsWith(folder) ? [child.pid] : [];
  });
}

function taskkill(pid: number): void {
  attempt(() => execFileSync(system32("taskkill.exe"), ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore", timeout: COMMAND_TIMEOUT_MS }));
}

function killEngine(pid: number, host?: EngineHost): void {
  if (process.platform === "win32") {
    taskkill(pid);
    if (host) for (const leftover of engineLeftovers(pid, host)) taskkill(leftover);
    return;
  }
  attempt(() => execFileSync("/usr/bin/pkill", ["-9", "-P", String(pid)]));
  attempt(() => process.kill(pid, "SIGKILL"));
}

function logDescriptor(logPath: string): number | "ignore" {
  try {
    return openSync(logPath, "a");
  } catch {
    return "ignore";
  }
}

function startWindowsEngine(host: EngineHost, logPath: string, run: typeof spawn): Launch {
  const log = logDescriptor(logPath);
  let ended = false;
  const env = { ...process.env, [ENGINE_ENVIRONMENT]: "1" };
  const child = run(executableOf(host), WINDOWS_ENGINE_ARGUMENTS, { detached: true, windowsHide: true, env, stdio: ["ignore", log, log] });
  if (typeof log === "number") closeSync(log);
  child.on("error", () => { ended = true; });
  child.on("exit", () => { ended = true; });
  child.unref();
  return { pid: child.pid, ended: () => ended };
}

function startMacEngine(host: EngineHost, logPath: string, run: typeof spawn): undefined {
  const opener = run("/usr/bin/open", ["-g", "-j", "-n", "-a", host.appPath, "--stdout", logPath, "--stderr", logPath, "--args", "-noui", ENGINE_FLAG], { stdio: "ignore" });
  opener.on("error", () => undefined);
  return undefined;
}

function seamsOf(deps: LaunchDeps): Required<LaunchDeps> {
  return { platform: deps.platform ?? process.platform, spawn: deps.spawn ?? spawn, kill: deps.kill ?? killEngine, isAlive: deps.isAlive ?? isAlive };
}

/** Starts this After Effects hidden as an engine, with its output appended to `logPath`. Its pid is found once it runs. */
export function launchEngine(host: EngineHost, logPath: string, list: ListProcesses = listProcesses, deps: LaunchDeps = {}): EngineProcess {
  const seams = seamsOf(deps), before = new Set(afterEffectsPids(host, true, list));
  const child = seams.platform === "win32" ? startWindowsEngine(host, logPath, seams.spawn) : startMacEngine(host, logPath, seams.spawn);
  let pid: number | undefined, stopped = false;
  const find = (): number | undefined => {
    pid ??= afterEffectsPids(host, true, list).find((candidate) => !before.has(candidate));
    return pid;
  };
  const known = (): number | undefined => find() ?? (child && !child.ended() ? child.pid : undefined);
  return {
    get pid() { return known(); },
    alive: () => {
      if (stopped) return false;
      const found = find();
      if (found !== undefined) return seams.isAlive(found);
      return child ? !child.ended() : true;
    },
    stop: () => {
      stopped = true;
      const found = known();
      if (found !== undefined) seams.kill(found, host);
    },
  };
}

/** Engines a previous run of this sidecar left behind (it was killed before it could stop them): every After Effects started with the engine flag, and on Windows the one the engine discovery file names. The user never starts After Effects with the flag. Returns how many were stopped. */
export function reapLeftoverEngines(hosts: readonly EngineHost[], list: ListProcesses = listProcesses, kill: (pid: number, host?: EngineHost) => void = killEngine, enginePid?: number): number {
  let stopped = 0;
  for (const host of hosts) {
    for (const pid of afterEffectsPids(host, true, list, enginePid)) {
      kill(pid, host);
      stopped += 1;
    }
  }
  return stopped;
}

/** The endpoint the engine's plugin published, once it names this engine's pid; undefined while it is not there yet. */
export function engineEndpoint(discoveryPath: string, pid: number | undefined, read = readPluginEndpoint): PluginEndpoint | undefined {
  const found = read(discoveryPath);
  return found.ok && pid !== undefined && found.endpoint.pid === pid ? found.endpoint : undefined;
}
