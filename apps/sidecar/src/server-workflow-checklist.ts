/**
 * ADR 0044 rule 8: the model writes the whole request as a checklist before it builds, and that checklist is what "done" means. It lives on the job's
 * sidecar-action ledger (one place per job), is persisted beside the workflow handoffs, and is the sidecar's: the workflow engine fixes a job's criteria when it
 * opens and never sees these items. This module writes the list and reads it back as status lines and tool replies; the shapes are in the model module.
 */
import type { WorkflowId } from "@extynt/workflow";
import type { JsonObject, JsonValue } from "@extynt/decode";
import { briefToCheck, granularityRefusal, withoutOffBrief } from "./server-workflow-checklist-brief.js";
import {
  itemStates, MAX_CHECKLIST_ITEMS, nextOpen, nextSlices, parseChecklistItems, statusLineOf,
  type Checklist, type ChecklistItem, type ChecklistView,
} from "./server-workflow-checklist-model.js";
import { checklistOf, jobGoal, ledgerOf, persistChecklists, type SidecarActionHost } from "./server-workflow-sidecar-actions.js";

export { itemStates, parseChecklistItems, parseChecklists, requestScale, serializeChecklists, type Checklist, type ChecklistItem, type ChecklistView } from "./server-workflow-checklist-model.js";
export { checklistOf } from "./server-workflow-sidecar-actions.js";
export { noteQueueLabel, noteQueueRefusal, noteUnchangedQueue, recordSeal } from "./server-workflow-checklist-stage.js";

/** The next items' spec slices, with the status line, as one continuation or seal-reply text. */
export const NEXT_SLICE_CHARS = 2_500;

type ChecklistSet =
  | { ok: true; checklist: Checklist; added: string[]; kept: number; ignored: string[]; dropped?: string[]; gaps?: string[] }
  | { ok: false; message: string };

interface ChecklistWrite { readonly raw: JsonValue | readonly ChecklistItem[] | undefined; readonly planned?: boolean; readonly brief?: string }

interface SetInput { host: SidecarActionHost; jobId: WorkflowId; items: ChecklistItem[]; text: string | undefined; dropped: { dropped?: string[] } }

type Coarse = ReturnType<typeof granularityRefusal>;

const NEXT_INSTRUCTION = "Queue each item's batches with stage set to its id. Call ae_workflow_complete only when every item is done.";

function gapField(coarse: Coarse): { gaps?: string[] } {
  return typeof coarse === "object" && coarse.gaps.length ? { gaps: coarse.gaps.map((item) => item.id) } : {};
}

function firstChecklist(input: SetInput, ledger: ReturnType<typeof ledgerOf>): ChecklistSet {
  const { host, items: parsed } = input;
  if (parsed.length > MAX_CHECKLIST_ITEMS) return { ok: false, message: `At most ${MAX_CHECKLIST_ITEMS} items: group the smallest deliverables.` };
  const coarse = granularityRefusal(parsed, input.text);
  if (typeof coarse === "string") return { ok: false, message: coarse };
  const items = [...parsed, ...(coarse?.gaps ?? [])];
  const checklist: Checklist = { items, batchItems: {}, attempts: {}, unbuilt: {} };
  ledger.checklist = checklist;
  persistChecklists(host);
  return { ok: true, checklist, added: items.map((item) => item.id), kept: 0, ignored: [], ...input.dropped, ...gapField(coarse) };
}

function extendChecklist(input: SetInput, existing: Checklist): ChecklistSet {
  const { host, items: parsed } = input;
  const known = new Map(existing.items.map((item) => [item.id, item]));
  const fresh = parsed.filter((item) => !known.has(item.id));
  const ignored = parsed.filter((item) => {
    const title = known.get(item.id)?.title;
    return title !== undefined && title !== item.title;
  }).map((item) => item.id);
  if (existing.items.length + fresh.length > MAX_CHECKLIST_ITEMS) return { ok: false, message: `At most ${MAX_CHECKLIST_ITEMS} items in all.` };
  const coarse = fresh.length ? granularityRefusal([...existing.items, ...fresh], input.text) : undefined;
  if (typeof coarse === "string") return { ok: false, message: coarse };
  const added = [...fresh, ...(coarse?.gaps ?? [])];
  existing.items.push(...added);
  if (added.length) persistChecklists(host);
  return { ok: true, checklist: existing, added: added.map((item) => item.id), kept: existing.items.length - added.length, ignored, ...input.dropped, ...gapField(coarse) };
}

