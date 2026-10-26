/**
 * The receipt's checklist: one entry per change with a check, a question mark or a cross. It reads the host's
 * per-operation outcomes when the panel holds the receipt, and otherwise what the status and the notices already say, so
 * a plan applied somewhere else still lists its changes. Pure, so every outcome can be tested without a DOM.
 */
import { rowWords, type PlanRowView } from "./panel-plan-labels.js";
import type { PlanNotice } from "./plan-content.js";
import type { OperationOutcome, Receipt } from "./receipt.js";
import { t } from "./panel-language.js";

type CheckMark = "ok" | "unknown" | "bad" | "skip";
export interface CheckItem {
  readonly mark: CheckMark;
  readonly label: string;
  readonly note: string;
}
interface CheckInput {
  readonly rows: ReadonlyArray<PlanRowView>;
  readonly status: string;
  readonly notices: ReadonlyArray<PlanNotice>;
  readonly receipt: Receipt | null;
}
interface CheckSummary {
  readonly text: string;
  readonly tone: "ok" | "warn" | "bad";
}

const MARKS: ReadonlyMap<string, CheckMark> = new Map<string, CheckMark>([
  ["confirmed", "ok"],
  ["host_confirmed", "ok"],
  ["coerced_equivalent", "ok"],
  ["applied_unconfirmed", "unknown"],
  ["applied_before_failure", "unknown"],
  ["readback_mismatch", "bad"],
  ["rejected_before_apply", "bad"],
  ["failed_during_apply", "bad"],
  ["not_attempted", "skip"],
]);

const NOTES: ReadonlyMap<string, () => string> = new Map<string, () => string>([
  ["applied_unconfirmed", () => t("plans.check.appliedNoReadback")],
  ["applied_before_failure", () => t("plans.check.beforeFailure")],
  ["readback_mismatch", () => t("plans.check.mismatch")],
  ["not_attempted", () => t("plans.check.notRun")],
]);

function noteFor(outcome: string): string {
  return NOTES.get(outcome)?.() ?? "";
}

function outcomeItem(entry: OperationOutcome, rows: ReadonlyArray<PlanRowView>): CheckItem {
  const row = rows[entry.index];
  const type = entry.type ? entry.type.replace(/_/g, " ") : t("plans.row.change");
  return { mark: MARKS.get(entry.outcome) ?? "unknown", label: row ? rowWords(row) : type, note: entry.error?.message || noteFor(entry.outcome) };
}

function unverifiedIndexes(notices: ReadonlyArray<PlanNotice>): ReadonlySet<number> {
  const found = new Set<number>();
  for (const notice of notices) if (notice.severity === "unverified") notice.operationIndexes.forEach((index) => found.add(index));
  return found;
}

function statusItems(input: CheckInput): CheckItem[] {
  const unchecked = input.status === "applied_unverified" ? unverifiedIndexes(input.notices) : new Set<number>();
  return input.rows.map((row, index): CheckItem => (unchecked.has(index) ? { mark: "unknown", label: rowWords(row), note: t("plans.check.appliedNoReadback") } : { mark: "ok", label: rowWords(row), note: "" }));
}

/** One entry per change, or none when the plan did not apply cleanly enough for a list of results to mean anything. */
export function checklistOf(input: CheckInput): CheckItem[] {
  const outcomes = input.receipt?.operationOutcomes ?? [];
  if (outcomes.length) return outcomes.map((entry) => outcomeItem(entry, input.rows));
  return input.status === "verified" || input.status === "applied" || input.status === "applied_unverified" ? statusItems(input) : [];
}

/** "5 changes ✓", "5 changes · 2 not checked" or "5 changes · 1 failed": the line the collapsed checklist shows. */
export function checklistSummary(items: ReadonlyArray<CheckItem>): CheckSummary {
  const count = (mark: CheckMark): number => items.filter((item) => item.mark === mark).length;
  const bad = count("bad");
  const unknown = count("unknown");
  if (bad) return { text: t("plans.check.summaryFailed", { count: items.length, bad }), tone: "bad" };
  if (unknown) return { text: t("plans.check.summaryUnchecked", { count: items.length, unknown }), tone: "warn" };
  return { text: t("plans.check.summaryOk", { count: items.length }), tone: "ok" };
}

/** The glyph drawn for each mark. */
export const MARK_GLYPHS = { ok: "✓", unknown: "?", bad: "✕", skip: "–" } as const satisfies Record<CheckMark, string>;
const MARK_WORDS: Readonly<Record<CheckMark, () => string>> = {
  ok: () => t("plans.check.markChecked"),
  unknown: () => t("plans.check.markNotChecked"),
  bad: () => t("plans.check.markFailed"),
  skip: () => t("plans.check.markNotRun"),
};
/** The word read aloud for each mark. */
export function markWord(mark: CheckMark): string {
  return MARK_WORDS[mark]();
}
