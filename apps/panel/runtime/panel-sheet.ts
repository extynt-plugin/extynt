/**
 * The sheet: what lifts from the status bar when it is pressed. The bar becomes its header, so Stop, Apply and the time left
 * are the same controls and do not move or double. Below it, sections appear only when they have something to say (see
 * panel-sheet-model.ts): Waiting for you, Now, Needs a look, Checklist, Changes, Connection, and the job's spend. The composer
 * stays below the sheet for steering.
 */
import { elapsedWords } from "./panel-bar.js";
import { changeRowsNow, refreshChanges } from "./panel-changes-feed.js";
import { byId, clearChildren, el } from "./panel-dom.js";
import { connectionSection } from "./panel-sheet-connection.js";
import { focusChange, takeFocusedChange } from "./panel-sheet-change-row.js";
import { changesSection, lookSection } from "./panel-sheet-changes.js";
import { checklistSection, phaseChips } from "./panel-sheet-checklist.js";
import { visibleSections, type SheetFacts, type SheetSection } from "./panel-sheet-model.js";
import { nowSection } from "./panel-sheet-now.js";
import { waitingSection } from "./panel-sheet-waiting.js";
import { endedJob, liveSpend, runningJob } from "./panel-progress.js";
import { getCurrentSessionId } from "./panel-sessions.js";
import { onStatusTouched, touchStatus } from "./panel-status-signal.js";
import { formatTokenCount } from "./panel-usage.js";
import { waitingAt, waitingItems } from "./panel-waiting.js";
import { hooks } from "./panel-hooks.js";
import { subscribeUi, uiState } from "./ui-state.js";
import { onLanguageChange, t } from "./panel-language.js";

let open = false;

export function sheetOpen(): boolean { return open; }

function factsNow(): SheetFacts {
  const state = uiState(), running = runningJob(), job = running ?? endedJob(getCurrentSessionId());
  return {
    waiting: waitingItems(), job: job, jobRunning: running !== null, turnOpen: hooks.isChatInFlight(), calls: state.mcpCalls, nowMs: Date.now(), rows: changeRowsNow(),
    reachable: state.reachable, host: state.host, quarantined: state.quarantine !== null, modelConfigured: state.modelConfigured, spend: job !== null && liveSpend() !== null,
  };
}

function head(facts: SheetFacts): HTMLElement | null {
  const job = facts.job;
  if (!job) return null;
  const box = el("div", "sheet-head"), items = job.checklist ? job.checklist.items : [], done = items.filter((item) => item.status === "verified").length;
  const line = [job.goal, items.length ? t("status.sheet.items", { done: done, total: items.length }) : "", facts.jobRunning ? "" : elapsedWords(job.startedAt, facts.nowMs)].filter(Boolean).join(" · ");
  if (line) box.appendChild(el("div", "sheet-job", line));
  const chips = phaseChips(job);
  if (chips) box.appendChild(chips);
  return box.firstChild ? box : null;
}

function spendLine(): HTMLElement | null {
  const spend = liveSpend();
  if (!spend) return null;
  const guard = uiState().prefs.rateLimit ? t("status.spend.guardOn") : t("status.spend.guardOff");
  return el("div", "plan-sub sheet-spend", t("status.spend.line", { input: formatTokenCount(spend.input), output: formatTokenCount(spend.output), guard: guard }));
}

const SECTION_BUILDERS = {
  waiting: (facts) => waitingSection(facts.waiting, waitingAt(facts.waiting)),
  now: (facts) => nowSection(facts.jobRunning ? facts.job : null, facts.turnOpen, facts.calls, facts.nowMs),
  look: (facts) => lookSection(facts.rows),
  checklist: (facts) => (facts.job ? checklistSection(facts.job) : null),
  changes: (facts) => changesSection(facts.calls),
  connection: (facts) => connectionSection(facts.job),
  spend: () => spendLine(),
} as const satisfies Record<SheetSection, (facts: SheetFacts) => HTMLElement | null>;

function render(): void {
  const node = byId("sheet");
  if (!node || !open) return;
  const scroll = node.scrollTop, facts = factsNow(), sections = visibleSections(facts);
  clearChildren(node);
  const top = head(facts);
  if (top) node.appendChild(top);
  sections.forEach((name) => { const built = SECTION_BUILDERS[name](facts); if (built) node.appendChild(built); });
  if (!sections.length) node.appendChild(el("p", "muted sheet-empty", t("status.sheet.empty")));
  node.scrollTop = scroll;
  takeFocusedChange(node);
}

function paintShell(): void {
  const zone = byId("status-zone"), node = byId("sheet"), app = byId("app");
  if (zone) zone.setAttribute("data-open", open ? "true" : "false");
  if (app) app.setAttribute("data-sheet", open ? "open" : "closed");
  if (node) node.hidden = !open;
  if (open) render();
}

export function openSheet(planId?: string): void {
  if (planId) focusChange(planId);
  if (!open) {
    open = true;
    refreshChanges();
    hooks.refreshPlans();
  }
  paintShell();
  touchStatus();
}

function closeSheet(): void {
  if (!open) return;
  open = false;
  paintShell();
  touchStatus();
}

export function flipSheet(): void { if (open) closeSheet(); else openSheet(); }

export function wireSheet(): void {
  onStatusTouched(() => { if (open) render(); });
  onLanguageChange(() => { if (open) render(); });
  subscribeUi((topic) => { if (open && (topic === "host" || topic === "reach" || topic === "model" || topic === "activity" || topic === "mcp" || topic === "undo")) render(); });
  paintShell();
}

