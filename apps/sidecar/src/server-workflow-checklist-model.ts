// The checklist's shapes, limits and decoders (ADR 0044 rule 8): the types a job's list is made of, the request-scale check, the readers for a model-written or planner-written item list, and the saved form.
import { REQUEST_ROUTE } from "@extynt/decide";
import { array, decode, type Decoder, fallback, type Infer, literal, map, number, object, record, string, type JsonValue } from "@extynt/decode";
import { bookedOneOf } from "./decision-book.js";
import { requestedFeatures, requestedNames } from "./request-coverage.js";

/**
 * One thing the request asks for. `spec` (the exact slice of the brief the item must satisfy), `kind` and `covers` (a review item's build items; it is due
 * once each is done or unbuilt) come from the planner only: the model's own list is id and title.
 */
export interface ChecklistItem { id: string; title: string; spec?: string; kind?: "build" | "review"; covers?: string[] }

/**
 * A review item's history: the fix verdicts so far, the covered batches counted at the last one, whether a completion attempt asked for the next look without
 * waiting for new work, and how it was closed.
 */
export interface ReviewState { rounds: number; seen: number; again?: boolean; result?: "pass" | "skipped"; note?: string }

/**
 * A job's list. `batchItems` maps a sealed batch id to the item ids its stage labels named, `attempts` counts the queue calls (and seals) refused for an item
 * before any batch existed, and `unbuilt` holds the items the model closed with its reason, accepted once. `reviews` is keyed by item id. `verifiedAt` is the ISO
 * time each item first had a verified stage: set once and never moved (the panel's time-left rate reads it).
 */
export interface Checklist {
  items: ChecklistItem[];
  batchItems: Record<string, string[]>;
  attempts: Record<string, number>;
  unbuilt: Record<string, string>;
  reviews?: Record<string, ReviewState>;
  verifiedAt?: Record<string, string>;
}

/** An item the model closed as unbuilt, with its reason. */
export interface UnbuiltClaim { id: string; reason: string }

/** The slice of workflow state item status is read from; WorkflowState satisfies it. */
export interface ChecklistView {
  readonly batches: Readonly<Record<string, {
    readonly lifecycle?: string;
    readonly execution: { readonly mutation: string };
    readonly verification: { readonly state: string };
    readonly recovery?: { readonly state: string };
  } | undefined>>;
}

type ParsedItems = { items: ChecklistItem[] } | { error: string };

/** The most items one job's list may hold. */
export const MAX_CHECKLIST_ITEMS = 200;

/** Open ids named in a refusal or a status line; the rest is a count. */
export const MAX_NAMED_OPEN = 10;

/** A request at most this many characters long, naming at most SMALL_REQUEST_MAX_THINGS things, is one item and needs no checklist (ADR 0044 rule 8). */
export const SMALL_REQUEST_MAX_CHARS = 400;

const SMALL_REQUEST_MAX_THINGS = 3;
const ROUTES = ["answer-only", "single-agent", "specialist-workflow"] as const;
const MAX_ID_CHARS = 40;
const MAX_TITLE_CHARS = 120;
const MAX_REASON_CHARS = 240;
const MAX_SPEC_CHARS = 1_200;
const ID_PATTERN = /^[a-z0-9][a-z0-9_.-]*$/;
const ITEMS_SHAPE = "items must be a list of {id, title}: one per section, shot or deliverable the request names.";
const ITEM_NEEDS = `Every item needs a short slug id (letters, digits, - _ . ; up to ${MAX_ID_CHARS} characters, like "bar-01") and a title.`;

/** The text the model is told before its first queue call on a long request. */
export const CHECKLIST_NUDGE = "Write the checklist first with ae_workflow_checklist: one item per section, shot or deliverable the request names. Then queue each item's batches with stage set to its id.";

/** Whether a request is small enough to be one item (see SMALL_REQUEST_MAX_CHARS). */
export function requestScale(goal: string): "small" | "long" {
  const routed = bookedOneOf({ decision: REQUEST_ROUTE.name, text: goal }, ROUTES);
  if (routed !== undefined) return routed === "specialist-workflow" ? "long" : "small";
  const booked = bookedOneOf({ decision: "request-scale", text: goal }, ["small", "long"] as const);
  if (booked !== undefined) return booked;
  return goal.trim().length <= SMALL_REQUEST_MAX_CHARS && requestedFeatures(goal).length + requestedNames(goal).length <= SMALL_REQUEST_MAX_THINGS ? "small" : "long";
}

