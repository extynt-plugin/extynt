// Where the queue stands: which plan it holds, whether that plan is still editable, and the checkpoint a refused call is rolled back to.
import type { ProjectSnapshot } from "@extynt/project-graph";
import type { StoredPlan, ToolContext } from "./contracts.js";
import { asObject, stringAt } from "./json.js";
import { planOperationCount } from "./plan-coherence.js";
import { createPlan } from "./plan-create.js";
import { now } from "./plan-store.js";
import { toolError } from "./tool-result.js";
import type { ToolBase, ToolFailure } from "./tool-result.js";

/** The group the queue last took in, kept so a resend of the same call is recognised. */
export type QueuedGroup = NonNullable<StoredPlan["lastQueuedGroup"]>;

const EDITABLE = new Set<string>(["draft", "prepared", "presented"]);

/** The plan the queue holds while it can still be edited, or an empty string. */
export function queuePlanId(context: ToolContext): string {
  const held = context.queue?.planId ?? "";
  const record = held ? context.plans?.get(held) : undefined;
  return record && EDITABLE.has(record.status) ? held : "";
}

function closedBatchSentence(record: StoredPlan | undefined): string {
  if (!record) return "Your earlier batch is no longer held (it was dropped), so nothing from it is queued; the next ae_queue_add opens a new batch.";
  const { status } = record;
  const what = status === "cancelled" ? "cancelled before it applied, so nothing from it was applied"
    : status === "failed" ? "refused or failed when it applied, so read the receipt before sending its work again"
    : status === "approved" || status === "applying" ? "already sealed and is being applied"
    : "already sealed and applied";
  return `Your earlier batch was ${what} (plan ${record.plan.planId}). It is closed and nothing is left in the queue; the next ae_queue_add opens a new batch.`;
}

/** Clears the queue's pointer when its plan stopped being editable, and says what happened to that batch so the next call never meets the same dead plan twice. */
export function retireClosedQueue(context: ToolContext): string | undefined {
  const held = context.queue?.planId ?? "";
  if (!held) return undefined;
  const record = context.plans?.get(held);
  if (record && EDITABLE.has(record.status)) return undefined;
  context.queue?.set(null);
  return closedBatchSentence(record);
}

/** Cancels a draft queue written against an earlier project and returns the refusal that says so; a current queue gives `undefined`. */
export function closeStaleQueue(snapshot: ProjectSnapshot, context: ToolContext): ToolFailure | undefined {
  const planId = queuePlanId(context);
  const record = planId ? context.plans?.get(planId) : undefined;
  if (!record || record.status !== "draft" || record.plan.snapshotFingerprint === snapshot.fingerprint) return undefined;
  const held = planOperationCount(record);
  record.status = "cancelled";
  record.updatedAt = now(context).toISOString();
  context.queue?.set(null);
  return toolError("STALE_SNAPSHOT", staleMessage(held));
}

function staleMessage(held: number): string {
  return `The project changed after this queue was opened, so the ${held} operation${held === 1 ? "" : "s"} it held (written against the earlier project) ${held === 1 ? "was" : "were"} discarded; nothing from it was applied, and this call queued nothing. The queue is closed: call ae_queue_add again and it opens a new queue against the current project (call ae_refresh_snapshot first if you need to see what changed).`;
}

/** Puts the plan back to the copy taken before a call staged anything. */
export function restoreCheckpoint(context: ToolContext, planId: string, checkpoint: StoredPlan | undefined): void {
  if (checkpoint) context.plans?.set(planId, structuredClone(checkpoint));
}

/** How many operations the queued plan holds now. */
export function queuedCount(context: ToolContext, planId: string): number {
  const record = context.plans?.get(planId);
  return record ? planOperationCount(record) : 0;
}

/** The earlier group when this call is exactly that group sent again, otherwise `null`. */
export function duplicateGroup(record: StoredPlan | undefined, before: number, signature: string): QueuedGroup | null {
  const prior = record?.lastQueuedGroup;
  return prior && prior.signature === signature && prior.queued === before ? prior : null;
}

/** The queue's plan, opening a new one for this call when none is held. */
export function openQueuedPlan(base: ToolBase, snapshot: ProjectSnapshot, summary: string, context: ToolContext): string | ToolFailure {
  const held = queuePlanId(context);
  if (held) return held;
  const opened = createPlan(base, snapshot, { summary }, context);
  if (!opened.ok) return opened;
  const planId = stringAt(asObject(opened.data), "planId");
  if (!planId) return toolError("QUEUE_UNAVAILABLE", "The queue could not be opened; nothing was queued.");
  context.queue?.set(planId);
  return planId;
}
