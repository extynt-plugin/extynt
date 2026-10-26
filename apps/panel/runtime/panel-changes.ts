/**
 * "Changes" in the sheet: what the agent changed in the open project, each with whether Undo is still safe.
 *
 * Pure derivations from what the sidecar's GET /v1/changes returns, so every case can be tested without a DOM: reading the
 * answer, the plain words for a change's status, age and undo state, and the sentence under a change that can no longer be
 * undone. Whether Undo is offered is the sidecar's answer; nothing here decides it, and nothing here reads or writes a
 * project, a plan or After Effects.
 */
import type { Decoder, Infer } from "@extynt/decode";
import { planIdDecoder, type PlanId } from "./ids.js";
import { chipFor } from "./panel-plan-labels.js";
import { fallback, literal, map, object, skippingInvalid, string } from "@extynt/decode";
import { wholeCount } from "./wire-decoders.js";
import { t } from "./panel-language.js";

const MAX_FILES = 16;
const NAMED_FILES = 3;
const PANEL_SOURCE = "panel";

const nonEmptyOrNull: Decoder<string | null> = map(fallback(string(), null), (value) => value || null);
const unavailable = { available: false, code: "", reason: "" } as const;

const undoDecoder = fallback(map(object({ available: fallback(literal(true), false), code: fallback(string(), ""), reason: fallback(string(), "") }), (undo) => (undo.available ? { available: true, code: "", reason: "" } : undo)), unavailable);

const changeDecoder = object({
  planId: planIdDecoder,
  summary: fallback(string(), ""),
  appliedAt: fallback(string(), ""),
  operations: wholeCount,
  status: fallback(string(), ""),
  mayHaveMutated: fallback(literal(true), false),
  undoGroupsRemaining: wholeCount,
  undo: undoDecoder,
  files: map(fallback(skippingInvalid(object({ path: string({ nonEmpty: true }) })), []), (entries) => entries.slice(0, MAX_FILES).map((entry) => entry.path)),
  source: map(fallback(string(), null), (name) => name || PANEL_SOURCE),
  jobId: nonEmptyOrNull,
  batch: nonEmptyOrNull,
  origin: fallback(literal("chat", "mcp", "designer"), null),
});

type Change = Infer<typeof changeDecoder>;
type ChangeOrigin = NonNullable<Change["origin"]>;

/** The sidecar's list of changes in the open project; `truncated` says it was cut short. */
export const changesDecoder = map(
  object({ ok: literal(true), project: fallback(object({ name: fallback(string(), "") }), null), changes: skippingInvalid(changeDecoder), truncated: fallback(literal(true), false) }),
  ({ project, changes, truncated }) => ({ project: project && project.name ? project.name : null, changes, truncated }),
);

/** The list of changes with the project it belongs to. */
export type ChangesAnswer = Infer<typeof changesDecoder>;

/** What one change shows: nothing in it is a code or a raw status. */
export interface ChangeRow {
  readonly planId: PlanId;
  readonly title: string;
  readonly statusLabel: string;
  readonly tone: string;
  readonly meta: string;
  readonly canUndo: boolean;
  readonly undoNote: string;
  readonly undoTitle: string;
  readonly status: string;
  readonly jobId: string | null;
  readonly batch: string | null;
  readonly origin: ChangeOrigin | null;
  readonly operations: number;
  readonly applied: string;
  readonly mayHaveMutated: boolean;
  readonly source: string;
  readonly steps: number;
  readonly undoCode: string;
  readonly filesLine: string;
}

/** "Wrote 2 files outside the project: a.mov, b.png": the files Undo leaves on disk; names only, the full path is in the title. */
export function filesLine(files: ReadonlyArray<string>): string {
  if (files.length === 0) return "";
  const names = files.slice(0, NAMED_FILES).map((path) => path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1) || path).join(", ");
  const listed = files.length > NAMED_FILES ? t("plans.files.more", { names, count: files.length - NAMED_FILES }) : names;
  return t("plans.files.wrote", { count: files.length, names: listed });
}

/** How long ago, in the words a person would use; a time the sidecar gave that cannot be read says nothing. */
export function ageText(iso: string, now: number): string {
  const then = Date.parse(iso);
  if (!isFinite(then)) return "";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return t("plans.age.justNow");
  if (seconds < 3600) return t("plans.age.minutes", { count: Math.max(1, Math.round(seconds / 60)) });
  if (seconds < 86400) return t("plans.age.hours", { count: Math.round(seconds / 3600) });
  return t("plans.age.days", { count: Math.round(seconds / 86400) });
}

function sourceNameOf(name: string): string {
  return name === PANEL_SOURCE ? t("plans.source.you") : name;
}

const UNDO_NOTES: ReadonlyMap<string, () => string> = new Map<string, () => string>([
  ["ALREADY_UNDONE", () => t("plans.undo.nothingLeft")],
  ["NOTHING_CHANGED", () => t("plans.undo.nothingChanged")],
]);

function undoNote(change: Change): string {
  if (change.undo.available) return "";
  const known = UNDO_NOTES.get(change.undo.code);
  if (known) return known();
  const reason = change.undo.reason.replace(/[.\s]+$/, "");
  return reason ? t("plans.undo.cannotUndo", { reason }) : t("plans.undo.noLongerUndoable");
}

