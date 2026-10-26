// The local decision log: one JSON line per settled decision with the tier that answered, the answer, its confidence, band and whether the offline answer abstained, and the latency; never request text and never keys.
import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Band, DecisionImage, DecisionSource } from "@extynt/decide";

/** The file the decision log lives in, inside the sidecar's state directory. */
export const DECISION_LOG_FILE = "decision-log.jsonl";

const MAX_LOG_BYTES = 1_000_000;

type DecisionMoment = "job-open" | "build-kit" | "completion" | "review" | "frame-gate" | "cycle-end" | "continuation" | "question-answered";

/** Where a decision was asked: its moment and the job it belongs to, null when the caller has no job id at hand; `image` is the frame the questions that want one may look at, and is never recorded; `signal` cancels the requests still waiting. */
export interface DecisionSite {
  readonly moment: DecisionMoment;
  readonly jobId: string | null;
  readonly image?: DecisionImage;
  readonly signal?: AbortSignal;
}

/** One settled decision as the log records it; `questions` counts the questions the call sent and `image` says whether a picture went with them; `model` is the model the answer came from and `inputTokens` the input tokens of the model call, carried by the first row of that call only (null on the rest and on the deterministic tier); no request text and no image bytes are ever recorded. */
export interface DecisionLogRow {
  readonly at: string;
  readonly decision: string;
  readonly moment: DecisionMoment;
  readonly jobId: string | null;
  readonly questions: number;
  readonly image: boolean;
  readonly tier: DecisionSource;
  readonly provider: string | null;
  readonly answer: string;
  readonly confidence: number;
  readonly band: Band | null;
  readonly abstained: boolean;
  readonly fallback: string | null;
  readonly latencyMs: number;
  readonly model: string | null;
  readonly inputTokens: number | null;
}

/** Where settled decisions are recorded; a log that cannot be written is silent, because a decision never waits on its record. */
export interface DecisionLog {
  record(rows: ReadonlyArray<DecisionLogRow>): void;
}

function rotateIfLarge(path: string): void {
  try {
    if (statSync(path).size >= MAX_LOG_BYTES) renameSync(path, `${path}.1`);
  } catch {
    return;
  }
}

/** A log that appends JSON lines to the decision log file of a state directory, owner-only, keeping one rotated generation. */
export function fileDecisionLog(directory: string): DecisionLog {
  const path = join(directory, DECISION_LOG_FILE);
  return {
    record(rows) {
      try {
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        rotateIfLarge(path);
        appendFileSync(path, rows.map((row) => `${JSON.stringify({ schemaVersion: "extynt.decision-log/0.1", ...row })}\n`).join(""), { encoding: "utf8", mode: 0o600 });
      } catch {
        return;
      }
    },
  };
}
