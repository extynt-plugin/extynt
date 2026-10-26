/**
 * The plain words for a plan: its status chip, the rows of what will change, the notices that matter before Apply, and the
 * receipt line after it. Pure, so every state can be tested without a DOM. The same chip labels are used on the card, in
 * Activity and in the changes list, so a plan never reads two ways.
 */
import { type JsonValue } from "@extynt/decode";
import { t } from "./panel-language.js";
import type { PlanNotice, PlanValueRow } from "./plan-content.js";
import type { Receipt } from "./receipt.js";

type ChipTone = "ready" | "busy" | "ok" | "warn" | "bad" | "";
interface Chip {
  readonly label: string;
  readonly tone: ChipTone;
}
interface ChipSpec {
  readonly label: () => string;
  readonly tone: ChipTone;
}
/** `before` is empty when the old value is unknown or the same as `after`; `after` is empty when the change has no single value to show. */
export interface PlanRowView {
  readonly label: string;
  readonly target: string;
  readonly before: string;
  readonly after: string;
  readonly icon: string;
}
type CardState = "drafting" | "waiting" | "applying" | "applied" | "unverified" | "undone" | "failed" | "discarded";
export interface ReceiptLine {
  readonly text: string;
  readonly tone: "ok" | "warn" | "bad";
  readonly body: string;
}

const ACTIONABLE: ReadonlySet<string> = new Set(["prepared", "presented"]);
const MAX_NOTICES = 8;

/** True for a plan that waits for the reader's Apply. */
export function isActionable(status: string): boolean {
  return ACTIONABLE.has(status);
}

const CHIPS: ReadonlyMap<string, ChipSpec> = new Map<string, ChipSpec>([
  ["draft", { label: () => t("plans.chip.drafting"), tone: "busy" }],
  ["prepared", { label: () => t("plans.chip.ready"), tone: "ready" }],
  ["presented", { label: () => t("plans.chip.ready"), tone: "ready" }],
  ["approved", { label: () => t("plans.chip.applying"), tone: "busy" }],
  ["applying", { label: () => t("plans.chip.applying"), tone: "busy" }],
  ["verified", { label: () => t("plans.chip.done"), tone: "ok" }],
  ["applied", { label: () => t("plans.chip.done"), tone: "ok" }],
  ["applied_unverified", { label: () => t("plans.chip.doneNotChecked"), tone: "warn" }],
  ["undone", { label: () => t("plans.chip.undone"), tone: "" }],
  ["partially_undone", { label: () => t("plans.chip.partlyUndone"), tone: "warn" }],
  ["undo_requested", { label: () => t("plans.chip.undoing"), tone: "busy" }],
  ["undo_unverified", { label: () => t("plans.chip.undoNotConfirmed"), tone: "bad" }],
  ["cancelled", { label: () => t("plans.chip.discarded"), tone: "" }],
]);

const DONE_CHIP: ChipSpec = { label: () => t("plans.chip.done"), tone: "ok" };

/** The chip for a status; a failed plan says whether anything reached After Effects. */
export function chipFor(status: string, mayHaveMutated: boolean): Chip {
  if (status === "failed") return mayHaveMutated ? { label: t("plans.chip.partlyApplied"), tone: "bad" } : { label: t("plans.chip.didntApply"), tone: "bad" };
  const spec = CHIPS.get(status) ?? DONE_CHIP;
  return { label: spec.label(), tone: spec.tone };
}

const CARD_STATES: ReadonlyMap<string, CardState> = new Map<string, CardState>([
  ["draft", "drafting"],
  ["prepared", "waiting"],
  ["presented", "waiting"],
  ["approved", "applying"],
  ["applying", "applying"],
  ["undo_requested", "applying"],
  ["verified", "applied"],
  ["applied", "applied"],
  ["applied_unverified", "unverified"],
  ["undone", "undone"],
  ["partially_undone", "undone"],
  ["undo_unverified", "failed"],
  ["failed", "failed"],
  ["cancelled", "discarded"],
]);