function meta(change: Change, now: number): string {
  const parts = [ageText(change.appliedAt, now), t("plans.unit.op", { count: change.operations })];
  if (change.undo.available && change.undoGroupsRemaining > 1) parts.push(t("plans.undo.stepsLeft", { count: change.undoGroupsRemaining }));
  return parts.filter(Boolean).join(" · ");
}

function undoTitle(change: Change): string {
  if (!change.undo.available) return "";
  return change.undoGroupsRemaining > 1 ? t("plans.undo.titleAll", { count: change.undoGroupsRemaining }) : t("plans.undo.title");
}

function rowOf(change: Change, now: number): ChangeRow {
  const chip = chipFor(change.status, change.mayHaveMutated);
  return {
    planId: change.planId, title: change.summary || change.planId, status: change.status, statusLabel: chip.label, tone: chip.tone,
    meta: meta(change, now), canUndo: change.undo.available, undoNote: undoNote(change), undoTitle: undoTitle(change),
    jobId: change.jobId, batch: change.batch, origin: change.origin, operations: change.operations, applied: change.appliedAt,
    mayHaveMutated: change.mayHaveMutated, source: sourceNameOf(change.source), steps: change.undoGroupsRemaining, undoCode: change.undo.code,
    filesLine: filesLine(change.files),
  };
}

/** What to draw for each change, in the order the sidecar gave (newest first). */
export function changeRows(answer: ChangesAnswer, now: number): ChangeRow[] {
  return answer.changes.map((change) => rowOf(change, now));
}

/** Undo was refused or failed: the sidecar's own sentence, or a plain fallback. */
export function undoFailureLine(problem: string | null): string {
  return t("plans.undo.failed", { reason: (problem && problem.replace(/[.\s]+$/, "")) || t("plans.undo.notAccepted") });
}

/** The line after a successful Undo. */
export function undoRequestedLine(): string {
  return t("plans.undo.requested");
}

const LOOK_AT: ReadonlySet<string> = new Set(["failed", "applied_unverified", "partially_undone", "undo_unverified"]);

/** Whether a change needs the reader's eye: it applied only in part, could not be fully checked, or its undo is not settled. */
export function needsLook(row: ChangeRow): boolean {
  return LOOK_AT.has(row.status);
}

/** One line in the sheet's Changes: a change, or a folded run of verified ones from one job. */
export type ChangeItem =
  | { readonly kind: "row"; readonly row: ChangeRow }
  | { readonly kind: "fold"; readonly id: string; readonly jobId: string; readonly rows: ChangeRow[]; readonly label: string };

const FOLD_KEEP = 3;

function batchNumber(batch: string | null): number | null {
  const match = batch === null ? null : /(\d+)\D*$/.exec(batch);
  return match?.[1] === undefined ? null : Number(match[1]);
}

/** "Batches 1–20 · 188 ops · verified": the batch range when every batch is numbered, else the count. */
export function foldLabel(rows: ReadonlyArray<ChangeRow>): string {
  const numbers = rows.map((row) => batchNumber(row.batch));
  const known = numbers.filter((value): value is number => value !== null);
  const ops = rows.reduce((sum, row) => sum + row.operations, 0);
  const numbered = known.length === rows.length && rows.length > 1;
  const head = numbered ? t("plans.fold.range", { first: Math.min(...known), last: Math.max(...known) }) : t("plans.unit.batch", { count: rows.length });
  return t("plans.fold.line", { head, ops: t("plans.unit.op", { count: ops }) });
}

interface FoldState {
  readonly seen: Map<string, number>;
  readonly folds: Map<string, ChangeRow[]>;
  readonly slots: Slot[];
}
type Slot = { readonly row: ChangeRow } | { readonly jobId: string };

function foldable(row: ChangeRow, state: FoldState, keep: number): string | null {
  if (row.jobId === null || row.status !== "verified") return null;
  const total = (state.seen.get(row.jobId) ?? 0) + 1;
  state.seen.set(row.jobId, total);
  return total > keep ? row.jobId : null;
}

function place(row: ChangeRow, state: FoldState, keep: number): void {
  const jobId = foldable(row, state, keep);
  const held = jobId === null ? undefined : state.folds.get(jobId);
  if (jobId === null) state.slots.push({ row });
  else if (held) held.push(row);
  else {
    state.folds.set(jobId, [row]);
    state.slots.push({ jobId });
  }
}

/**
 * Folds the verified runs of a job (by jobId, never by adjacency) into one line each, keeping the newest few open. Failures,
 * held plans, changes from outside any job and changes that are not verified always stay open, in their place. A fold of
 * one change saves nothing, so it stays a row.
 */
export function foldChanges(rows: ReadonlyArray<ChangeRow>, keep: number = FOLD_KEEP): ChangeItem[] {
  const state: FoldState = { seen: new Map(), folds: new Map(), slots: [] };
  rows.forEach((row) => place(row, state, keep));
  return state.slots.map((slot) => itemOf(slot, state.folds));
}

function itemOf(slot: Slot, folds: ReadonlyMap<string, ChangeRow[]>): ChangeItem {
  if ("row" in slot) return { kind: "row", row: slot.row };
  const rows = folds.get(slot.jobId) ?? [];
  const only = rows[0];
  if (rows.length === 1 && only) return { kind: "row", row: only };
  return { kind: "fold", id: slot.jobId, jobId: slot.jobId, rows, label: foldLabel(rows) };
}
