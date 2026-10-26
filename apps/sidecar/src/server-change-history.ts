// The change history behind the panel's Changes list and its Undo buttons: which plans the host answered for, newest first, and whether undoing each is still safe.
import { batchUndoRemaining, checkPlanUndo, type StoredPlan } from "@extynt/mcp-server";
import { array, decodeOrThrow, fallback, type Infer, literal, number, string } from "@extynt/decode";
import type { Translate, UiKey } from "@extynt/ui-text";

import type { HostStamp, PlanSource } from "./host/facts.js";
import { ENGLISH_TEXT } from "./plan-text.js";
import { lenientObject } from "./server-mcp-arguments.js";
import { sameProject, type ProjectIdentity } from "./server-plan-store.js";

/** At most this many changes are listed; the newest come first. */
export const CHANGE_HISTORY_LIMIT = 50;

/** Whether Undo is offered for a change and, when it is not, the code and the sentence that say why. */
export type ChangeUndo = { available: true } | { available: false; code: string; reason: string };

/**
 * One change in the list. `mayHaveMutated` says whether anything may have reached After Effects (a failed change reads "Partly applied" rather than
 * "Didn't apply" when true); `undoGroupsRemaining` is how many After Effects undo groups it still has to take back; `files` are the files it wrote
 * outside the project (renders, saves, exports) that Undo cannot take back, bounded; `source` is who asked for it (the in-panel chat and its Apply
 * button, or an external agent; null for a plan recovered after a restart); `unseen` is applied after the changes were last marked seen; `jobId` is
 * the workflow job it is a batch of and `batch` the batch it became (the panel folds runs of verified batches by jobId and batch); `origin` is who
 * made it in the panel's words (`source` is the same fact without the designer).
 */
export interface ChangeEntry {
  planId: string;
  summary: string;
  appliedAt: string;
  operations: number;
  status: string;
  mayHaveMutated: boolean;
  undoGroupsRemaining: number;
  undo: ChangeUndo;
  files: Array<{ path: string; operation: string }>;
  source: PlanSource | null;
  unseen: boolean;
  jobId: string | null;
  batch: string | null;
  origin: "chat" | "mcp" | "designer" | null;
}

type ChangeHistory = { project: ProjectIdentity | null; changes: ChangeEntry[]; truncated: boolean; sinceLastSeen: number };

/**
 * What the history knows beyond the plans: who asked (`sources`), when the changes were last seen, where After Effects' revision stood after each
 * plan's apply (`afterStamps`) and stands now (`live`), the stamp the stored read of the project was taken at (`readAt`), the job and batch a plan
 * belongs to (`workflow`) and the plans the visual-scene designer built.
 */
export interface ChangeFacts {
  sources?: ReadonlyMap<string, PlanSource>;
  seenAt?: number;
  afterStamps?: ReadonlyMap<string, HostStamp>;
  live?: HostStamp | null;
  readAt?: HostStamp | null;
  workflow?: (planId: string) => { jobId: string | null; batch: string | null };
  designerPlans?: ReadonlySet<string>;
  translate?: Translate;
}

const LISTED_STATUSES = new Set(["applied", "applied_unverified", "verified", "partially_undone", "undone", "undo_requested", "undo_unverified", "failed"]);

type UndoKey = Extract<UiKey, `plan.undo.${string}`>;

const REFUSAL_REASONS = new Map<string, UndoKey>([
  ["UNDO_NOT_LATEST", "plan.undo.notLatest"],
  ["UNDO_PROJECT_CHANGED", "plan.undo.projectChanged"],
  ["SCOPED_UNDO_UNSUPPORTED", "plan.undo.scopedUnsupported"],
]);

const STATUS_REFUSALS = new Map<string, readonly [string, UndoKey]>([
  ["undone", ["ALREADY_UNDONE", "plan.undo.alreadyUndone"]],
  ["undo_requested", ["UNDO_IN_PROGRESS", "plan.undo.inProgress"]],
  ["undo_unverified", ["UNDO_UNCONFIRMED", "plan.undo.unconfirmed"]],
]);

const receiptFacts = lenientObject({
  receivedAt: fallback(string(), undefined),
  mayHaveMutated: fallback(literal(true), false),
  undoGroups: fallback(number(), undefined),
  afterFingerprint: fallback(string(), undefined),
});

const outputRows = fallback(array(lenientObject({ path: fallback(string(), undefined), operation: fallback(string(), undefined) })), undefined);

type ReceiptFacts = Infer<typeof receiptFacts>;

function receiptOf(record: StoredPlan): ReceiptFacts {
  return decodeOrThrow(receiptFacts, record.receipt);
}

function appliedTime(record: StoredPlan): number {
  const stamped = Date.parse(receiptOf(record).receivedAt ?? "");
  return Number.isFinite(stamped) ? stamped : Date.parse(record.updatedAt);
}

function unavailable(code: string, reason: string): ChangeUndo { return { available: false, code, reason }; }

function statusReason(record: StoredPlan, translate: Translate): ChangeUndo | null {
  const byStatus = STATUS_REFUSALS.get(record.status);
  if (byStatus) return unavailable(byStatus[0], translate(byStatus[1]));
  const receipt = receiptOf(record);
  if (!receipt.mayHaveMutated && record.status === "failed") return unavailable("NOTHING_CHANGED", translate("plan.undo.nothingChanged"));
  if (receipt.undoGroups === 0) return unavailable("NOTHING_CHANGED", translate("plan.undo.noUndoStep"));
  return null;
}

