// What "done" means for a checklist: the completion gate, the items the model closes as unbuilt, the withheld-completion rule, and the sidecar reviewer's verdicts.
import type { WorkflowId } from "@extynt/workflow";
import type { JsonObject, JsonValue } from "@extynt/decode";
import {
  buildProgressOf, coveredBatches, itemStates, namedIds, nextOpen, openLabel, parseUnbuilt, CHECKLIST_NUDGE,
  type Checklist, type ChecklistItem, type ChecklistView, type ItemState, type ReviewState, type UnbuiltClaim,
} from "./server-workflow-checklist-model.js";
import { checklistOf, jobScale, persistChecklists, type SidecarActionHost } from "./server-workflow-sidecar-actions.js";

type ChecklistGate =
  | { code: "CHECKLIST_MISSING" | "CHECKLIST_INCOMPLETE"; message: string }
  | { code?: undefined; unbuilt: Array<{ id: string; title: string; reason: string }> };

type ReviewOutcome = { kind: "pass" } | { kind: "skipped"; reason: string } | { kind: "fix"; problems: string };

type ReviewVerdict = ReviewOutcome & { itemId: string };

/** Fix verdicts a review item may give before the sidecar closes it as unbuilt. */
export const MAX_FIX_ROUNDS = 2;

const LISTED_OPEN_MAX = 5;
const COMPLETION_OPEN_PERCENT = 80;
const REVIEW_NOTE_CHARS = 400;
const ONLY_WHEN_COMPLETE = "Only call this when every checklist item is built, or closed as unbuilt with a reason.";

interface UnbuiltOutcome { closed: string[]; refused: string[]; reviewClaims: string[]; unknown: string[] }

interface IncompleteInput { host: SidecarActionHost; checklist: Checklist; states: readonly ItemState[]; openStates: readonly ItemState[]; outcome: UnbuiltOutcome }

const MISSING_CHECKLIST = `CHECKLIST_MISSING: there is no checklist for this request. ${CHECKLIST_NUDGE}`;

function claimVerdict(state: ItemState | undefined): keyof UnbuiltOutcome | "ignored" {
  if (!state) return "unknown";
  if (state.status === "done") return "ignored";
  if (state.review) return "reviewClaims";
  return state.attempted ? "closed" : "refused";
}

function applyUnbuiltClaims(host: SidecarActionHost, checklist: Checklist, view: ChecklistView, claims: readonly UnbuiltClaim[]): UnbuiltOutcome {
  const before = new Map(itemStates(checklist, view).map((state) => [state.id, state]));
  const outcome: UnbuiltOutcome = { closed: [], refused: [], reviewClaims: [], unknown: [] };
  for (const claim of claims) {
    const verdict = claimVerdict(before.get(claim.id));
    if (verdict === "ignored") continue;
    outcome[verdict].push(claim.id);
    if (verdict === "closed") checklist.unbuilt[claim.id] = claim.reason;
  }
  if (outcome.closed.length) persistChecklists(host);
  return outcome;
}

function askAgain(checklist: Checklist, itemId: string): void {
  const review = checklist.reviews?.[itemId];
  if (review && review.rounds > 0) review.again = true;
}

function neverTriedNote(refused: readonly string[]): string {
  return refused.length ? ` Not closed as unbuilt, because no batch was attempted for them: ${refused.join(", ")}. Queue one with stage set to the id first.` : "";
}

function reviewNote(reviewCount: number, reviewClaims: readonly string[]): string {
  if (!reviewCount) return "";
  const unclosable = reviewClaims.length ? ` (not closable as unbuilt: ${reviewClaims.join(", ")})` : "";
  return ` Review items are closed only by the sidecar's reviewer, which runs between cycles and looks again at the work it flagged${unclosable}: build the open items and any fixes it reported, and do not try to build or close a review.`;
}

