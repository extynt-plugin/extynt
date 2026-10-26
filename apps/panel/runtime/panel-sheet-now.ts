/**
 * The sheet's "Now": what is working this moment. The main agent's step, each specialist the sidecar mirrors onto the job
 * (so a reloaded or second panel sees them), and every outside call, as a row with a dashed source tag and no controls:
 * watching an outside agent is a tag, not a tab.
 */
import { el } from "./panel-dom.js";
import { touchStatus } from "./panel-status-signal.js";
import { prettyClient, prettyTool } from "./panel-bar.js";
import { liveReasoning, liveProgress } from "./panel-progress.js";
import { section } from "./panel-sheet-waiting.js";
import { t } from "./panel-language.js";
import { nowCalls } from "./panel-sheet-model.js";
import type { UiJob, UiMcpCall, UiSpecialist } from "./ui-jobs.js";

let reasoningOpen = false;

function clockWords(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return Math.floor(total / 60) + ":" + (total % 60 < 10 ? "0" : "") + (total % 60);
}

interface NowRow {
  readonly tag: string;
  readonly name: string;
  readonly text: string;
  readonly tail: string;
  readonly dashed: boolean;
}

function row(entry: NowRow): HTMLElement {
  const node = el("div", "now-row" + (entry.dashed ? " outside" : ""));
  node.appendChild(el("span", entry.dashed ? "source-tag" : "role-tag", entry.tag));
  node.appendChild(el("span", "now-text", entry.text || entry.name));
  if (entry.tail) node.appendChild(el("span", "now-tail", entry.tail));
  return node;
}

function specialistTail(entry: UiSpecialist, nowMs: number): string {
  if (entry.elapsedMs !== null) return clockWords(entry.elapsedMs);
  const started = Date.parse(entry.startedAt);
  return isFinite(started) ? clockWords(nowMs - started) : "";
}

function specialistWords(state: UiSpecialist["state"]): string {
  if (state === "running") return t("status.now.working");
  return state === "done" ? t("status.now.finished") : t("status.now.needsCorrection");
}

function callTail(call: UiMcpCall): string {
  if (call.state === "running") return t("status.call.applying");
  if (call.state === "error") return call.code ?? t("status.call.failed");
  if (call.ms === null) return t("status.call.ok");
  return call.ms < 1000 ? t("status.call.ms", { count: call.ms }) : t("status.call.seconds", { seconds: (call.ms / 1000).toFixed(1) });
}

function mainRow(job: UiJob | null): HTMLElement {
  const progress = liveProgress(), text = job && job.activity ? job.activity : progress ? progress.label : t("status.now.thinking");
  const node = row({ tag: t("status.now.main"), name: "main", text, tail: job && job.step > 0 ? t("status.job.step", { count: job.step }) : "", dashed: false });
  const detail = liveReasoning();
  if (detail) {
    node.setAttribute("role", "button");
    node.tabIndex = 0;
    node.setAttribute("aria-expanded", reasoningOpen ? "true" : "false");
    node.addEventListener("click", () => { reasoningOpen = !reasoningOpen; touchStatus(); });
  }
  return node;
}

/** The "Now" section: the main step, each specialist, and every running outside call. */
export function nowSection(job: UiJob | null, turnOpen: boolean, calls: ReadonlyArray<UiMcpCall>, nowMs: number): HTMLElement {
  const box = section(t("status.sheet.now"));
  if (job || turnOpen) {
    box.appendChild(mainRow(job));
    if (reasoningOpen && liveReasoning()) box.appendChild(el("div", "now-detail", liveReasoning()));
    (job ? job.specialists : []).forEach((entry) => box.appendChild(row({ tag: entry.label || entry.role, name: entry.role, text: specialistWords(entry.state), tail: specialistTail(entry, nowMs), dashed: false })));
  }
  nowCalls(calls, nowMs).forEach((call) => box.appendChild(row({ tag: prettyClient(call.client), name: call.tool, text: prettyTool(call.tool), tail: callTail(call), dashed: true })));
  return box;
}
