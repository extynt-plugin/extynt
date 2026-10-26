/** The pieces a plan's detail is built from in the sheet: the change rows, inline notices, expressions and the receipt's checklist. */
import { el } from "./panel-dom.js";
import { iconElement } from "./panel-reasoning.js";
import { MARK_GLYPHS, checklistSummary, markWord, type CheckItem } from "./panel-plan-checks.js";
import { t } from "./panel-language.js";
import { noticesOf, type PlanRowView } from "./panel-plan-labels.js";
import type { PlanExpression, PlanNotice } from "./plan-content.js";

const VISIBLE_ROWS = 4;
const MAX_EXPRESSIONS = 8;
const EXPRESSION_CHARS = 400;
const NOTICE_TONES: ReadonlyMap<string, string> = new Map([["error", "bad"], ["unverified", "warn"]]);

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const node = el("button", className, label);
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
}

function valuesNode(row: PlanRowView): HTMLElement | null {
  if (!row.after) return null;
  const values = el("span", "plan-op-values", ": ");
  if (row.before) { values.appendChild(el("span", "plan-op-before", row.before)); values.appendChild(document.createTextNode(" → ")); }
  values.appendChild(el("span", "plan-op-after", row.after));
  return values;
}

function rowNode(row: PlanRowView): HTMLElement {
  const item = el("li");
  const mark = iconElement(row.icon, 12);
  const text = el("span", "plan-op-text");
  if (mark) item.appendChild(mark);
  text.appendChild(el("span", "plan-op-label", row.label));
  if (row.target) text.appendChild(el("span", "plan-op-target", " · " + row.target));
  const values = valuesNode(row);
  if (values) text.appendChild(values);
  item.appendChild(text);
  return item;
}

/** "What will change": up to four rows, then "+N more", which `onMore` expands in place. */
export function rowsBlock(rows: ReadonlyArray<PlanRowView>, expanded: boolean, onMore: () => void): HTMLElement[] {
  if (!rows.length) return [];
  const list = el("ul", "plan-ops");
  (expanded ? rows : rows.slice(0, VISIBLE_ROWS)).forEach((row) => list.appendChild(rowNode(row)));
  const out: HTMLElement[] = [el("div", "plan-ops-title", t("plans.rows.title")), list];
  if (rows.length > VISIBLE_ROWS && !expanded) out.push(button(t("plans.rows.more", { count: rows.length - VISIBLE_ROWS }), "plan-ops-more", onMore));
  return out;
}

function noticeNode(notice: PlanNotice): HTMLElement {
  const note = el("details", "plan-note");
  const tone = NOTICE_TONES.get(notice.severity) ?? "";
  if (tone) note.setAttribute("data-tone", tone);
  if (notice.severity === "error") note.setAttribute("open", "");
  note.appendChild(el("summary", "", notice.title));
  const body = el("div", "plan-note-body");
  body.appendChild(document.createTextNode([notice.detail, notice.because].filter(Boolean).join(" ")));
  if (notice.action) body.appendChild(el("div", "plan-note-action", notice.action));
  note.appendChild(body);
  return note;
}

/** The plan's notices as folded notes, or its plain warnings when it has no notices. */
export function noticesBlock(notices: ReadonlyArray<PlanNotice>, warnings: ReadonlyArray<string>): HTMLElement[] {
  const views = noticesOf(notices);
  return views.length ? views.map(noticeNode) : warnings.map((warning) => el("div", "plan-warning", warning));
}

/** The first expressions a plan sets, each as a label and an excerpt. */
export function expressionBlocks(expressions: ReadonlyArray<PlanExpression>): HTMLElement[] {
  return expressions.slice(0, MAX_EXPRESSIONS).flatMap((entry) => {
    if (!entry.source) return [];
    return [
      el("div", "plan-sub", entry.propertyPath ? t("plans.expr.on", { path: entry.propertyPath }) : t("plans.expr.title")),
      el("div", "result", entry.source.slice(0, EXPRESSION_CHARS)),
    ];
  });
}

function checkNode(item: CheckItem): HTMLElement {
  const row = el("li", "check-row");
  const mark = el("span", "check-mark", MARK_GLYPHS[item.mark]);
  const text = el("span", "check-text", item.label);
  row.setAttribute("data-mark", item.mark);
  mark.setAttribute("role", "img");
  mark.setAttribute("aria-label", markWord(item.mark));
  row.appendChild(mark);
  if (item.note) text.appendChild(el("span", "check-note", item.note));
  row.appendChild(text);
  return row;
}

/** One entry per change, closed until opened. */
export function checklistNode(items: ReadonlyArray<CheckItem>): HTMLElement | null {
  if (!items.length) return null;
  const summary = checklistSummary(items);
  const box = el("details", "receipt-checklist");
  const list = el("ul", "check-list");
  box.setAttribute("data-tone", summary.tone);
  box.appendChild(el("summary", "", summary.text));
  items.forEach((item) => list.appendChild(checkNode(item)));
  box.appendChild(list);
  return box;
}
