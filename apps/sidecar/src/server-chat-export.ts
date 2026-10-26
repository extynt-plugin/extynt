// Saving a chat transcript the panel sends: a validated JSON-lines file written owner-only into the chat-log folder.
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { decode, fallback, jsonObject, map, object, refine, string } from "@extynt/decode";

import { chatLogDirectory } from "./server-chat-log-files.js";
import type { SidecarState } from "./server-state.js";

interface ChatTranscript {
  readonly sessionId: string;
  readonly slug: string;
  readonly jsonl: string;
  readonly lines: number;
}

/** Where a transcript was saved and how much of it. */
export interface SavedTranscript {
  readonly sessionId: string;
  readonly path: string;
  readonly displayPath: string;
  readonly bytes: number;
  readonly messages: number;
}

type ExportState = Pick<SidecarState, "now" | "options">;

function linesOf(text: string): string[] {
  return text.split("\n").filter((line) => line.trim().length > 0);
}

function everyLineIsAnObject(text: string): text is string {
  const lines = linesOf(text);
  return lines.length > 0 && lines.every((line) => {
    try {
      return decode(jsonObject, JSON.parse(line)).ok;
    } catch {
      return false;
    }
  });
}

function hasContent(text: string): text is string {
  return text.trim().length > 0;
}

function slugOf(name: string | undefined, sessionId: string): string {
  const source = (name?.trim() ?? "") || sessionId;
  return source.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "chat";
}

const transcriptFields = object({
  sessionId: refine(string({ maxLength: 128 }), hasContent, "a session id with content"),
  name: fallback(string(), undefined),
  jsonl: refine(string({ minLength: 2, maxLength: 1_500_000 }), everyLineIsAnObject, "JSON lines that are each an object"),
});

/** The body of `POST /v1/chats`. */
export const chatTranscript = map(transcriptFields, (fields): ChatTranscript => {
  const sessionId = fields.sessionId.trim(), lines = linesOf(fields.jsonl);
  return { sessionId, slug: slugOf(fields.name, sessionId), jsonl: `${lines.join("\n")}\n`, lines: lines.length };
});

function shownPath(path: string): string {
  const home = homedir();
  return path.indexOf(home) === 0 ? `~${path.slice(home.length)}` : path;
}

/** Writes the transcript into the chat-log folder, readable by its owner only because a transcript can name a client's project. Throws when it cannot be written. */
export function saveTranscript(state: ExportState, transcript: ChatTranscript): SavedTranscript {
  const directory = chatLogDirectory(state);
  const stamp = state.now().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const path = join(directory, `${stamp}-${transcript.slug}.jsonl`);
  mkdirSync(directory, { recursive: true });
  writeFileSync(path, transcript.jsonl, { mode: 0o600 });
  return { sessionId: transcript.sessionId, path, displayPath: shownPath(path), bytes: Buffer.byteLength(transcript.jsonl), messages: transcript.lines - 1 };
}