function incompleteGate(input: IncompleteInput): ChecklistGate {
  const { host, checklist, states, openStates } = input;
  const { refused, reviewClaims } = input.outcome;
  const open = openStates.map(openLabel);
  const reviews = openStates.filter((item) => item.review);
  for (const item of reviews) askAgain(checklist, item.id);
  if (reviews.length) persistChecklists(host);
  const tail = `${neverTriedNote(refused)}${reviewNote(reviews.length, reviewClaims)}`;
  const next = open.length > LISTED_OPEN_MAX ? nextOpen(checklist, states) : undefined;
  if (next) return { code: "CHECKLIST_INCOMPLETE", message: `CHECKLIST_INCOMPLETE: ${ONLY_WHEN_COMPLETE} ${open.length} of ${states.length} items are still open; the next one is ${next.id}: ${next.spec}. Build it now (queue with stage "${next.id}").${tail}` };
  const state = reviews.length ? "are not finished" : "have no verified batch";
  return { code: "CHECKLIST_INCOMPLETE", message: `CHECKLIST_INCOMPLETE: ${ONLY_WHEN_COMPLETE} ${open.length} of ${states.length} checklist items ${state}: ${namedIds(open)}. Build them (queue with stage set to the item id), or close an item you tried and could not build with ae_workflow_complete unbuilt:[{id, reason}].${tail}` };
}

function unbuiltItems(states: readonly ItemState[]): Array<{ id: string; title: string; reason: string }> {
  return states.flatMap((state) => (state.status === "unbuilt" ? [{ id: state.id, title: state.title, reason: state.reason }] : []));
}

/**
 * The completion check (free run): there must be a checklist, and every item either done or validly closed as unbuilt. A claim is valid for an item that is not
 * done and was attempted; a valid claim is kept, so a later call need not repeat it. A refusal also asks each pending review for another look.
 */
export function checklistGate(host: SidecarActionHost, jobId: WorkflowId, view: ChecklistView, claims: JsonValue | undefined): ChecklistGate {
  const checklist = checklistOf(host, jobId);
  if (!checklist) return jobScale(host, jobId) === "small" ? { unbuilt: [] } : { code: "CHECKLIST_MISSING", message: MISSING_CHECKLIST };
  const outcome = applyUnbuiltClaims(host, checklist, view, parseUnbuilt(claims));
  const states = itemStates(checklist, view);
  const openStates = states.filter((item) => item.status === "open");
  return openStates.length ? incompleteGate({ host, checklist, states, openStates, outcome }) : { unbuilt: unbuiltItems(states) };
}

/** Build items settled (done or closed unbuilt) out of all build items; undefined when the job has no checklist or no build item. */
export function buildProgress(host: SidecarActionHost, jobId: WorkflowId | undefined, view: ChecklistView): { settled: number; total: number } | undefined {
  const checklist = checklistOf(host, jobId);
  return checklist ? buildProgressOf(itemStates(checklist, view)) : undefined;
}

function completionOpen(progress: { settled: number; total: number }): boolean {
  return progress.settled * 100 >= progress.total * COMPLETION_OPEN_PERCENT;
}

/** Set while the model must not be offered ae_workflow_complete: a non-small job with a checklist whose build items are less than 80% settled (review items are outside the ratio). */
export function completionWithheld(host: SidecarActionHost, jobId: WorkflowId | undefined, view: ChecklistView): { settled: number; total: number; next?: string } | undefined {
  if (!jobId || jobScale(host, jobId) === "small") return undefined;
  const progress = buildProgress(host, jobId, view);
  if (!progress || completionOpen(progress)) return undefined;
  const checklist = checklistOf(host, jobId);
  const next = checklist ? nextOpen(checklist, itemStates(checklist, view))?.id : undefined;
  return { ...progress, ...(next ? { next } : {}) };
}

/** The refusal for a completion call made while the tool is withheld: the rule and nothing else, since a refusal that reports progress turns the call into a status check. */
export function completionWithheldMessage(): string {
  return `${ONLY_WHEN_COMPLETE} Keep building the checklist.`;
}

