// The hooks the receipt, undo and snapshot paths call: learning is a side effect of settled work, so a failure here is logged and never propagates.
import type { StoredPlan, StoredReceipt } from "@extynt/mcp-server";
import type { ProjectSnapshot } from "@extynt/project-graph";
import type { EffectNotesService } from "./effect-notes-service.js";
import { learnKeptFromReceipt } from "./effect-notes-learn-kept.js";
import { learnSeenFromSnapshot } from "./effect-notes-learn-seen.js";

type FailureSink = (event: string, fields: { reason: string }) => void;

const REASON_LENGTH = 200;
let sink: FailureSink = (event, fields) => { process.stderr.write(`[extynt] ${event} ${JSON.stringify(fields)}\n`); };

function quietly(work: () => void): void {
  try {
    work();
  } catch (error) {
    try {
      sink("effect-notes.learn-failed", { reason: (error instanceof Error ? error.message : String(error)).slice(0, REASON_LENGTH) });
    } catch {
      return;
    }
  }
}

/** Where a learning failure is written: the sidecar's event log once it is up (the last sidecar started wins), stderr before. */
export function reportLearningFailuresTo(next: FailureSink): void {
  sink = next;
}

/** A plan's apply receipt was accepted: record what a verified plan kept. */
export function learnFromApplyReceipt(notes: EffectNotesService, input: { record: StoredPlan | undefined; receipt: StoredReceipt }): void {
  quietly(() => learnKeptFromReceipt(notes, input));
}

/** An undo receipt was accepted. Only when it succeeded and every undo group of a known plan has run is the plan taken back, so only then is its contribution removed; a partial undo leaves it as it was. */
export function forgetUndonePlanUsage(notes: EffectNotesService, undo: { planId: string; known: boolean; status: string; finished: boolean }): void {
  if (undo.known && undo.status === "executed" && undo.finished) quietly(() => { notes.unrecordPlanUsage(undo.planId); });
}

/** A project snapshot was accepted: record the effects and control values it shows. */
export function learnFromSnapshot(notes: EffectNotesService, snapshot: ProjectSnapshot): void {
  quietly(() => learnSeenFromSnapshot(notes, snapshot));
}
