// Which checklist items a queue call or a seal belongs to: the stage labels the model sends on queue calls, matched tolerantly, and the credit a sealed batch (or a refused one) gives them.
import { decode, string } from "@extynt/decode";
import type { WorkflowId } from "@extynt/workflow";
import type { ToolArguments } from "./agent-types.js";
import { namedIds, REFUSALS_AS_ATTEMPT, itemStates, type Checklist, type ChecklistView } from "./server-workflow-checklist-model.js";
import { checklistOf, ledgerOf, persistChecklists, recordSidecarAction, type SidecarActionHost, type SidecarActionLedger } from "./server-workflow-sidecar-actions.js";

interface SealRecord { items: string[]; inherited: boolean }

interface SealScope { host: SidecarActionHost; jobId: WorkflowId; checklist: Checklist; view: ChecklistView | undefined }

const MAX_LABELS_PER_QUEUE = 8;
const MIN_PREFIX_CHARS = 3;
const NO_SEAL: SealRecord = { items: [], inherited: false };

function foldLabel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function stageOf(args: ToolArguments): string | undefined {
  const stage = decode(string(), args.stage);
  return stage.ok ? stage.value : undefined;
}

function idMatch(checklist: Checklist, text: string): string[] | undefined {
  const first = text.split(/[\s:,;]+/)[0] ?? "";
  const head = text.split(/[:,;]+/)[0] ?? "";
  const candidates = [text, first, head.trim()].filter((candidate, index, all) => candidate && all.indexOf(candidate) === index);
  const exact = candidates.find((candidate) => checklist.items.some((item) => item.id === candidate));
  if (exact) return [exact];
  for (const candidate of candidates) {
    const folded = foldLabel(candidate);
    const hits = folded ? checklist.items.filter((item) => foldLabel(item.id) === folded) : [];
    if (hits.length === 1 && hits[0]) return [hits[0].id];
  }
  return undefined;
}

function titleMatch(checklist: Checklist, text: string): string[] {
  const folded = foldLabel(text);
  if (folded.length < MIN_PREFIX_CHARS) return [];
  const byTitle = checklist.items.filter((item) => {
    const title = foldLabel(item.title);
    return title.length >= MIN_PREFIX_CHARS && (title.startsWith(folded) || folded.startsWith(title));
  });
  return byTitle.length === 1 && byTitle[0] ? [byTitle[0].id] : [];
}

/**
 * The checklist item ids a stage label names, tolerant of how a model writes one: the id exactly, then the id ignoring case, spaces, dashes and underscores,
 * each tried on the whole label and on its first word ("bar-01: draw it" names bar-01); last an item title that the label starts, or starts the label. A looser
 * step answers only when it names exactly one item. A label that names none stays unplaced.
 */
export function itemsNamedBy(checklist: Checklist, label: string | undefined): string[] {
  const text = label?.trim().toLowerCase();
  if (!text) return [];
  return idMatch(checklist, text) ?? titleMatch(checklist, text);
}

function labelledJob(host: SidecarActionHost, jobId: WorkflowId | undefined): { jobId: WorkflowId; checklist: Checklist } | undefined {
  const checklist = checklistOf(host, jobId);
  return jobId && checklist ? { jobId, checklist } : undefined;
}

function addLabels(ledger: SidecarActionLedger, named: readonly string[]): void {
  const labels = ledger.queueLabels ?? [];
  for (const id of named) if (!labels.includes(id) && labels.length < MAX_LABELS_PER_QUEUE) labels.push(id);
  ledger.queueLabels = labels;
}

/** A queue call's stage label noted for the queue it writes to, until that queue is sealed or refused. The label is read, never removed. */
export function noteQueueLabel(host: SidecarActionHost, jobId: WorkflowId | undefined, args: ToolArguments): void {
  const scope = labelledJob(host, jobId);
  if (!scope) return;
  const stage = stageOf(args);
  const named = itemsNamedBy(scope.checklist, stage);
  const ledger = ledgerOf(host, scope.jobId);
  if (named.length) addLabels(ledger, named);
  else if (stage?.trim()) ledger.stageMissed = true;
}

function takeQueueLabels(host: SidecarActionHost, jobId: WorkflowId): string[] {
  const ledger = host.workflowSidecarActions.get(jobId);
  const labels = ledger?.queueLabels ?? [];
  if (ledger) delete ledger.queueLabels;
  return labels;
}

function countAttempts(checklist: Checklist, ids: Iterable<string>): void {
  for (const id of ids) checklist.attempts[id] = (checklist.attempts[id] ?? 0) + 1;
}

/** A queue write (or the seal that followed) refused, or the call failed: an attempt for the items the open queue is labelled with. */
export function noteQueueRefusal(host: SidecarActionHost, jobId: WorkflowId | undefined, args: ToolArguments): void {
  const scope = labelledJob(host, jobId);
  if (!scope) return;
  const named = itemsNamedBy(scope.checklist, stageOf(args));
  const labels = host.workflowSidecarActions.get(scope.jobId)?.queueLabels ?? [];
  countAttempts(scope.checklist, new Set([...named, ...labels]));
  if (named.length || labels.length) persistChecklists(host);
}

