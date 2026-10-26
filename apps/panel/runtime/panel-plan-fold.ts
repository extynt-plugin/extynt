/**
 * The thread keeps one line for a run of plans: "Batches 1–6 · 38 ops · verified", with a pill for any that applied only
 * partly. Everything else about a plan follows its state, not its place: a held plan's detail is in the sheet's Waiting
 * section (and its buttons in the status bar), a finished plan's detail and Undo are in the sheet's Changes. The line only
 * opens the sheet.
 */
import { chatOutput, el } from "./panel-dom.js";
import { hooks } from "./panel-hooks.js";
import { t } from "./panel-language.js";
import { planRowsOf } from "./panel-plan-labels.js";
import { planRunWords, type FoldFact } from "./panel-plan-run.js";
import { dropReasonOf, knownStatus, planFactsOf } from "./panel-plan-state.js";
import type { PlanCard } from "./transcript.js";

interface Fold {
  readonly node: HTMLElement;
  readonly plans: PlanCard[];
}

let folds: Fold[] = [];

function factOf(plan: PlanCard): FoldFact {
  const status = knownStatus(plan.planId) ?? plan.status ?? "prepared";
  const facts = planFactsOf(plan.planId);
  const rows = planRowsOf(plan.rows, plan.operations);
  return { status, operations: rows.length, partly: (status === "failed" && facts.mayHaveMutated) || status === "partially_undone", title: plan.text || plan.planId };
}

/** Forgets the lines of the old drawing when the transcript is redrawn from scratch. */
export function resetPlanFolds(): void {
  folds = [];
}

function paint(fold: Fold): void {
  const words = planRunWords(fold.plans.map(factOf));
  const dropped = fold.plans.map((plan) => dropReasonOf(plan.planId)).find(Boolean);
  const first = fold.plans[0];
  fold.node.textContent = "";
  fold.node.appendChild(el("span", "fold-text", words.text));
  if (dropped) fold.node.appendChild(el("span", "fold-note", dropped));
  if (words.partly > 0) fold.node.appendChild(el("span", "pill bad", t("plans.fold.partly", { count: words.partly })));
  fold.node.appendChild(el("span", "fold-more", "›"));
  if (first) fold.node.setAttribute("data-plan", first.planId);
  fold.node.setAttribute("aria-label", t("plans.fold.openLabel", { text: words.text }));
}

function drawFold(plans: PlanCard[]): Fold {
  const node = el("button", "msg plan-fold");
  node.type = "button";
  const fold: Fold = { node, plans };
  node.addEventListener("click", () => hooks.openSheet(fold.plans[fold.plans.length - 1]?.planId));
  paint(fold);
  folds.push(fold);
  return fold;
}

/** Appends one line for these consecutive plans to the transcript. */
export function appendPlanRun(plans: PlanCard[]): HTMLElement | null {
  if (!plans.length) return null;
  const fold = drawFold(plans);
  chatOutput.appendChild(fold.node);
  chatOutput.scrollTop = chatOutput.scrollHeight;
  return fold.node;
}

/** Adds a plan that arrives after the transcript was drawn to the line above it when that line is a run of plans. */
export function appendPlanToRun(plan: PlanCard): HTMLElement | null {
  const last = folds[folds.length - 1];
  if (last && last.node.parentNode === chatOutput && chatOutput.lastChild === last.node) {
    last.plans.push(plan);
    paint(last);
    return last.node;
  }
  return appendPlanRun([plan]);
}

/** Repaints every line from the plan facts and forgets those whose element left the page. */
export function syncPlanCards(): void {
  folds = folds.filter((fold) => !!fold.node.parentNode);
  folds.forEach(paint);
}
