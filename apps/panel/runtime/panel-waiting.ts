/**
 * What waits for the reader, as one list: a variant question, the step-cap pause, and every plan from any source that needs an
 * Apply. The status bar shows the one the stepper names and holds its buttons; the sheet shows the detail of all of them.
 * This module owns the presses (Apply, Discard, Continue, the variant confirm) so there is one code path for each.
 */
import { applyLabel, isActionable, planRowsOf, uncheckedCount } from "./panel-plan-labels.js";
import { approvePlan, discardPlan, type ApplyResult } from "./panel-plan-actions.js";
import { onWaitingChanged, planMessageFor, refreshPlans, waitingPlans, type WaitingPlan } from "./panel-plans.js";
import { prettyClient, type WaitingItem } from "./panel-bar.js";
import { approvalWaiting } from "./panel-approval.js";
import { pauseControl, watchPause, type PauseWatch, type WindowCapPause } from "./panel-pause.js";
import { pauseHeadline } from "./panel-pause-text.js";
import { knownStatus, pickedPlanIds, planStatusOf, setPlanStatus } from "./panel-plan-state.js";
import { syncPlanCards } from "./panel-plan-fold.js";
import { saveTranscript } from "./panel-sessions.js";
import { touchStatus } from "./panel-status-signal.js";
import { hooks } from "./panel-hooks.js";
import { onLanguageChange, t } from "./panel-language.js";
import { chooseVariant, openVariants, selectedCandidate } from "./panel-variants-view.js";
import { headline } from "./panel-variants.js";
import { uiState } from "./ui-state.js";
import type { PlanCard, TranscriptRow } from "./transcript.js";

interface WaitingDeps {
  readonly rows: () => ReadonlyArray<TranscriptRow>;
  readonly busy: () => boolean;
  readonly send: (jobId: string) => void;
  readonly approve: () => void;
  readonly announce: (pause: WindowCapPause) => void;
}

function ackLine(): string {
  return t("chat.waiting.ackLine");
}
const MAX_TITLE = 48;
const NO_ITEM: WaitingItem = { kind: "plan", id: "", title: "", prompt: "", detail: "", source: "", external: false, applyLabel: "", choiceLabel: "", busy: false, note: "" };

let wired: WaitingDeps = { rows: () => [], busy: () => false, send: () => undefined, approve: () => undefined, announce: () => undefined };
let watch: PauseWatch = { polled: false, seen: null };
let selected = "";
const working = new Map<string, string>();
const notes = new Map<string, string>();
const ackNeeded = new Set<string>();

function short(text: string): string {
  return text.length > MAX_TITLE ? text.slice(0, MAX_TITLE - 1) + "…" : text;
}

function planSummary(rows: ReadonlyArray<{ readonly label: string }>): string {
  const first = rows[0];
  if (!first) return "";
  return rows.length === 1 ? first.label : t("chat.waiting.andMoreChanges", { label: first.label, count: rows.length - 1 });
}

function holder(plan: WaitingPlan): string {
  const call = uiState().mcpCalls.find((entry) => entry.planIds.some((id) => id === plan.planId));
  return call ? prettyClient(call.client) : plan.source;
}

function cardOf(plan: WaitingPlan): PlanCard {
  return planMessageFor(plan.planId) ?? plan.card;
}

interface PlanItemFacts {
  readonly planId: string;
  readonly card: PlanCard;
  readonly title: string;
  readonly source: string;
  readonly external: boolean;
}

function planItemOf(facts: PlanItemFacts): WaitingItem {
  const { planId, card, title } = facts;
  const ack = card.requiresAcknowledgement || ackNeeded.has(planId);
  return {
    ...NO_ITEM,
    id: planId,
    title,
    prompt: t("chat.waiting.applyPrompt", { title: short(title) }),
    detail: planSummary(planRowsOf(card.rows, card.operations)),
    source: facts.source,
    external: facts.external,
    applyLabel: applyLabel(ack, uncheckedCount(card.notices)),
    busy: working.has(planId),
    note: working.get(planId) ?? notes.get(planId) ?? "",
  };
}

function planItem(plan: WaitingPlan): WaitingItem {
  const card = cardOf(plan);
  const source = plan.external ? holder(plan) : "extynt";
  return planItemOf({ planId: plan.planId, card, title: card.text || plan.title, source, external: plan.external });
}

function pickedItems(listed: ReadonlyArray<WaitingItem>): WaitingItem[] {
  return pickedPlanIds()
    .filter((planId) => isActionable(planStatusOf(planId)) && !listed.some((item) => item.id === planId))
    .flatMap((planId) => {
      const card = planMessageFor(planId);
      return card ? [planItemOf({ planId, card, title: card.text || planId, source: "extynt", external: false })] : [];
    });
}

function variantItems(): WaitingItem[] {
  return openVariants().map((entry) => ({
    ...NO_ITEM,
    kind: "variant" as const, id: entry.set.setId, title: headline(entry.set), prompt: headline(entry.set),
    detail: t("chat.waiting.optionsTiles", { count: entry.set.candidates.length }), choiceLabel: t("chat.waiting.useChoice", { label: selectedCandidate(entry).label }),
    busy: entry.sending, note: entry.noteTone === "bad" ? entry.note : "",
  }));
}