/** A queue dropped unsealed because every value was already in After Effects: a whole attempt for the items it was labelled with, as a refused seal is, so an item whose work landed under another stage can be closed with that reason. The labels go with the dropped queue. */
export function noteUnchangedQueue(host: SidecarActionHost, jobId: WorkflowId | undefined): void {
  const scope = labelledJob(host, jobId);
  if (!scope) return;
  const labels = takeQueueLabels(host, scope.jobId).filter((id) => scope.checklist.items.some((item) => item.id === id));
  for (const id of labels) scope.checklist.attempts[id] = (scope.checklist.attempts[id] ?? 0) + REFUSALS_AS_ATTEMPT;
  if (labels.length) persistChecklists(host);
}

function openBuildIds(checklist: Checklist, view: ChecklistView | undefined): string[] {
  if (!view) return checklist.items.filter((item) => item.kind !== "review" && checklist.unbuilt[item.id] === undefined).map((item) => item.id);
  return itemStates(checklist, view).filter((state) => state.status === "open" && !state.review).map((state) => state.id);
}

function inheritedItems(scope: SealScope, last: readonly string[] | undefined): string[] {
  const { checklist, view } = scope;
  const known = (last ?? []).filter((id) => checklist.items.some((item) => item.id === id && checklist.unbuilt[id] === undefined));
  if (known.length) return known;
  const open = openBuildIds(checklist, view);
  return open.length === 1 ? open : [];
}

function sealLabels(scope: SealScope, batchId: string | null | undefined): { labels: string[]; inherited: boolean; labelled: number } {
  const { host, jobId, checklist } = scope;
  const labelled = takeQueueLabels(host, jobId).filter((id) => checklist.items.some((item) => item.id === id));
  const inherited = !labelled.length && !!batchId;
  const labels = labelled.length ? labelled : inherited ? inheritedItems(scope, ledgerOf(host, jobId).lastLabels) : [];
  return { labels, inherited, labelled: labelled.length };
}

function noteUnlabelledSeal(scope: SealScope, batchId: string): void {
  const { host, jobId, checklist, view } = scope;
  const open = openBuildIds(checklist, view);
  if (open.length) ledgerOf(host, jobId).unlabelledSeal = { credited: [], open };
  recordSidecarAction(host, jobId, `sealed batch ${batchId} had no checklist stage and no single open item to inherit, so it counts toward no item (send stage set to an item id on the queue call)`);
}

function creditSeal(scope: SealScope, labels: string[], batchId: string | null | undefined, inherited: boolean): void {
  const { host, jobId, checklist, view } = scope;
  const ledger = ledgerOf(host, jobId);
  if (batchId) {
    checklist.batchItems[batchId] = labels;
    ledger.lastLabels = labels;
    if (inherited) ledger.unlabelledSeal = { credited: labels, open: openBuildIds(checklist, view) };
  } else {
    for (const id of labels) checklist.attempts[id] = (checklist.attempts[id] ?? 0) + REFUSALS_AS_ATTEMPT;
  }
  persistChecklists(host);
}

/**
 * A seal: the batch it became belongs to the items the queue was labelled with, else to the items it inherits; a seal the admission refused is an attempt for
 * the labelled items. An unlabelled seal continues the job's last labelled seal (a designer builds a drawing batch by batch under the one stage its delegation
 * named, so the item being done is no reason to move on); a job with no earlier label takes its one open build item if there is exactly one. Anything else is
 * ambiguous and credits nothing. A sealed batch that still belongs to no item leaves the open ids on the ledger for the next tool reply.
 */
export function recordSeal(host: SidecarActionHost, jobId: WorkflowId | undefined, sealed: { batchId?: string | null }, view?: ChecklistView): SealRecord {
  const checklist = checklistOf(host, jobId);
  if (!jobId || !checklist) return NO_SEAL;
  const scope: SealScope = { host, jobId, checklist, view };
  const ledger = ledgerOf(host, jobId);
  const missed = ledger.stageMissed === true;
  delete ledger.stageMissed;
  const { labels, inherited, labelled } = sealLabels(scope, sealed.batchId);
  if (missed && sealed.batchId) process.stderr.write(`[extynt] checklist stage matched no item ${JSON.stringify({ jobId, batchId: sealed.batchId, matched: labelled })}\n`);
  if (!labels.length) {
    if (sealed.batchId) noteUnlabelledSeal(scope, sealed.batchId);
    return NO_SEAL;
  }
  creditSeal(scope, labels, sealed.batchId, inherited);
  return { items: labels, inherited };
}

/** What a seal with no stage of its own tells the model, once: where the batch was counted, and which ids are open. */
export function takeUnlabelledSealHint(host: SidecarActionHost, jobId: WorkflowId | undefined): string | undefined {
  const ledger = jobId ? host.workflowSidecarActions.get(jobId) : undefined;
  const note = ledger?.unlabelledSeal;
  if (!ledger || !note) return undefined;
  delete ledger.unlabelledSeal;
  const where = note.credited.length ? `counted toward ${note.credited.join(", ")} (the last stage)` : "counts toward no item";
  return `That batch was sealed with no checklist stage, so it ${where}. Open items: ${namedIds(note.open)}. Send stage set to the item id on the next queue call.`;
}