/** The first call sets the list; later calls add items. Nothing is removed or renamed, whatever a later call says. */
export function setChecklist(host: SidecarActionHost, jobId: WorkflowId, write: ChecklistWrite): ChecklistSet {
  const read = parseChecklistItems(write.raw, write.planned === true);
  if ("error" in read) return { ok: false, message: read.error };
  const text = briefToCheck(jobGoal(host, jobId), write.brief);
  const parsed = withoutOffBrief(read.items, text);
  if ("error" in parsed) return { ok: false, message: parsed.error };
  const input: SetInput = { host, jobId, items: parsed.items, text, dropped: parsed.dropped.length ? { dropped: parsed.dropped } : {} };
  const ledger = ledgerOf(host, jobId);
  return ledger.checklist ? extendChecklist(input, ledger.checklist) : firstChecklist(input, ledger);
}

/** True when the planner wrote the list: its items carry their spec slices. */
export function checklistPlanned(host: SidecarActionHost, jobId: WorkflowId | undefined): boolean {
  return checklistOf(host, jobId)?.items.some((item) => item.spec !== undefined) === true;
}

/** Stamps the items that are done now and have no stamp yet; true when any was stamped. Safe to call as often as you like: a stamp is never changed. */
export function stampVerified(host: SidecarActionHost, jobId: WorkflowId | undefined, view: ChecklistView, at: string): boolean {
  const checklist = checklistOf(host, jobId);
  if (!checklist) return false;
  const stamps = checklist.verifiedAt ??= {};
  const fresh = itemStates(checklist, view).filter((state) => state.status === "done" && stamps[state.id] === undefined);
  for (const state of fresh) stamps[state.id] = at;
  if (fresh.length) persistChecklists(host);
  return fresh.length > 0;
}

/** How many items are done now. */
export function doneCount(host: SidecarActionHost, jobId: WorkflowId | undefined, view: ChecklistView): number {
  const checklist = checklistOf(host, jobId);
  return checklist ? itemStates(checklist, view).filter((item) => item.status === "done").length : 0;
}

/**
 * What a model that answered in prose is told, in the same cycle: the open count and the next item. Undefined when there is no checklist or no build item is
 * open (a review is the sidecar's to run).
 */
export function openItemsNudge(host: SidecarActionHost, jobId: WorkflowId | undefined, view: ChecklistView): string | undefined {
  const checklist = checklistOf(host, jobId);
  if (!checklist) return undefined;
  const states = itemStates(checklist, view);
  const next = nextOpen(checklist, states);
  if (!next) return undefined;
  return `${states.filter((item) => item.status === "open").length} of ${states.length} checklist items are still open; the next is ${next.id}: ${next.spec}. Continue with a tool call: queue it with stage "${next.id}".`;
}

/** One line for a receipt or a continuation note: bounded, whatever the list's length. */
export function checklistStatusLine(host: SidecarActionHost, jobId: WorkflowId | undefined, view: ChecklistView): string | undefined {
  const checklist = checklistOf(host, jobId);
  return checklist ? statusLineOf(itemStates(checklist, view)) : undefined;
}

/**
 * The line a continuation message or a seal reply carries: the next open items with their spec slices, then the status line, together under NEXT_SLICE_CHARS.
 * A list without specs gets the status line alone.
 */
export function checklistProgress(host: SidecarActionHost, jobId: WorkflowId | undefined, view: ChecklistView): string | undefined {
  const checklist = checklistOf(host, jobId);
  if (!checklist) return undefined;
  const states = itemStates(checklist, view);
  const status = statusLineOf(states);
  const prefix = "This cycle: ";
  const next = nextSlices(checklist, states, NEXT_SLICE_CHARS - status.length - prefix.length - 3);
  return next ? `${prefix}${next}. ${status}` : status;
}

function setNotes(set: Extract<ChecklistSet, { ok: true }>): JsonObject {
  return {
    ...(set.added.length ? { added: set.added } : {}),
    ...(set.kept ? { note: `Kept the ${set.kept} existing items: a later call only adds items, it never removes or renames them.` } : {}),
    ...(set.ignored.length ? { ignored: `Not renamed: ${set.ignored.join(", ")}.` } : {}),
    ...(set.gaps?.length ? { gaps: `Added ${set.gaps.join(", ")} for parts of the request no item covered; each spec is the request's own words. Build them like any item, or close one as unbuilt if it asks for nothing to build.` } : {}),
    ...(set.dropped?.length ? { leftOut: `Left out ${set.dropped.join(", ")}: a spec must be words of the request, copied exactly. Add them again only if the list misses that part of the request.` } : {}),
  };
}

/** The tool's reply: every item with its status (done and open, never trimmed: the model chose these ids). */
export function checklistReply(view: ChecklistView, set: Extract<ChecklistSet, { ok: true }>): JsonObject {
  const states = itemStates(set.checklist, view);
  return {
    items: states.map((item) => ({ id: item.id, title: item.title, status: item.status })),
    summary: statusLineOf(states),
    ...setNotes(set),
    next: NEXT_INSTRUCTION,
  };
}
