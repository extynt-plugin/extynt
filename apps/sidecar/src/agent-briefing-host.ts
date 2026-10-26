// The briefing's account of what the connected After Effects has failed at: operations it could not read back and an apply it quit during.
import type { RuntimeOperationEvidence } from "@extynt/mcp-server";
import { clean } from "./agent-policy.js";

/** The per-host read-back failure map, keyed by operation type. */
export type RuntimeEvidence = Readonly<Record<string, RuntimeOperationEvidence>>;

/** Where an interrupted apply stopped: the step, how many operations the batch held, and the operation and layer it was on. */
export interface InterruptedApplyFacts {
  readonly index: number;
  readonly operationCount: number | null;
  readonly operation: string | null;
  readonly layerId: string | null;
}

const MAX_RUNTIME_EVIDENCE_OPERATIONS = 8;
const MAX_RUNTIME_EVIDENCE_CHARS = 400;
const MAX_RUNTIME_EVIDENCE_FIELD_CHARS = 60;
const MAX_HOST_FAILURE_LINES = 6;
const HOST_QUIT_BASIS = "host-quit-during-apply";

function failureLine(operation: string, entry: RuntimeOperationEvidence): string {
  const basis = entry.lastFailureBasis ? `${clean(entry.lastFailureBasis, MAX_RUNTIME_EVIDENCE_FIELD_CHARS)}, ` : "";
  return `- ${clean(operation, MAX_RUNTIME_EVIDENCE_FIELD_CHARS)} (${basis}${entry.failures ?? 0} failures)`;
}

function failureLines(evidence: RuntimeEvidence | undefined): string[] {
  const failed = Object.entries(evidence ?? {})
    .filter(([, entry]) => (entry.failures ?? 0) > 0)
    .sort(([, a], [, b]) => (b.failures ?? 0) - (a.failures ?? 0))
    .slice(0, MAX_RUNTIME_EVIDENCE_OPERATIONS);
  const lines: string[] = [];
  let chars = 0;
  for (const [operation, entry] of failed) {
    const line = failureLine(operation, entry);
    if (chars + line.length + 1 > MAX_RUNTIME_EVIDENCE_CHARS) break;
    chars += line.length + 1;
    lines.push(line);
  }
  return lines;
}

/** The warning sentence for an After Effects quit mid-apply; the briefing and the MCP context tools share it. */
export function interruptedApplyLine(interrupted: InterruptedApplyFacts): string {
  const step = `${interrupted.index + 1} of ${interrupted.operationCount ?? "?"}`;
  const operation = interrupted.operation ?? "unknown operation";
  const layer = interrupted.layerId ?? "unknown layer";
  return `After Effects quit during apply at step ${step} (${operation}, ${layer}). Operations before it may have applied; the project may be partly changed or back at its last save. Refresh the snapshot and inspect carefully before queueing anything else. Do not repeat that operation the same way without changes.`;
}

/** The host read-back failure history as at most a few lines, the same lines the briefing lists. */
export function hostFailureLines(evidence: RuntimeEvidence | undefined): string[] {
  return failureLines(evidence).slice(0, MAX_HOST_FAILURE_LINES);
}

/** The block listing operations this host build failed to read back (headed differently when After Effects quit mid-apply), or nothing when there are none. It sits above the runtime state so it stays in the cached half: it changes with the host's evidence, not per turn. */
export function runtimeEvidenceBlock(evidence: RuntimeEvidence | undefined): string[] {
  const lines = failureLines(evidence);
  if (!lines.length) return [];
  const quit = Object.values(evidence ?? {}).some((entry) => entry.lastFailureBasis === HOST_QUIT_BASIS);
  const heading = quit
    ? "Operations interrupted when After Effects quit mid-apply (do not repeat the same way; refresh and inspect before queueing again):"
    : "Operations this host build has failed to read back before (prefer a different route, or a narrower write, over repeating one):";
  return [heading, ...lines, ""];
}

/** The interrupted-apply warning followed by a blank line, or nothing when no apply was interrupted. */
export function interruptedApplyBlock(interrupted: InterruptedApplyFacts | null | undefined): string[] {
  return interrupted ? [interruptedApplyLine(interrupted), ""] : [];
}
