/** What the panel sends the store when it saves a chat: the rows as they are, except that a very long turn's reasoning keeps its newest steps so the save fits the store's limits; the automatic archive holds every step. */
import type { ReasoningStep, TranscriptRow } from "./transcript.js";

const MAX_STORED_REASONING_CHARS = 100_000;

function newestSteps(steps: ReadonlyArray<ReasoningStep>): ReasoningStep[] {
  const kept: ReasoningStep[] = [];
  let total = 0;
  for (let at = steps.length - 1; at >= 0; at -= 1) {
    const step = steps[at];
    if (!step) continue;
    total += step.text.length;
    if (total > MAX_STORED_REASONING_CHARS && kept.length > 0) break;
    kept.push(step);
  }
  return kept.reverse();
}

function fitted(row: TranscriptRow): TranscriptRow {
  if (row.kind !== "assistant" || !row.reasoning) return row;
  const kept = newestSteps(row.reasoning);
  return kept.length === row.reasoning.length ? row : { ...row, reasoning: kept };
}

/** The rows to store: each as it is, a very long reasoning trimmed to its newest steps. */
export function storableRows(rows: ReadonlyArray<TranscriptRow>): TranscriptRow[] {
  return rows.map(fitted);
}