/** Names up to MAX_NAMED_OPEN ids and counts the rest. */
export function namedIds(ids: readonly string[]): string {
  return ids.length > MAX_NAMED_OPEN ? `${ids.slice(0, MAX_NAMED_OPEN).join(", ")} (+${ids.length - MAX_NAMED_OPEN} more)` : ids.join(", ");
}

function present<T>(entries: ReadonlyArray<T | undefined>): T[] {
  return entries.filter((entry): entry is T => entry !== undefined);
}

function textOf(maxChars: number): Decoder<string> {
  return map(fallback(string(), undefined), (text) => text?.trim().slice(0, maxChars) ?? "");
}

function idFrom(text: string | undefined): string | undefined {
  const id = text?.trim().toLowerCase();
  return id !== undefined && id.length > 0 && id.length <= MAX_ID_CHARS && ID_PATTERN.test(id) ? id : undefined;
}

const slug: Decoder<string | undefined> = map(fallback(string(), undefined), idFrom);
const coverIds: Decoder<string[]> = map(fallback(array(slug), undefined), (ids) => present(ids ?? []));
const itemFields = object({ id: slug, title: textOf(MAX_TITLE_CHARS), spec: textOf(MAX_SPEC_CHARS), kind: fallback(literal("review"), undefined), covers: coverIds });

function itemFrom(fields: Infer<typeof itemFields>, planned: boolean): ChecklistItem | undefined {
  const { id, title, spec, kind, covers } = fields;
  if (!id || !title) return undefined;
  return { id, title, ...(spec ? { spec } : {}), ...(planned && kind ? { kind } : {}), ...(planned && covers.length ? { covers } : {}) };
}

function itemsFrom(entries: ReadonlyArray<ChecklistItem | undefined>): ParsedItems {
  if (entries.length < 1) return { error: ITEMS_SHAPE };
  const items: ChecklistItem[] = [];
  const seen = new Set<string>();
  for (const item of entries) {
    if (!item) return { error: ITEM_NEEDS };
    if (seen.has(item.id)) return { error: `The id "${item.id}" appears twice.` };
    seen.add(item.id);
    items.push(item);
  }
  return { items };
}

function itemList(planned: boolean): Decoder<ParsedItems> {
  return map(array(map(fallback(itemFields, undefined), (fields) => (fields ? itemFrom(fields, planned) : undefined))), itemsFrom);
}

/** A list of items as the model wrote it. `planned` lets the planner's spec, kind and covers through; the model's own list is id and title only. */
export function parseChecklistItems(raw: JsonValue | readonly ChecklistItem[] | undefined, planned = false): ParsedItems {
  const decoded = decode(itemList(planned), raw);
  return decoded.ok ? decoded.value : { error: ITEMS_SHAPE };
}

const claimDecoder: Decoder<UnbuiltClaim | undefined> = map(fallback(object({ id: slug, reason: textOf(MAX_REASON_CHARS) }), undefined), (fields) => (fields?.id && fields.reason ? { id: fields.id, reason: fields.reason } : undefined));

/** The items the model closed as unbuilt: entries without a valid id and a reason are dropped. */
export function parseUnbuilt(raw: JsonValue | undefined): UnbuiltClaim[] {
  const decoded = decode(array(claimDecoder), raw);
  return decoded.ok ? present(decoded.value) : [];
}

function openRecord<T>(entry: Decoder<T | undefined>): Decoder<Record<string, T>> {
  return map(record(string(), entry), (entries) => Object.fromEntries(Object.entries(entries).flatMap(([key, value]) => (value === undefined ? [] : [[key, value] as const]))));
}

function recordOf<T>(entry: Decoder<T | undefined>): Decoder<Record<string, T>> {
  return map(fallback(openRecord(entry), undefined), (entries) => entries ?? {});
}

const reviewRow: Decoder<ReviewState | undefined> = fallback(map(
  object({ rounds: number(), seen: number(), again: fallback(literal(true), undefined), result: fallback(literal("pass", "skipped"), undefined), note: fallback(string(), undefined) }),
  ({ rounds, seen, again, result, note }): ReviewState => ({ rounds, seen, ...(again ? { again } : {}), ...(result ? { result } : {}), ...(note === undefined ? {} : { note }) }),
), undefined);
const batchItemsRow: Decoder<string[] | undefined> = map(fallback(array(fallback(string(), undefined)), undefined), (ids) => (ids ? present(ids) : undefined));
const attemptsRow: Decoder<number | undefined> = fallback(number(), undefined);
const stringRow: Decoder<string | undefined> = fallback(string(), undefined);

