// The automatic chat log on disk: one append-only file per session, and one per project, each row written once per event revision.
import { closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { decode, jsonObject, type JsonObject, number, object, string } from "@extynt/decode";

import type { ProjectFileLink } from "./project-file-names.js";
import { profileDirectory } from "./profile-store.js";
import type { ChatLogBatch, ChatLogEvent } from "./server-chat-log-batch.js";
import type { SidecarState } from "./server-state.js";

/** What appending a batch wrote: the rows added to the session's file, the rows added to project files and the session's file. */
export interface AppendedChatLog {
  readonly accepted: number;
  readonly projectAccepted: number;
  readonly path: string;
}

type LogState = Pick<SidecarState, "now" | "options">;

const LOG_SCHEMA = "extynt.chat-log/0.1";
const UNSAFE_PATH = "PROJECT_CHAT_LOG_PATH_UNSAFE";
const LOGGED_EVENT = object({ eventId: string(), revision: number(), sessionId: string() });
const LOGGED_REVISION = object({ eventId: string(), revision: number() });

/** The folder holding every automatic chat log. */
export function chatLogDirectory(state: Pick<SidecarState, "options">): string {
  return join(state.options.stateDirectory ?? profileDirectory(), "chat-logs");
}

function safeChatName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 96) || "chat";
}

function prepareDirectory(directory: string): void {
  for (let current = directory; ; current = dirname(current)) {
    const stat = lstatSync(current, { throwIfNoEntry: false });
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw new Error(UNSAFE_PATH);
    if (dirname(current) === current) break;
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 });
}

function loggedRows(file: string): JsonObject[] {
  if (!existsSync(file)) return [];
  const rows: JsonObject[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = decode(jsonObject, JSON.parse(line));
      if (row.ok) rows.push(row.value);
    } catch {
    }
  }
  return rows;
}

function revisionKeys(file: string, keyOf: (row: JsonObject) => string | undefined): Set<string> {
  const stat = lstatSync(file, { throwIfNoEntry: false });
  if (stat && (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)) throw new Error(UNSAFE_PATH);
  const keys = new Set<string>();
  for (const row of loggedRows(file)) {
    const key = keyOf(row);
    if (key !== undefined) keys.add(key);
  }
  return keys;
}

function sessionKeyOf(row: JsonObject): string | undefined {
  const logged = decode(LOGGED_REVISION, row);
  return logged.ok ? `${logged.value.eventId}:${logged.value.revision}` : undefined;
}

function projectKeyOf(row: JsonObject): string | undefined {
  const logged = decode(LOGGED_EVENT, row);
  return logged.ok ? JSON.stringify([logged.value.sessionId, logged.value.eventId, logged.value.revision]) : undefined;
}

function appendRows(file: string, rows: readonly string[]): void {
  const fd = openSync(file, constants.O_RDWR | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1) throw new Error(UNSAFE_PATH);
    if (stat.size) {
      const last = Buffer.alloc(1);
      readSync(fd, last, 0, 1, stat.size - 1);
      if (last[0] !== 10) writeFileSync(fd, "\n", { encoding: "utf8" });
    }
    writeFileSync(fd, `${rows.join("\n")}\n`, { encoding: "utf8" });
  } finally {
    closeSync(fd);
  }
}

function rowOf(event: ChatLogEvent, batch: ChatLogBatch, recordedAt: string, projectLink?: ProjectFileLink): string {
  const { type, eventId, revision, data } = event;
  const row = { type, schemaVersion: LOG_SCHEMA, recordedAt, sessionId: batch.sessionId, sessionName: batch.name, eventId, revision };
  return JSON.stringify(projectLink ? { ...row, projectLink, data } : { ...row, data });
}

interface ProjectGroup {
  readonly link: ProjectFileLink;
  readonly events: ChatLogEvent[];
}

function projectGroups(batch: ChatLogBatch): Map<string, ProjectGroup> {
  const groups = new Map<string, ProjectGroup>();
  for (const event of batch.events) {
    if (event.type !== "message") continue;
    for (const link of event.projectLinks) {
      const group = groups.get(link.stem) ?? { link, events: [] };
      group.events.push(event);
      groups.set(link.stem, group);
    }
  }
  return groups;
}

function appendToProject(directory: string, group: ProjectGroup, batch: ChatLogBatch, recordedAt: string): number {
  const file = join(directory, group.link.chatLogFile), seen = revisionKeys(file, projectKeyOf), rows: string[] = [];
  for (const event of group.events) {
    const key = JSON.stringify([batch.sessionId, event.eventId, event.revision]);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(rowOf(event, batch, recordedAt, group.link));
  }
  if (rows.length) appendRows(file, rows);
  return rows.length;
}

function appendProjectLogs(directory: string, batch: ChatLogBatch, recordedAt: string): number {
  const groups = projectGroups(batch);
  if (!groups.size) return 0;
  const projects = join(directory, "projects");
  prepareDirectory(projects);
  let accepted = 0;
  for (const group of groups.values()) accepted += appendToProject(projects, group, batch, recordedAt);
  return accepted;
}

/** Appends the events the session's file does not hold yet, then the messages that belong to project files. */
export function appendChatLog(state: LogState, batch: ChatLogBatch): AppendedChatLog {
  const directory = chatLogDirectory(state), path = join(directory, `${safeChatName(batch.sessionId)}.jsonl`);
  prepareDirectory(directory);
  const seen = revisionKeys(path, sessionKeyOf);
  const fresh = batch.events.filter((event) => !seen.has(`${event.eventId}:${event.revision}`));
  const rows = fresh.map((event) => rowOf(event, batch, state.now().toISOString()));
  if (rows.length) appendRows(path, rows);
  return { accepted: rows.length, projectAccepted: appendProjectLogs(directory, batch, state.now().toISOString()), path };
}
