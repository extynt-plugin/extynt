// Local, append-only per-step log of the main agent's reasoning, so a cancelled or failed turn still leaves its thinking on disk; a specialist's own loop (the visual-scene designer) logs to a file of its own, and a result records its name, ok and error code only, never a payload.
import { appendFileSync, lstatSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

/** The tail of long reasoning is what led to the step's tool calls. */
export const AGENT_LOG_REASONING_CHARS = 16000;

interface AgentStepLogRow {
  readonly requestId: string;
  readonly workflowId?: string;
  readonly role?: string;
  readonly step: number;
  readonly at: string;
  readonly reasoning: string;
  readonly tools: readonly string[];
  readonly results: ReadonlyArray<{ readonly name: string; readonly ok: boolean; readonly code?: string }>;
}

const RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_NAME_CHARS = 128;
const RETAINED_FOLDERS = ["agent-logs", "specialist-logs", "workflow-requests"] as const;
const RETAINED_FILES = ["pipeline.log"] as const;

function writeStepRow(directory: string, row: AgentStepLogRow): void {
  const folder = join(directory, "agent-logs");
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const name = `${row.workflowId ?? row.requestId}${row.role ? `-${row.role}` : ""}`.replace(/[^a-zA-Z0-9_-]/gu, "_").slice(0, MAX_NAME_CHARS);
  const reasoning = row.reasoning.length > AGENT_LOG_REASONING_CHARS ? row.reasoning.slice(-AGENT_LOG_REASONING_CHARS) : row.reasoning;
  appendFileSync(join(folder, `${name}.jsonl`), `${JSON.stringify({ schemaVersion: "extynt.agent-log/0.1", ...row, reasoning })}\n`, { encoding: "utf8", mode: 0o600 });
}

/** Best-effort: a write failure never breaks the turn. */
export function appendAgentStepLog(directory: string, row: AgentStepLogRow): void {
  try {
    writeStepRow(directory, row);
  } catch {
    return;
  }
}

function removeIfStale(path: string, cutoff: number): number {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.mtimeMs >= cutoff) return 0;
    unlinkSync(path);
    return 1;
  } catch {
    return 0;
  }
}

function removeStaleIn(folderPath: string, cutoff: number): number {
  try {
    if (!lstatSync(folderPath).isDirectory()) return 0;
    return readdirSync(folderPath).reduce((removed, name) => removed + removeIfStale(join(folderPath, name), cutoff), 0);
  } catch {
    return 0;
  }
}

/** Diagnostic logs older than thirty days are removed at startup; chat exports and the automatic chat logs are never listed here. Best-effort: deletes regular files whose last write is older than the retention window, and never follows or removes a symlink. Returns how many it removed. */
export function pruneStaleSidecarLogs(stateDirectory: string, now: number = Date.now()): number {
  const cutoff = now - RETENTION_DAYS * DAY_MS;
  const fromFolders = RETAINED_FOLDERS.reduce((removed, folder) => removed + removeStaleIn(join(stateDirectory, folder), cutoff), 0);
  return RETAINED_FILES.reduce((removed, name) => removed + removeIfStale(join(stateDirectory, name), cutoff), fromFolders);
}