interface SavedChecklist { items: ParsedItems; batchItems: Record<string, string[]>; attempts: Record<string, number>; unbuilt: Record<string, string>; reviews: Record<string, ReviewState> | undefined; verifiedAt: Record<string, string> }

function checklistFrom(saved: SavedChecklist): Checklist | undefined {
  if ("error" in saved.items) return undefined;
  const { batchItems, attempts, unbuilt, reviews, verifiedAt } = saved;
  return { items: saved.items.items, batchItems, attempts, unbuilt, ...(reviews ? { reviews } : {}), ...(Object.keys(verifiedAt).length ? { verifiedAt } : {}) };
}

const savedChecklist: Decoder<Checklist | undefined> = fallback(map(
  object({ items: itemList(true), batchItems: recordOf(batchItemsRow), attempts: recordOf(attemptsRow), unbuilt: recordOf(stringRow), reviews: fallback(openRecord(reviewRow), undefined), verifiedAt: recordOf(stringRow) }),
  checklistFrom,
), undefined);

/** A done item has a verified batch, an unbuilt one was closed with a reason, an open one is neither. A review item is the sidecar's to run, never the model's to build. */
export type ItemState =
  | { readonly status: "done" | "open"; readonly id: string; readonly title: string; readonly attempted: boolean; readonly review?: true }
  | { readonly status: "unbuilt"; readonly id: string; readonly title: string; readonly attempted: boolean; readonly review?: true; readonly reason: string };

/** Queue calls refused for an item that equal one attempted batch; a refused seal counts as that many at once. */
export const REFUSALS_AS_ATTEMPT = 2;

const NEXT_SPEC_CHARS = 200;
const STATUS_NAMED_OPEN = 3;
const STATUS_LINE_CHARS = 240;
const MIN_SLICE_CHARS = 40;

function batchDone(view: ChecklistView, batchId: string): boolean {
  const batch = view.batches[batchId];
  return !!batch && batch.execution.mutation === "applied" && batch.verification.state === "verified" && batch.recovery?.state !== "undone" && batch.recovery?.state !== "undo_unverified";
}

function batchAttempted(view: ChecklistView, batchId: string): boolean {
  const batch = view.batches[batchId];
  return !!batch && batch.lifecycle === "settled" && !batchDone(view, batchId);
}

function batchesByItem(checklist: Checklist): Map<string, string[]> {
  const byItem = new Map<string, string[]>();
  for (const [batchId, ids] of Object.entries(checklist.batchItems)) for (const id of ids) byItem.set(id, [...(byItem.get(id) ?? []), batchId]);
  return byItem;
}

function closedState(checklist: Checklist, item: ChecklistItem, base: { id: string; title: string; attempted: boolean; review?: true }): ItemState {
  const reason = checklist.unbuilt[item.id];
  return reason ? { ...base, status: "unbuilt", reason } : { ...base, status: "open" };
}

function reviewState(checklist: Checklist, item: ChecklistItem): ItemState {
  const base = { id: item.id, title: item.title, attempted: false, review: true } as const;
  return checklist.reviews?.[item.id]?.result ? { ...base, status: "done" } : closedState(checklist, item, base);
}

function buildState(checklist: Checklist, view: ChecklistView, item: ChecklistItem, batches: readonly string[]): ItemState {
  const attempted = (checklist.attempts[item.id] ?? 0) >= REFUSALS_AS_ATTEMPT || batches.some((batchId) => batchAttempted(view, batchId));
  const base = { id: item.id, title: item.title, attempted };
  return batches.some((batchId) => batchDone(view, batchId)) ? { ...base, status: "done" } : closedState(checklist, item, base);
}

/** Each item's status now: done by a verified batch (a review: by its pass), unbuilt by an accepted reason, else open. */
export function itemStates(checklist: Checklist, view: ChecklistView): ItemState[] {
  const byItem = batchesByItem(checklist);
  return checklist.items.map((item) => (item.kind === "review" ? reviewState(checklist, item) : buildState(checklist, view, item, byItem.get(item.id) ?? [])));
}

/** An open item as a status or refusal names it: a review is the sidecar's to run, never the model's to build. */
export function openLabel(item: ItemState): string {
  return item.review ? `${item.id} (review pending)` : item.id;
}

function openBuildItems(checklist: Checklist, states: readonly ItemState[]): ChecklistItem[] {
  const open = new Set(states.filter((state) => state.status === "open" && !state.review).map((state) => state.id));
  return checklist.items.filter((item) => open.has(item.id));
}

