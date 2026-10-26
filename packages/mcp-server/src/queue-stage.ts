// Staging a queue call into its plan: in chunks the host can undo as one group each, and, when some operations are refused, the independent rest on their own.
import { PLAN_UNDO_BATCH_SIZE } from "@extynt/host-ae";
import type { ProjectSnapshot } from "@extynt/project-graph";
import type { OperationVerdict } from "./batch.js";
import type { ToolContext } from "./contracts.js";
import type { JsonArray } from "@extynt/decode";
import { stageBatch } from "./plan-add.js";
import { stagePartially } from "./queue-partial.js";
import type { PartialOutcome } from "./queue-partial.js";
import { restoreCheckpoint } from "./queue-state.js";
import { inQueueVocabulary, queueVocabulary } from "./queue-words.js";
import type { StoredPlan } from "./contracts.js";
import type { ToolFailure } from "./tool-result.js";

/** Where a queue call is staged: the project, the queue's plan, and the context holding the plan store. */
export interface StageScope {
  readonly snapshot: ProjectSnapshot;
  readonly planId: string;
  readonly context: ToolContext;
}

/** What staging a call produced: every operation's verdict, the notes, and the first chunk that was refused or failed. */
export interface Staged {
  readonly verdicts: OperationVerdict[];
  readonly notes: string[];
  readonly failure: ToolFailure | null;
  readonly failedFrom: number;
  readonly failedChunk: number;
}

function shifted(verdict: OperationVerdict, offset: number): OperationVerdict {
  return {
    ...verdict,
    index: verdict.index + offset,
    ...(verdict.consequenceOf === undefined ? {} : { consequenceOf: verdict.consequenceOf + offset }),
  };
}

/** Stages the operations chunk by chunk and stops at the first chunk that is refused or fails, so the caller can roll the whole call back. */
export function stageChunks(scope: StageScope, operations: JsonArray): Staged {
  const verdicts: OperationVerdict[] = [];
  const notes: string[] = [];
  for (let offset = 0; offset < operations.length; offset += PLAN_UNDO_BATCH_SIZE) {
    const chunk = operations.slice(offset, offset + PLAN_UNDO_BATCH_SIZE);
    const staged = stageBatch(scope.snapshot, { planId: scope.planId, operations: chunk }, scope.context);
    if ("error" in staged) return { verdicts, notes, failure: inQueueVocabulary(staged), failedFrom: offset, failedChunk: chunk.length };
    notes.push(...staged.notes.map(queueVocabulary));
    verdicts.push(...staged.verdicts.map((verdict) => shifted(verdict, offset)));
    if (staged.verdicts.some((verdict) => verdict.status === "rejected")) return { verdicts, notes, failure: null, failedFrom: offset, failedChunk: chunk.length };
  }
  return { verdicts, notes, failure: null, failedFrom: 0, failedChunk: 0 };
}

/** Rolls the plan back to the checkpoint and stages every operation that does not depend on a refused one; `undefined` when partial staging is unsafe. */
export function stageIndependent(scope: StageScope, operations: JsonArray, first: readonly OperationVerdict[], checkpoint: StoredPlan | undefined): PartialOutcome | undefined {
  if (!checkpoint) return undefined;
  return stagePartially({
    operations,
    first,
    restore: () => restoreCheckpoint(scope.context, scope.planId, checkpoint),
    stage: (subset) => {
      const staged = stageChunks(scope, subset);
      return { verdicts: staged.verdicts, notes: staged.notes, failed: staged.failure !== null };
    },
  });
}
