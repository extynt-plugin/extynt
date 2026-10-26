/**
 * The sheet's Checklist: the job's phases with the current one open and the rest as counts, and the phase chips under the
 * sheet head. Read from the checklist the sidecar mirrors onto the job, so a reloaded or second panel shows the same.
 */
import { el } from "./panel-dom.js";
import { t } from "./panel-language.js";
import { touchStatus } from "./panel-status-signal.js";
import { section } from "./panel-sheet-waiting.js";
import type { UiChecklist, UiChecklistItem, UiJob } from "./ui-jobs.js";

const SHOWN_ITEMS = 6;
const opened = new Map<string, boolean>();

function currentPhase(checklist: UiChecklist): string {
  const item = checklist.items.find((entry) => entry.id === checklist.current);
  if (item) return item.phase;
  const open = checklist.items.find((entry) => entry.status !== "verified");
  return open ? open.phase : (checklist.phases.at(-1)?.name ?? "");
}

const MARKS = new Map<string, string>([
  ["verified", "ok"],
  ["unbuilt", "bad"],
]);

function mark(item: UiChecklistItem, current: boolean): string {
  if (item.status === "verified") return "✓";
  if (item.status === "unbuilt") return "!";
  return current ? "●" : "○";
}

function itemRow(item: UiChecklistItem, current: boolean): HTMLElement {
  const row = el("li", "check-row");
  row.setAttribute("data-mark", MARKS.get(item.status) ?? "skip");
  row.appendChild(el("span", "check-mark", mark(item, current)));
  row.appendChild(el("span", "check-text", item.title || item.id));
  return row;
}

function phaseNode(checklist: UiChecklist, phase: UiChecklist["phases"][number], now: string): HTMLElement {
  const done = phase.total > 0 && phase.verified >= phase.total;
  const open = opened.get(phase.name) ?? phase.name === now;
  const box = el("div", "check-phase");
  const head = el("button", "check-phase-head");
  head.type = "button";
  head.setAttribute("aria-expanded", open ? "true" : "false");
  head.appendChild(el("span", "check-mark", done ? "✓" : phase.name === now ? "▸" : "○"));
  head.appendChild(el("span", "check-text", phase.name));
  head.appendChild(el("span", "check-count", t("plans.checklist.count", { verified: phase.verified, total: phase.total })));
  head.addEventListener("click", () => {
    opened.set(phase.name, !open);
    touchStatus();
  });
  box.appendChild(head);
  if (open) {
    const items = checklist.items.filter((item) => item.phase === phase.name);
    const list = el("ul", "check-list");
    items.slice(0, SHOWN_ITEMS).forEach((item) => list.appendChild(itemRow(item, item.id === checklist.current)));
    if (items.length > SHOWN_ITEMS) list.appendChild(el("li", "check-more", t("plans.checklist.more", { count: items.length - SHOWN_ITEMS })));
    box.appendChild(list);
  }
  return box;
}

/** The Checklist section for the job, or nothing when the sidecar has not mirrored a checklist onto it. */
export function checklistSection(job: UiJob): HTMLElement | null {
  const checklist = job.checklist;
  if (!checklist || !checklist.items.length) return null;
  const box = section(job.cycle > 0 ? t("plans.checklist.cycle", { cycle: job.cycle }) : t("plans.checklist.title"));
  const now = currentPhase(checklist);
  checklist.phases.forEach((phase) => box.appendChild(phaseNode(checklist, phase, now)));
  return box;
}

/** "Layout 12/12", "Type 6/14", "Motion 0/20": the chips under the head, finished phases marked. */
export function phaseChips(job: UiJob): HTMLElement | null {
  const checklist = job.checklist;
  if (!checklist || !checklist.phases.length) return null;
  const row = el("div", "sheet-phases");
  checklist.phases.forEach((phase) => {
    const done = phase.total > 0 && phase.verified >= phase.total;
    row.appendChild(el("span", "sheet-phase" + (done ? " done" : ""), phase.name + " " + phase.verified + "/" + phase.total));
  });
  return row;
}