/** Which of the card's states a status draws; an unknown status reads as applied, like its chip. */
export function cardStateOf(status: string): CardState {
  return CARD_STATES.get(status) ?? "applied";
}

const ICONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/(delete|remove)/i, "close"],
  [/(animate|keyframe|expression|loop|opacity|position|scale|rotation)/i, "gauge"],
  [/(marker|timing|time|duration|work area)/i, "clock"],
  [/(render|queue)/i, "stop"],
  [/(folder|import|export|template)/i, "folder"],
  [/(add|create|duplicate|precompose|new)/i, "sparkle"],
];

function iconFor(label: string): string {
  return ICONS.find(([pattern]) => pattern.test(label))?.[1] ?? "edit";
}

function shown(value: JsonValue | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.slice(0, 40);
  if (typeof value === "number") return String(Math.round(value * 1000) / 1000);
  if (typeof value === "boolean") return value ? "on" : "off";
  return JSON.stringify(value).slice(0, 40);
}

function beforeOf(before: JsonValue | undefined, after: JsonValue | undefined): string {
  const left = shown(before);
  return left && left !== shown(after) && shown(after) ? left : "";
}

interface OperationLabel {
  readonly label: () => string;
  readonly icon: string;
}

const OPERATIONS: ReadonlyMap<string, OperationLabel> = new Map<string, OperationLabel>([
  ["cleanup_project", { label: () => t("plans.op.cleanup"), icon: "edit" }],
  ["create_layer", { label: () => t("plans.op.createLayer"), icon: "sparkle" }],
  ["duplicate_layer", { label: () => t("plans.op.duplicateLayer"), icon: "sparkle" }],
  ["derive_layer", { label: () => t("plans.op.deriveLayer"), icon: "edit" }],
  ["retime_layer", { label: () => t("plans.op.retimeLayer"), icon: "edit" }],
  ["dolly_camera", { label: () => t("plans.op.dollyCamera"), icon: "edit" }],
  ["remove_layer", { label: () => t("plans.op.removeLayer"), icon: "close" }],
  ["set_layer_name", { label: () => t("plans.op.renameLayer"), icon: "edit" }],
  ["set_layer_property", { label: () => t("plans.op.setProperty"), icon: "edit" }],
  ["animate_property", { label: () => t("plans.op.animateProperty"), icon: "gauge" }],
  ["set_expression", { label: () => t("plans.op.setExpression"), icon: "gauge" }],
  ["ensure_effect", { label: () => t("plans.op.addEffect"), icon: "sparkle" }],
  ["set_effect_control", { label: () => t("plans.op.setEffectControl"), icon: "edit" }],
  ["create_composition", { label: () => t("plans.op.createComposition"), icon: "sparkle" }],
  ["render_composition", { label: () => t("plans.op.renderComposition"), icon: "stop" }],
  ["import_file", { label: () => t("plans.op.importFile"), icon: "folder" }],
]);

function humanize(entry: string): string {
  const text = entry.trim();
  if (/^[a-z][a-z0-9_]*$/.test(text)) return OPERATIONS.get(text)?.label() ?? text.replace(/_/g, " ").replace(/^./, (first) => first.toUpperCase());
  const parts = text.split(" · ");
  return parts.length === 2 && parts[0] !== parts[1] ? parts[0] + " → " + parts[1] : parts[0] || text;
}

function valueRowView(row: PlanValueRow): PlanRowView {
  const label = row.label || t("plans.row.change");
  return { label, target: row.target, before: beforeOf(row.before, row.after), after: shown(row.after), icon: iconFor(label) };
}

function operationRowView(entry: string): PlanRowView {
  const label = humanize(entry);
  return { label, target: "", before: "", after: "", icon: OPERATIONS.get(entry.trim())?.icon ?? iconFor(label) };
}

/** One row per change, from the sidecar's value rows; with none, from the operation names, made readable. */
export function planRowsOf(rows: ReadonlyArray<PlanValueRow>, operations: ReadonlyArray<string>): PlanRowView[] {
  if (rows.length) return rows.map(valueRowView);
  return operations.map(operationRowView);
}