function refusedClaims(outcome: UnbuiltOutcome): Array<{ id: string; why: string }> {
  return [
    ...outcome.refused.map((id) => ({ id, why: "no batch was attempted for it; queue one with stage set to the id first" })),
    ...outcome.reviewClaims.map((id) => ({ id, why: "a review item is closed only by the sidecar's reviewer" })),
    ...outcome.unknown.map((id) => ({ id, why: "no such item" })),
  ];
}

function progressStatus(progress: { settled: number; total: number } | undefined): string {
  if (!progress) return "";
  return `${progress.settled} of ${progress.total} items built or closed${completionOpen(progress) ? "; completion is open" : ""}.`;
}

/** ae_workflow_unbuilt: closes the items the model tried and could not build, by the same rule completion applies. The completion threshold is never named: a model told where completion opens aims for the number instead of the work. */
export function closeUnbuilt(host: SidecarActionHost, jobId: WorkflowId, view: ChecklistView, claims: JsonValue | undefined): { ok: true; data: JsonObject } | { ok: false; code: string; message: string } {
  const checklist = checklistOf(host, jobId);
  if (!checklist) return { ok: false, code: "CHECKLIST_MISSING", message: MISSING_CHECKLIST };
  const parsed = parseUnbuilt(claims);
  if (!parsed.length) return { ok: false, code: "INVALID_UNBUILT", message: "Send items:[{id, reason}] for the items you tried and could not build." };
  const outcome = applyUnbuiltClaims(host, checklist, view, parsed);
  const refused = refusedClaims(outcome);
  const status = progressStatus(buildProgress(host, jobId, view));
  if (!outcome.closed.length) return { ok: false, code: "UNBUILT_REFUSED", message: `Nothing was closed. ${refused.map((row) => `${row.id}: ${row.why}`).join("; ")}. ${status}`.trim() };
  return { ok: true, data: { closed: outcome.closed, ...(refused.length ? { refused } : {}), progress: status } };
}

/** What an accepted completion reports for the items it closed as unbuilt. */
export function unbuiltAnswer(unbuilt: ReadonlyArray<{ id: string; title: string; reason: string }>): string {
  return unbuilt.length ? `Not built (${unbuilt.length}): ${unbuilt.map((item) => `${item.id} "${item.title}" because ${item.reason}`).join("; ")}.` : "";
}

function reviewOf(checklist: Checklist, itemId: string): ReviewState {
  const reviews = (checklist.reviews ??= {});
  return (reviews[itemId] ??= { rounds: 0, seen: 0 });
}

function recordFix(checklist: Checklist, view: ChecklistView, item: ChecklistItem, problems: string): boolean {
  const review = reviewOf(checklist, item.id);
  review.rounds += 1;
  review.seen = coveredBatches(checklist, view, item.covers ?? []).length;
  if (review.rounds < MAX_FIX_ROUNDS) return false;
  checklist.unbuilt[item.id] = `review: ${problems}`.slice(0, REVIEW_NOTE_CHARS);
  return true;
}

function applyVerdict(checklist: Checklist, view: ChecklistView, item: ChecklistItem, verdict: ReviewVerdict): boolean {
  const review = reviewOf(checklist, item.id);
  delete review.again;
  switch (verdict.kind) {
    case "pass":
      review.result = "pass";
      return false;
    case "skipped":
      review.result = "skipped";
      review.note = verdict.reason;
      return false;
    case "fix":
      return recordFix(checklist, view, item, verdict.problems);
    default:
      return verdict satisfies never;
  }
}

/** Records a review's verdict. A second fix verdict closes the item as unbuilt; `closed` is true then. */
export function recordReview(host: SidecarActionHost, jobId: WorkflowId, view: ChecklistView, verdict: ReviewVerdict): { closed: boolean } {
  const checklist = checklistOf(host, jobId);
  const item = checklist?.items.find((candidate) => candidate.id === verdict.itemId);
  if (!checklist || !item) return { closed: false };
  const closed = applyVerdict(checklist, view, item, verdict);
  persistChecklists(host);
  return { closed };
}
