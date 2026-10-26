// Local, append-only transcripts for the advisory specialists: the complete user instruction, the assistant reply (including SVG) and any sidecar correction prompt, kept local to the profile. A sidecar-started call also records its measure as `cost`: role, ms, tokens, outcome and what it caught.
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { AgentMessage } from "@extynt/llm";
import type { JsonObject } from "@extynt/decode";

interface SpecialistTranscriptTurn {
  readonly workflowId: string;
  readonly requestId: string;
  readonly role: string;
  readonly turn: number;
  readonly outcome: "completed" | "failed";
  readonly at: string;
  readonly messages: readonly AgentMessage[];
  readonly error?: string;
  readonly cost?: JsonObject;
}

const MAX_NAME_CHARS = 128;

/** Appends one specialist turn to its workflow's transcript; a turn without messages writes nothing. */
export function appendSpecialistTranscript(directory: string, turn: SpecialistTranscriptTurn): void {
  if (!turn.messages.length) return;
  const folder = join(directory, "specialist-logs");
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const name = turn.workflowId.replace(/[^a-zA-Z0-9_-]/gu, "_").slice(0, MAX_NAME_CHARS);
  appendFileSync(join(folder, `${name}.jsonl`), `${JSON.stringify({ schemaVersion: "extynt.specialist-log/0.1", ...turn })}\n`, { encoding: "utf8", mode: 0o600 });
}
