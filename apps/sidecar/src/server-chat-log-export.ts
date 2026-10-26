// Exporting the whole automatic chat log to a file the user chose: a manifest line, then every session's log, written only where it cannot overwrite the archive.
import { closeSync, constants, fstatSync, ftruncateSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, isAbsolute, join, resolve, sep } from "node:path";
import { object, refine, string } from "@extynt/decode";

import { chatLogDirectory } from "./server-chat-log-files.js";
import type { SidecarState } from "./server-state.js";

type ExportState = Pick<SidecarState, "now" | "options">;

type ChatLogExport =
  | { readonly kind: "written"; readonly path: string; readonly sessions: number; readonly bytes: number }
  | { readonly kind: "refused"; readonly message: string };

const INSIDE_ARCHIVE = "The export cannot overwrite extynt's automatic chat archive.";
const ALIASED = "The export cannot overwrite an automatic chat archive or an aliased file.";

function usableDestination(text: string): text is string {
  return !text.includes("\0") && isAbsolute(text) && extname(text).toLowerCase() === ".jsonl";
}

/** The body of `POST /v1/chat-logs/export`: an absolute `.jsonl` path. */
export const chatLogExportBody = object({ destination: refine(string({ minLength: 2, maxLength: 4096 }), usableDestination, "an absolute .jsonl path") });

function aliasesArchive(directory: string, destination: string): boolean {
  const archiveRoot = realpathSync(directory) + sep, parent = realpathSync(dirname(destination)) + sep;
  if (parent.startsWith(archiveRoot)) return true;
  const stat = lstatSync(destination, { throwIfNoEntry: false });
  return !!stat && (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1);
}

function writeExport(destination: string, contents: string): void {
  const fd = openSync(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1) throw new Error("CHAT_EXPORT_PATH_UNSAFE");
    ftruncateSync(fd, 0);
    writeFileSync(fd, contents, { encoding: "utf8" });
  } finally {
    closeSync(fd);
  }
}

function logFiles(directory: string): string[] {
  const isFile = (name: string): boolean => {
    try {
      return statSync(join(directory, name)).isFile();
    } catch {
      return false;
    }
  };
  return readdirSync(directory).filter((name) => name.endsWith(".jsonl")).sort().filter(isFile);
}

function exportContents(state: ExportState, directory: string): { text: string; sessions: number } {
  const sources = logFiles(directory);
  const manifest = JSON.stringify({ type: "manifest", schemaVersion: "extynt.chat-log-export/0.1", exportedAt: state.now().toISOString(), source: "automatic-append-only-chat-logs", sessions: sources.length, complete: true, privacy: "potentially-sensitive-chat-data" });
  const chunks = [manifest, ...sources.map((name) => readFileSync(join(directory, name), "utf8").replace(/\n+$/, ""))].filter(Boolean);
  return { text: `${chunks.join("\n")}\n`, sessions: sources.length };
}

/** Writes the manifest and every session log to `destination`. Throws when the files cannot be read or written. */
export function exportChatLogs(state: ExportState, destination: string): ChatLogExport {
  const directory = chatLogDirectory(state);
  if (resolve(destination).startsWith(resolve(directory) + sep)) return { kind: "refused", message: INSIDE_ARCHIVE };
  mkdirSync(directory, { recursive: true });
  if (aliasesArchive(directory, destination)) return { kind: "refused", message: ALIASED };
  const { text, sessions } = exportContents(state, directory);
  writeExport(destination, text);
  return { kind: "written", path: destination, sessions, bytes: statSync(destination).size };
}