/** The notices a card shows: the first few. */
export function noticesOf(notices: ReadonlyArray<PlanNotice>): ReadonlyArray<PlanNotice> {
  return notices.slice(0, MAX_NOTICES);
}

/** How many changes cannot be checked: the operations the unverified notices point at, else the notices themselves. */
export function uncheckedCount(notices: ReadonlyArray<PlanNotice>): number {
  const indexes = new Set<number>();
  let plain = 0;
  for (const notice of notices) {
    if (notice.severity !== "unverified") continue;
    if (notice.operationIndexes.length) notice.operationIndexes.forEach((index) => indexes.add(index));
    else plain += 1;
  }
  return indexes.size + plain;
}

/** The primary button's label: one gate, with the unchecked count in it when approval must acknowledge them. */
export function applyLabel(requiresAcknowledgement: boolean, unchecked: number): string {
  if (!requiresAcknowledgement) return t("plans.apply.label");
  return unchecked > 0 ? t("plans.apply.unchecked", { count: unchecked }) : t("plans.apply.someUnchecked");
}

function receiptReason(receipt: Receipt | null): string {
  if (receipt === null) return "";
  return receipt.hostError?.message ?? receipt.error?.message ?? receipt.reason ?? "";
}

const SIMPLE_LINES: ReadonlyMap<string, () => ReceiptLine> = new Map<string, () => ReceiptLine>([
  ["undone", () => ({ text: t("plans.receipt.undone"), tone: "ok", body: "" })],
  ["partially_undone", () => ({ text: t("plans.chip.partlyUndone"), tone: "warn", body: t("plans.receipt.partlyUndoneBody") })],
  ["undo_unverified", () => ({ text: t("plans.receipt.undoneMismatch"), tone: "bad", body: "" })],
]);

interface ReceiptFacts {
  readonly status: string;
  readonly mayHaveMutated: boolean;
  readonly operations: number;
  readonly unchecked: number;
  readonly receipt: Receipt | null;
}

function uncheckedLine(input: ReceiptFacts): ReceiptLine {
  const known = input.unchecked > 0 && input.operations >= input.unchecked;
  const text = known ? t("plans.receipt.uncheckedCount", { unchecked: input.unchecked, operations: input.operations }) : t("plans.receipt.uncheckedSome");
  return { text, tone: "warn", body: t("plans.receipt.uncheckedBody") };
}

function failedLine(input: ReceiptFacts): ReceiptLine {
  const reason = receiptReason(input.receipt);
  if (!input.mayHaveMutated) return { text: t("plans.receipt.didntApply"), tone: "bad", body: reason };
  return { text: t("plans.chip.partlyApplied"), tone: "bad", body: reason || t("plans.receipt.partlyAppliedBody") };
}

/** The line after Apply: what happened in one sentence, with the detail one press away. */
export function receiptLine(input: ReceiptFacts): ReceiptLine | null {
  const { status } = input;
  if (status === "verified" || status === "applied") return { text: t("plans.receipt.checked"), tone: "ok", body: "" };
  if (status === "applied_unverified") return uncheckedLine(input);
  if (status === "failed") return failedLine(input);
  return SIMPLE_LINES.get(status)?.() ?? null;
}

/** Why Undo is not offered, by cause: a later extynt change on top, the user's own edits, or (the cause is not known) the project simply changed. */
export function undoBlockedLine(code: string | null | undefined): string {
  if (code === "UNDO_NOT_LATEST") return t("plans.undo.blockedLater");
  return code === "UNDO_PROJECT_CHANGED" ? t("plans.undo.blockedEdits") : t("plans.undo.blockedChanged");
}

/** A row as one line of words: "Animate Opacity · TITLE: 0 → 100", with the target and values left out when unknown. */
export function rowWords(row: PlanRowView): string {
  const values = row.after ? (row.before ? row.before + " → " + row.after : row.after) : "";
  return row.label + (row.target ? " · " + row.target : "") + (values ? ": " + values : "");
}
