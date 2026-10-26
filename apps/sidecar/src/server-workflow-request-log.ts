// The per-job log of the user's own messages, kept on disk beside the workflow store so every cycle re-reads what was asked.
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeJson, string } from "@extynt/decode";
import { redactWorkflowText, type WorkflowId } from "@extynt/workflow";

/** How much of the later follow-up messages a cycle re-reads: the newest that fit. */
export const REQUEST_LOG_LATER_BYTES = 16 * 1024;

const ORIGINAL_BYTES = 48 * 1024;
const FILE_MODE = 0o600;
const DIRECTORY_MODE = 0o700;

function redactSecrets(message: string): string {
  return message.split("\n").map((line) => (line.trim() ? `${/^\s*/.exec(line)?.[0] ?? ""}${redactWorkflowText(line, Number.MAX_SAFE_INTEGER)}` : line)).join("\n");
}

function cut(text: string, bytes: number): string {
  const buffer = Buffer.from(text, "utf8");
  return buffer.length <= bytes ? text : `${buffer.subarray(0, bytes).toString("utf8").replace(/�$/, "")}\n[…the rest of this message is longer than the log keeps]`;
}

function newestThatFit(later: readonly string[]): string[] {
  const kept: string[] = [];
  let budget = REQUEST_LOG_LATER_BYTES;
  for (const message of [...later].reverse()) {
    const size = Buffer.byteLength(message, "utf8");
    if (size > budget) break;
    kept.unshift(message);
    budget -= size;
  }
  return kept;
}

function persist(directory: string, file: string, text: string): void {
  try {
    mkdirSync(directory, { recursive: true, mode: DIRECTORY_MODE });
    appendFileSync(file, `${JSON.stringify(text)}\n`, { mode: FILE_MODE });
  } catch {
    return;
  }
}

function readLines(file: string): string[] {
  try {
    return readFileSync(file, "utf8").split("\n");
  } catch {
    return [];
  }
}

function loggedMessages(file: string): string[] {
  return readLines(file).flatMap((line) => {
    const decoded = line ? decodeJson(line, string()) : undefined;
    return decoded?.ok ? [decoded.value] : [];
  });
}

/** The user's messages to one job, verbatim but for secrets (each line keeps its words and layout, unlike the goal summary), so a cycle many hours in still reads what was asked rather than a summary; one JSON line per message on disk, with the in-memory copy serving this process if the disk write fails. */
export class WorkflowRequestLog {
  private readonly messages = new Map<WorkflowId, string[]>();
  constructor(private readonly directory: string | undefined) {}

  append(jobId: WorkflowId, message: string): void {
    const text = redactSecrets(message).trim();
    if (!text) return;
    const list = this.load(jobId);
    if (list.at(-1) === text) return;
    list.push(text);
    if (this.directory) persist(this.directory, this.file(jobId), text);
  }

  text(jobId: WorkflowId | null): string | undefined {
    if (!jobId) return undefined;
    const [original, ...later] = this.load(jobId);
    if (original === undefined) return undefined;
    const kept = newestThatFit(later);
    const omitted = later.length - kept.length;
    const parts = [`The user's request:\n${cut(original, ORIGINAL_BYTES)}`];
    if (omitted) parts.push(`(${omitted} earlier follow-up ${omitted === 1 ? "message is" : "messages are"} not repeated here.)`);
    kept.forEach((message, index) => parts.push(`The user's follow-up ${omitted + index + 1}:\n${message}`));
    return parts.join("\n\n");
  }

  private file(jobId: WorkflowId): string {
    return join(this.directory ?? "", `requests-${jobId}.jsonl`);
  }

  private load(jobId: WorkflowId): string[] {
    const known = this.messages.get(jobId);
    if (known) return known;
    const list = this.directory ? loggedMessages(this.file(jobId)) : [];
    this.messages.set(jobId, list);
    return list;
  }
}