function changeUndo(record: StoredPlan, current: { fingerprint: string; plans: Map<string, StoredPlan> }, translate: Translate): ChangeUndo {
  const byStatus = statusReason(record, translate);
  if (byStatus) return byStatus;
  const check = checkPlanUndo(current.fingerprint, record, { plans: current.plans });
  if (check.ok) return { available: true };
  if (check.error.code === "UNDO_NOT_APPLICABLE" && /already been undone/.test(check.error.message)) return unavailable("ALREADY_UNDONE", translate("plan.undo.alreadyUndone"));
  return unavailable(check.error.code, translate(REFUSAL_REASONS.get(check.error.code) ?? "plan.undo.notUndoable"));
}

function moved(record: StoredPlan, facts: ChangeFacts): boolean {
  const after = facts.afterStamps?.get(record.plan.planId), live = facts.live;
  return !!after && !!live && after.epoch === live.epoch && after.revision !== live.revision;
}

function readIsCurrent(facts: ChangeFacts): boolean {
  const { readAt, live } = facts;
  return !!readAt && !!live && readAt.epoch === live.epoch && readAt.revision === live.revision;
}

function hasFingerprint(record: StoredPlan): boolean {
  return receiptOf(record).afterFingerprint !== undefined || typeof record.undo?.stateFingerprint === "string";
}

function liveUndo(record: StoredPlan, undo: ChangeUndo, facts: ChangeFacts): ChangeUndo {
  if (!undo.available || !moved(record, facts) || (readIsCurrent(facts) && hasFingerprint(record))) return undo;
  return unavailable("UNDO_PROJECT_CHANGED", (facts.translate ?? ENGLISH_TEXT)("plan.undo.projectChanged"));
}

function groupsLeft(record: StoredPlan): number {
  const receipt = receiptOf(record);
  const nothingToTakeBack = record.status === "undone" || receipt.undoGroups === 0 || (record.status === "failed" && !receipt.mayHaveMutated);
  return nothingToTakeBack ? 0 : batchUndoRemaining(record);
}

function workflowOf(record: StoredPlan, facts: ChangeFacts): { jobId: string | null; batch: string | null } {
  const found = facts.workflow?.(record.plan.planId);
  return { jobId: found?.jobId ?? record.jobId ?? null, batch: found?.batch ?? null };
}

function originOf(planId: string, facts: ChangeFacts): ChangeEntry["origin"] {
  if (facts.designerPlans?.has(planId)) return "designer";
  const source = facts.sources?.get(planId);
  return source === "panel" ? "chat" : source === "agent" ? "mcp" : null;
}

function filesOf(record: StoredPlan): ChangeEntry["files"] {
  const written = decodeOrThrow(outputRows, record.receipt?.externalOutputs) ?? [];
  return written.slice(0, 16).flatMap((row) => row.path === undefined ? [] : [{ path: row.path.slice(0, 1024), operation: row.operation?.slice(0, 64) ?? "unknown" }]);
}

function entryOf(record: StoredPlan, current: { fingerprint: string; plans: Map<string, StoredPlan> }, facts: ChangeFacts): ChangeEntry {
  const undo = liveUndo(record, changeUndo(record, current, facts.translate ?? ENGLISH_TEXT), facts);
  const appliedMs = appliedTime(record);
  return {
    planId: record.plan.planId,
    summary: record.plan.summary,
    appliedAt: new Date(appliedMs).toISOString(),
    operations: record.plan.operations.length,
    status: record.status,
    mayHaveMutated: receiptOf(record).mayHaveMutated,
    undoGroupsRemaining: groupsLeft(record),
    undo,
    files: filesOf(record),
    source: facts.sources?.get(record.plan.planId) ?? null,
    unseen: appliedMs > (facts.seenAt ?? 0),
    ...workflowOf(record, facts),
    origin: originOf(record.plan.planId, facts),
  };
}

function listed(record: StoredPlan, project: ProjectIdentity): boolean {
  return LISTED_STATUSES.has(record.status) && record.receipt !== undefined && sameProject(record.project, project);
}

/** What the agent changed in the open project, newest first and bounded, each with whether Undo is still safe. Read only. */
export function changeHistory(input: { plans: Map<string, StoredPlan>; project: ProjectIdentity | null; currentFingerprint: string | null; limit?: number; facts?: ChangeFacts }): ChangeHistory {
  const { plans, project, currentFingerprint } = input, limit = input.limit ?? CHANGE_HISTORY_LIMIT, facts = input.facts ?? {};
  if (!project || currentFingerprint === null) return { project: project ?? null, changes: [], truncated: false, sinceLastSeen: 0 };
  const records = [...plans.values()].filter((record) => listed(record, project)).sort((left, right) => appliedTime(right) - appliedTime(left));
  const changes = records.slice(0, limit).map((record) => entryOf(record, { fingerprint: currentFingerprint, plans }, facts));
  return { project: { name: project.name, filePath: project.filePath }, changes, truncated: records.length > limit, sinceLastSeen: changes.filter((change) => change.unseen).length };
}
