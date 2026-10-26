/**
 * The sheet's "Needs a look" and "Changes": what happened to the project, newest first. Undo lives on these rows and nowhere
 * else. A long job folds its verified runs into one line each (by job and batch, as the sidecar names them); failures, held
 * plans and the live batch stay open with their operations, before and after frames, and Retry or Undo.
 */
import { changeRowsNow, changesAnswer } from "./panel-changes-feed.js";
import { foldChanges, needsLook, type ChangeItem, type ChangeRow } from "./panel-changes.js";
import { el } from "./panel-dom.js";
import { t } from "./panel-language.js";
import { section } from "./panel-sheet-waiting.js";
import { changeNote, foldIsOpen, resultWords, retryable, rowNode, toggleFold, focusChange } from "./panel-sheet-change-row.js";
import { filterRows, hasOutsideWork, type ChangeFilter } from "./panel-sheet-model.js";
import { touchStatus } from "./panel-status-signal.js";
import type { UiMcpCall } from "./ui-jobs.js";

type Fold = Extract<ChangeItem, { kind: "fold" }>;

const FILTERS: ReadonlyArray<readonly [ChangeFilter, () => string]> = [
  ["all", () => t("plans.filter.all")],
  ["agent", () => t("plans.filter.agent")],
  ["mcp", () => "MCP"],
];

let filter: ChangeFilter = "all";

function foldNode(item: Fold): HTMLElement[] {
  const open = foldIsOpen(item.id);
  const head = el("button", "change-fold");
  head.type = "button";
  head.setAttribute("aria-expanded", open ? "true" : "false");
  head.appendChild(el("span", "fold-text", item.label));
  head.appendChild(el("span", "fold-more", open ? "⌄" : "›"));
  head.addEventListener("click", () => toggleFold(item.id));
  return open ? [head, ...item.rows.map(rowNode)] : [head];
}

function chips(): HTMLElement {
  const group = el("div", "filter-chips");
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", t("plans.filter.label"));
  FILTERS.forEach(([id, label]) => {
    const chip = el("button", "chip" + (filter === id ? " on" : ""), label());
    chip.type = "button";
    chip.setAttribute("aria-pressed", filter === id ? "true" : "false");
    chip.addEventListener("click", () => {
      filter = id;
      touchStatus();
    });
    group.appendChild(chip);
  });
  return group;
}

function lookRow(row: ChangeRow): HTMLElement {
  const line = el("button", "look-row");
  line.type = "button";
  line.appendChild(el("span", "look-mark", "!"));
  line.appendChild(el("span", "look-text", row.title + " · " + resultWords(row)));
  line.appendChild(el("span", "look-go", retryable(row) ? t("plans.look.retry") : t("plans.look.open")));
  line.addEventListener("click", () => {
    focusChange(row.planId);
    touchStatus();
  });
  return line;
}

/** "Needs a look": the changes that applied only in part, could not be fully checked, or whose undo is not settled. */
export function lookSection(rows: ReadonlyArray<ChangeRow>): HTMLElement {
  const needing = rows.filter(needsLook);
  const box = section(t("plans.look.title"), needing.length);
  needing.forEach((row) => box.appendChild(lookRow(row)));
  return box;
}

function itemNodes(item: ChangeItem): HTMLElement[] {
  return item.kind === "row" ? [rowNode(item.row)] : foldNode(item);
}

/** "Changes · newest first": the filter chips when outside agents have worked, the last note, and the rows with folded runs. */
export function changesSection(calls: ReadonlyArray<UiMcpCall>): HTMLElement {
  const rows = changeRowsNow();
  const box = section(t("plans.changes.title"));
  if (hasOutsideWork(calls, rows)) box.appendChild(chips());
  const note = changeNote(changesAnswer()?.changes ?? []);
  if (note) box.appendChild(el("div", "plan-sub", note));
  const shown = filterRows(rows, filter);
  if (shown.length === 0) box.appendChild(el("div", "muted", t("plans.changes.empty")));
  foldChanges(shown).forEach((item) => itemNodes(item).forEach((node) => box.appendChild(node)));
  return box;
}
