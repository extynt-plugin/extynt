/**
 * The plan list: statuses read from the sidecar, the one-line folds in this chat kept in step with them, and the plans
 * waiting for the reader (the status bar holds their buttons, the sheet their detail). Nothing polls: the sidecar's change
 * events ask for a read.
 */
import { hooks } from "./panel-hooks.js";
import { onLanguageChange, t } from "./panel-language.js";
import { mcpCall } from "./panel-mcp.js";
import { undoPlan } from "./panel-plan-actions.js";
import { syncPlanCards } from "./panel-plan-fold.js";
import { isActionable } from "./panel-plan-labels.js";
import { knownStatus, recordDropReason, setPlanFacts, setPlanStatus } from "./panel-plan-state.js";
import { getCurrentSessionId, saveTranscript, writingSession, writingTranscript } from "./panel-sessions.js";
import type { SessionId } from "./ids.js";
import { touchStatus } from "./panel-status-signal.js";
import { planListDecoder } from "./plan-list.js";
import type { PlanListRow } from "./plan-list.js";
import type { PlanUpdate } from "./plan-content.js";
import type { PlanCard, PlanRow, TranscriptRow } from "./transcript.js";
import type { OnReply } from "./panel-transport.js";

/** A plan an outside agent or this chat has proposed that still needs the reader's Apply. */
export interface WaitingPlan {
  readonly planId: string;
  readonly title: string;
  readonly source: string;
  readonly external: boolean;
  readonly updatedAt: string | null;
  readonly card: PlanCard;
}

const LIST_LIMIT = 20;

let waiting: WaitingPlan[] = [];
let loading = false;
let again = false;
let listed = new Map<string, PlanListRow>();
let wanted: ReadonlyArray<string> = [];
let wantedFor: SessionId | null = null;
const waitingListeners: Array<() => void> = [];

/** The plans waiting for the reader's Apply. */
export function waitingPlans(): WaitingPlan[] {
  return waiting;
}

/** Calls the listener whenever the set of waiting plans may have changed. */
export function onWaitingChanged(listener: () => void): void {
  waitingListeners.push(listener);
}

function titleOf(row: PlanListRow): string {
  return row.presentation?.title || row.summary || row.planId;
}

type CardContent = Pick<PlanCard, "rows" | "notices" | "warnings" | "expressions" | "requiresAcknowledgement">;

const NO_CONTENT: CardContent = { rows: [], notices: [], warnings: [], expressions: [], requiresAcknowledgement: false };

function contentOf(presentation: PlanListRow["presentation"]): CardContent {
  if (!presentation) return NO_CONTENT;
  return {
    rows: presentation.values,
    notices: presentation.notices,
    warnings: presentation.warnings,
    expressions: presentation.expressions,
    requiresAcknowledgement: presentation.verification?.requiresAcknowledgement === true,
  };
}

function cardOf(row: PlanListRow): PlanCard {
  return { planId: row.planId, text: titleOf(row), status: row.status, operations: [], ...contentOf(row.presentation) };
}

function planRowIn(home: ReadonlyArray<TranscriptRow>, planId: string): PlanRow | null {
  for (let index = home.length - 1; index >= 0; index -= 1) {
    const entry = home[index];
    if (entry !== undefined && entry.kind === "plan" && entry.planId === planId) return entry;
  }
  return null;
}

function statusFor(planId: string, incoming: string): string {
  const settled = knownStatus(planId);
  return settled && settled !== "draft" && !isActionable(settled) && isActionable(incoming) ? settled : incoming;
}

/** A plan card from the final reply of a turn: new, or the newer facts for a card already drawn. */
export function upsertPlanMessage(plan: PlanUpdate): void {
  const status = statusFor(plan.planId, plan.status ?? "prepared");
  setPlanStatus(plan.planId, status);
  const title = plan.title ?? plan.text ?? plan.planId;
  const fields = {
    planId: plan.planId,
    rows: plan.rows,
    operations: plan.operations,
    notices: plan.notices,
    warnings: plan.warnings,
    expressions: plan.expressions,
    requiresAcknowledgement: plan.requiresAcknowledgement,
    status,
  };
  const existing = planRowIn(writingTranscript(), plan.planId);
  if (!existing) {
    hooks.addRow({ kind: "plan", text: title, ...fields });
    touchStatus();
    return;
  }
  Object.assign(existing, fields, { text: title });
  saveTranscript();
  syncPlanCards();
  touchStatus();
}

/** A plan's facts wherever they are held: its row in this chat, else the plan list's row, else nothing. */
export function planMessageFor(planId: string): PlanCard | null {
  const held = planRowIn(writingTranscript(), planId);
  if (held) return held;
  const row = listed.get(planId);
  return row ? cardOf(row) : null;
}

function writingId(): SessionId | null {
  return writingSession()?.id ?? getCurrentSessionId();
}

/** Draws a card, in the chat, for each of these plans that has none. A plan the list has not shown yet is drawn when it does, and only in the chat that asked: another chat never gets them. */
export function landPlans(planIds: ReadonlyArray<string>): void {
  if (planIds !== wanted) wantedFor = writingId();
  wanted = planIds;
  if (wantedFor !== writingId()) return;
  planIds.forEach((planId) => {
    const row = listed.get(planId);
    if (row && !planRowIn(writingTranscript(), planId)) upsertPlanMessage(cardOf(row));
  });
}

function applyListRows(rows: ReadonlyArray<PlanListRow>): void {
  rows.forEach((row) => {
    setPlanStatus(row.planId, row.status);
    if (row.droppedBecause) recordDropReason(row.planId, row.droppedBecause);
    setPlanFacts(row.planId, { mayHaveMutated: row.mayHaveMutated, postcondition: row.postcondition, updatedAt: row.updatedAt, visual: row.visual });
  });
  syncPlanCards();
}

function sourceOf(row: PlanListRow): string {
  if (!row.source || row.source === "agent") return t("plans.source.anAgent");
  if (row.source === "panel") return "extynt";
  return row.source;
}

function readWaiting(rows: ReadonlyArray<PlanListRow>): void {
  const actionable = rows.filter((row) => isActionable(row.status) && !row.variantSetId && !row.approvalExpired);
  waiting = actionable.map((row) => ({
    planId: row.planId,
    title: titleOf(row),
    source: sourceOf(row),
    external: row.source !== "panel",
    updatedAt: row.updatedAt,
    card: cardOf(row),
  }));
}

const handleList: OnReply<ReadonlyArray<PlanListRow>> = (reply) => {
  loading = false;
  if (!reply.ok) return;
  listed = new Map(reply.value.map((row) => [row.planId, row]));
  applyListRows(reply.value);
  landPlans(wanted);
  readWaiting(reply.value);
  waitingListeners.forEach((listener) => listener());
  touchStatus();
  if (again) {
    again = false;
    refreshPlans();
  }
};

/** Reads the plan list; a read already running is followed by one more, so what is drawn is never older than the last ask. */
export function refreshPlans(): void {
  if (loading) {
    again = true;
    return;
  }
  loading = true;
  mcpCall({ name: "ae_list_plans", args: { limit: LIST_LIMIT }, data: planListDecoder, polling: true }, handleList);
}

/** The Changes list's Undo: the card's own undo, every group the plan has left. */
export function undoChange(planId: string, done: (problem: string | null) => void): void {
  undoPlan(planId, "all", (problem) => {
    done(problem);
    refreshPlans();
  });
}

onLanguageChange(() => {
  readWaiting(Array.from(listed.values()));
  waitingListeners.forEach((listener) => listener());
  syncPlanCards();
  touchStatus();
});