function pausedItem(): WaitingItem | null {
  const rows = wired.rows();
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    const pause = row && row.kind === "assistant" ? row.pause : null;
    if (!row || !pause) continue;
    if (pauseControl(rows, row, wired.busy()) !== "ready") return null;
    const title = pauseHeadline(pause);
    return { ...NO_ITEM, kind: "pause", id: pause.jobId, title, prompt: title, detail: t("chat.pause.continueDetail"), source: "extynt", busy: working.has(pause.jobId) };
  }
  return null;
}

const BRIEF_ID = "design-brief";

function briefItem(): WaitingItem[] {
  if (!approvalWaiting(wired.rows(), wired.busy())) return [];
  const title = t("chat.waiting.buildDesign");
  return [{ ...NO_ITEM, kind: "approval", id: BRIEF_ID, title, prompt: title, detail: t("chat.waiting.buildDesignDetail"), source: "extynt" }];
}

/** Everything waiting, in the order the bar steps through it: questions, the design brief, the pause, then plans. */
export function waitingItems(): WaitingItem[] {
  const pause = pausedItem();
  const plans = waitingPlans().map(planItem);
  return [...variantItems(), ...briefItem(), ...(pause ? [pause] : []), ...plans, ...pickedItems(plans)];
}

/** The index the bar's buttons act on. */
export function waitingAt(items: ReadonlyArray<WaitingItem>): number {
  const at = items.findIndex((item) => item.id === selected);
  return at >= 0 ? at : 0;
}

/** Moves the bar to the next waiting item. */
export function stepWaiting(): void {
  const items = waitingItems();
  const next = items[(waitingAt(items) + 1) % items.length];
  if (items.length < 2 || !next) return;
  selected = next.id;
  touchStatus();
}

function settledStatus(planId: string): boolean {
  const known = knownStatus(planId);
  return known !== null && !isActionable(known) && known !== "approved";
}

function afterApply(planId: string, status: string): void {
  const card = planMessageFor(planId);
  if (card) {
    card.status = status;
    card.result = null;
    saveTranscript();
  }
  hooks.refreshPlans();
  hooks.refreshChanges();
}


function settleApply(planId: string, result: ApplyResult): void {
  working.delete(planId);
  if (result.kind === "needs-acknowledgement") {
    ackNeeded.add(planId);
    setPlanStatus(planId, "prepared");
    notes.set(planId, ackLine());
  } else if (result.kind === "refused") {
    if (!settledStatus(planId)) {
      setPlanStatus(planId, "prepared");
      notes.set(planId, t("chat.waiting.couldntApply", { reason: result.message }));
    }
  } else afterApply(planId, result.status);
  syncPlanCards();
  touchStatus();
  refreshPlans();
}

/** Applies the plan the bar names, asking for the acknowledgement it needs. */
export function applyItem(item: WaitingItem): void {
  if (item.kind !== "plan" || working.has(item.id)) return;
  const planId = item.id;
  const plan = waitingPlans().find((entry) => entry.planId === planId);
  const card = plan ? cardOf(plan) : planMessageFor(planId);
  working.set(planId, t("chat.waiting.applying"));
  notes.delete(planId);
  setPlanStatus(planId, "approved");
  syncPlanCards();
  touchStatus();
  approvePlan(planId, ackNeeded.has(planId) || card?.requiresAcknowledgement === true, (result) => settleApply(planId, result));
}

/** Discards the plan the bar names. */
export function discardItem(item: WaitingItem): void {
  if (item.kind !== "plan" || working.has(item.id)) return;
  const planId = item.id;
  working.set(planId, t("chat.waiting.discarding"));
  notes.delete(planId);
  touchStatus();
  discardPlan(planId, (problem) => {
    working.delete(planId);
    const card = planMessageFor(planId);
    if (problem) notes.set(planId, problem);
    else if (card) {
      card.status = "cancelled";
      saveTranscript();
    }
    syncPlanCards();
    touchStatus();
    refreshPlans();
  });
}

/** Sends the continuation of the paused job. */
export function continueItem(item: WaitingItem): void {
  if (item.kind !== "pause" || wired.busy()) return;
  wired.send(item.id);
}

/** Approves the design brief the newest reply shows. */
export function approveBrief(item: WaitingItem): void {
  if (item.kind !== "approval" || wired.busy()) return;
  wired.approve();
}

/** Confirms the option the variant question has selected. */
export function useVariant(item: WaitingItem): void {
  if (item.kind !== "variant") return;
  const entry = openVariants().find((candidate) => candidate.set.setId === item.id);
  if (entry) chooseVariant(item.id, selectedCandidate(entry).index);
}

/** Declines every option of the variant question. */
export function declineVariant(item: WaitingItem): void {
  if (item.kind === "variant") chooseVariant(item.id, "none");
}

/** Reads each workflow status answer: a job that stopped at the cap in the background gets its line in the thread. */
export function observeWorkflowPause(reported: WindowCapPause | null): void {
  const outcome = watchPause(watch, reported, { busy: wired.busy(), shown: wired.rows() });
  watch = outcome.watch;
  if (outcome.announce) wired.announce(outcome.announce);
  touchStatus();
}

/** Gives the waiting list its rows, its busy test, its continue action and its announcement, and follows plan changes. */
export function wireWaiting(deps: WaitingDeps): void {
  wired = deps;
  onWaitingChanged(touchStatus);
  onLanguageChange(touchStatus);
}
