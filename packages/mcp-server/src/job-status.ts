// Where one logical job stands: its batches, how many the host executed, how many failed, and what remains to apply and to undo.
import type { PlanStatus, StoredPlan, ToolContext } from "./contracts.js";
import type { JsonObject } from "@extynt/decode";
import { receiptOf, receiptStatusOf, receivedAtOf, undoGroupsOf, undoneGroupsOf } from "./stored-receipt.js";

const IN_FLIGHT_JOB_STATUSES: ReadonlySet<PlanStatus> = new Set<PlanStatus>(["approved", "applying", "undo_requested"]);
const LINE_TITLE_CHARS = 60;

type BatchOutcome = "applied" | "failed" | "not-applied" | "cancelled" | "in-flight";

/** Where one logical job stands; there is no total batch count, because a job ends when the agent stops adding to it. */
export type JobStatus = {
  readonly id: string;
  readonly title: string;
  readonly batches: number;
  readonly applied: number;
  readonly failed: number;
  readonly notApplied: number;
  readonly cancelled: number;
  readonly inFlight: number;
  readonly undone: number;
  readonly toUndo: string[];
  readonly toApply: string[];
  readonly undoOrderBasis: "apply-time" | "creation-order";
  readonly remainingUndoGroups: number;
  readonly line: string;
};

type Outcomes = ReadonlyMap<StoredPlan, BatchOutcome>;

/** How one batch ended, read from the receipt the panel posted: the plan's status cannot tell a host that refused before writing from one that died part-way. */
export function batchOutcome(record: StoredPlan): BatchOutcome {
  if (IN_FLIGHT_JOB_STATUSES.has(record.status)) return "in-flight";
  const receipt = receiptOf(record);
  if (!receipt) return record.status === "cancelled" ? "cancelled" : "not-applied";
  return receiptStatusOf(receipt) === "executed" ? "applied" : "failed";
}

/** The batches of one job, oldest first. */
export function jobBatches(context: ToolContext, jobId: string): StoredPlan[] {
  return [...(context.plans?.values() ?? [])].filter((record) => record.jobId === jobId);
}

/** How many undo groups a batch's apply produced that are not yet undone. */
export function batchUndoRemaining(record: StoredPlan): number {
  const groups = undoGroupsOf(receiptOf(record));
  return Math.max(0, groups - Math.min(groups, undoneGroupsOf(record)));
}

function batchFullyUndone(record: StoredPlan): boolean {
  return record.status === "undone" || (record.undo !== undefined && record.undo.undone >= record.undo.groups);
}

function count(records: readonly StoredPlan[], outcomes: Outcomes, value: BatchOutcome): number {
  return records.filter((record) => outcomes.get(record) === value).length;
}

function outstandingGroups(record: StoredPlan, outcomes: Outcomes): number {
  return outcomes.get(record) === "applied" && !batchFullyUndone(record) ? batchUndoRemaining(record) : 0;
}

interface UndoOrder {
  readonly ordered: StoredPlan[];
  readonly byApplyTime: boolean;
}

function undoOrderOf(records: readonly StoredPlan[], outcomes: Outcomes): UndoOrder {
  const undoable = records.filter((record) => outcomes.get(record) === "applied" && !batchFullyUndone(record) && batchUndoRemaining(record) > 0);
  const stamped = undoable.flatMap((record) => {
    const time = receivedAtOf(receiptOf(record));
    return time === undefined ? [] : [{ record, time }];
  });
  if (stamped.length !== undoable.length) return { ordered: [...undoable].reverse(), byApplyTime: false };
  return { ordered: stamped.sort((left, right) => right.time - left.time).map((entry) => entry.record), byApplyTime: true };
}

function plural(value: number, one: string, many: string): string {
  return `${value} ${value === 1 ? one : many}`;
}

function countParts(records: readonly StoredPlan[], outcomes: Outcomes): string[] {
  const undone = records.filter(batchFullyUndone).length;
  const optional: ReadonlyArray<[number, string]> = [
    [count(records, outcomes, "failed"), "failed"],
    [count(records, outcomes, "not-applied"), "not applied"],
    [count(records, outcomes, "cancelled"), "cancelled"],
    [count(records, outcomes, "in-flight"), "applying now"],
    [undone, "since undone"],
  ];
  return [`${count(records, outcomes, "applied")} applied`, ...optional.filter(([total]) => total > 0).map(([total, label]) => `${total} ${label}`)];
}

interface JobLineInput {
  readonly jobId: string;
  readonly records: readonly StoredPlan[];
  readonly outcomes: Outcomes;
  readonly remainingUndoGroups: number;
  readonly toApply: readonly string[];
  readonly ordered: readonly StoredPlan[];
}

function jobLine({ jobId, records, outcomes, remainingUndoGroups, toApply, ordered }: JobLineInput): string {
  const title = records[0]?.plan.summary ?? "";
  const shown = title.length > LINE_TITLE_CHARS ? `${title.slice(0, LINE_TITLE_CHARS - 3)}...` : title;
  const outstanding = remainingUndoGroups ? `; ${plural(remainingUndoGroups, "undo group", "undo groups")} outstanding` : "";
  const nextApply = toApply[0] === undefined ? "" : ` Next to apply: ${toApply[0]}.`;
  const nextUndo = ordered[0] === undefined ? "" : ` Next to undo: ${ordered[0].plan.planId}.`;
  return `Job ${jobId}${title ? ` “${shown}”` : ""}: ${plural(records.length, "batch", "batches")} — ${countParts(records, outcomes).join(", ")}${outstanding}.${nextApply}${nextUndo}`;
}

/** Where a job stands; every number is derived from the stored records and their receipts. */
export function jobStatus(context: ToolContext, jobId: string): JobStatus {
  const records = jobBatches(context, jobId);
  const outcomes: Outcomes = new Map(records.map((record) => [record, batchOutcome(record)]));
  const toApply = records.filter((record) => outcomes.get(record) === "not-applied").map((record) => record.plan.planId);
  const undo = undoOrderOf(records, outcomes);
  const remainingUndoGroups = records.reduce((total, record) => total + outstandingGroups(record, outcomes), 0);
  return {
    id: jobId,
    title: records[0]?.plan.summary ?? "",
    batches: records.length,
    applied: count(records, outcomes, "applied"),
    failed: count(records, outcomes, "failed"),
    notApplied: count(records, outcomes, "not-applied"),
    cancelled: count(records, outcomes, "cancelled"),
    inFlight: count(records, outcomes, "in-flight"),
    undone: records.filter(batchFullyUndone).length,
    toUndo: undo.ordered.map((record) => record.plan.planId),
    toApply,
    undoOrderBasis: undo.byApplyTime ? "apply-time" : "creation-order",
    remainingUndoGroups,
    line: jobLine({ jobId, records, outcomes, remainingUndoGroups, toApply, ordered: undo.ordered }),
  };
}

/** The job a batch belongs to, in the one shape every plan-tool result carries it. */
export function jobFields(record: StoredPlan, context: ToolContext): JsonObject {
  return record.jobId ? { jobId: record.jobId, job: jobStatus(context, record.jobId) } : {};
}
