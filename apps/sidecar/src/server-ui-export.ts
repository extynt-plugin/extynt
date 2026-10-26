// The chat-log export: one fixed folder, one new file per export, never a destination from the request.
import { spawn } from "node:child_process";
import { closeSync, constants, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { profileDirectory } from "./profile-store.js";
import type { HttpRoutesDeps } from "./server-http-state.js";

type ExportState = Pick<HttpRoutesDeps["state"], "now" | "options">;
const MAX_NAME_ATTEMPTS = 10;

function exportDirectory(state: ExportState): string {
  return state.options.stateDirectory !== undefined ? join(state.options.stateDirectory, "exports") : join(homedir(), "Documents", "extynt", "Chat Logs");
}

function plainDirectory(directory: string): boolean {
  const stat = lstatSync(directory);
  return stat.isDirectory() && !stat.isSymbolicLink();
}

function preparedDirectory(state: ExportState): string {
  const directory = exportDirectory(state);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (!plainDirectory(directory) || !plainDirectory(dirname(directory))) throw new Error("The export folder is not a plain directory.");
  return directory;
}

function chatLogSources(directory: string): string[] {
  try {
    return readdirSync(directory).filter((name) => name.endsWith(".jsonl")).sort().filter((name) => { try { return statSync(join(directory, name)).isFile(); } catch { return false; } });
  } catch { return []; }
}

function exportContents(state: ExportState): { text: string; sessions: number } {
  const logs = join(state.options.stateDirectory ?? profileDirectory(), "chat-logs"), sources = chatLogSources(logs);
  const manifest = JSON.stringify({ type: "manifest", schemaVersion: "extynt.chat-log-export/0.1", exportedAt: state.now().toISOString(), source: "automatic-append-only-chat-logs", sessions: sources.length, complete: true, privacy: "potentially-sensitive-chat-data" });
  const chunks = [manifest, ...sources.map((name) => readFileSync(join(logs, name), "utf8").replace(/\n+$/, ""))].filter(Boolean);
  return { text: `${chunks.join("\n")}\n`, sessions: sources.length };
}

function writeNewFile(directory: string, stamp: string, text: string): string {
  for (let attempt = 0; attempt < MAX_NAME_ATTEMPTS; attempt += 1) {
    const file = join(directory, `${stamp}${attempt === 0 ? "" : `-${attempt}`}.jsonl`);
    let fd: number;
    try { fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST") continue;
      throw error;
    }
    try { writeFileSync(fd, text, { encoding: "utf8" }); } finally { closeSync(fd); }
    return file;
  }
  throw new Error("No free export file name.");
}

function reveal(state: ExportState, file: string): void {
  if (process.platform !== "darwin" || state.options.stateDirectory !== undefined) return;
  try {
    const child = spawn("open", ["-R", file], { detached: true, stdio: "ignore" });
    child.once("error", () => undefined);
    child.unref();
  } catch { return; }
}

/** Writes the automatic chat logs to a new file in the fixed export folder; throws when the folder is not a plain directory or the file cannot be written. */
export function exportChatLogs(state: ExportState): { path: string; sessions: number; bytes: number } {
  const directory = preparedDirectory(state), contents = exportContents(state);
  const file = writeNewFile(directory, state.now().toISOString().replace(/:/g, "-"), contents.text);
  reveal(state, file);
  return { path: file, sessions: contents.sessions, bytes: Buffer.byteLength(contents.text) };
}