/** The next open build item, in list order, with its spec (or title) cut for a short message. */
export function nextOpen(checklist: Checklist, states: readonly ItemState[]): { id: string; spec: string } | undefined {
  const item = openBuildItems(checklist, states)[0];
  return item ? { id: item.id, spec: (item.spec ?? item.title).slice(0, NEXT_SPEC_CHARS) } : undefined;
}

/** One line for a receipt or a continuation note: bounded, whatever the list's length. */
export function statusLineOf(states: readonly ItemState[]): string {
  const done = states.filter((item) => item.status === "done").length;
  const unbuilt = states.filter((item) => item.status === "unbuilt").length;
  const open = states.filter((item) => item.status === "open").map(openLabel);
  const shown = open.slice(0, STATUS_NAMED_OPEN);
  const rest = open.length - shown.length;
  const tail = open.length ? `; open: ${shown.join(", ")}${rest > 0 ? `, … (+${rest})` : ""}` : "";
  return `Checklist ${done}/${states.length} done${unbuilt ? `, ${unbuilt} unbuilt` : ""}${tail}`.slice(0, STATUS_LINE_CHARS);
}

/** The next open build items with their spec slices, as many as fit in the budget; undefined when the list carries no specs (the model wrote it). */
export function nextSlices(checklist: Checklist, states: readonly ItemState[], budget: number): string | undefined {
  if (!checklist.items.some((item) => item.spec)) return undefined;
  const parts: string[] = [];
  let used = 0;
  for (const item of openBuildItems(checklist, states)) {
    const head = `${item.id} — `;
    const room = budget - used - head.length - 2;
    if (room < MIN_SLICE_CHARS && parts.length) break;
    const part = `${head}${(item.spec ?? item.title).slice(0, Math.max(room, MIN_SLICE_CHARS))}`;
    parts.push(part);
    used += part.length + 2;
    if (used >= budget) break;
  }
  return parts.length ? parts.join("; ") : undefined;
}

/** Build items settled (done or closed unbuilt) out of all build items; undefined when there is no build item. */
export function buildProgressOf(states: readonly ItemState[]): { settled: number; total: number } | undefined {
  const builds = states.filter((item) => !item.review);
  return builds.length ? { settled: builds.filter((item) => item.status !== "open").length, total: builds.length } : undefined;
}

/** Verified batches of the given items: what a review counts, to know whether any covered item gained work since the last look. */
export function coveredBatches(checklist: Checklist, view: ChecklistView, itemIds: readonly string[]): string[] {
  const ids = new Set(itemIds);
  return Object.entries(checklist.batchItems).filter(([batchId, items]) => items.some((id) => ids.has(id)) && batchDone(view, batchId)).map(([batchId]) => batchId);
}

function isSettled(state: ItemState | undefined): boolean {
  return state?.status === "done" || state?.status === "unbuilt";
}

function isDue(checklist: Checklist, view: ChecklistView, item: ChecklistItem): boolean {
  const covers = item.covers ?? [];
  const review = checklist.reviews?.[item.id];
  return !review || review.rounds === 0 || review.again === true || coveredBatches(checklist, view, covers).length > review.seen;
}

/** Review items that are due: open, every covered item done or unbuilt, and either never looked at, asked again, or covered work added since the last fix verdict. */
export function dueReviews(checklist: Checklist, view: ChecklistView): ChecklistItem[] {
  const states = new Map(itemStates(checklist, view).map((state) => [state.id, state]));
  return checklist.items.filter((item) => item.kind === "review" && states.get(item.id)?.status === "open"
    && (item.covers ?? []).every((id) => isSettled(states.get(id))) && isDue(checklist, view, item));
}

/** Checklists saved with the workflow handoffs, for jobs still open. */
export function serializeChecklists(ledgers: ReadonlyMap<string, { checklist?: Checklist }>): Record<string, Checklist> {
  const saved: Record<string, Checklist> = {};
  for (const [jobId, ledger] of ledgers) if (ledger.checklist) saved[jobId] = ledger.checklist;
  return saved;
}

/** Reads the saved checklists back, dropping anything malformed. */
export function parseChecklists(raw: JsonValue | undefined): Map<string, Checklist> {
  const decoded = decode(record(string(), savedChecklist), raw);
  const saved = new Map<string, Checklist>();
  if (decoded.ok) for (const [jobId, checklist] of Object.entries(decoded.value)) if (checklist) saved.set(jobId, checklist);
  return saved;
}
