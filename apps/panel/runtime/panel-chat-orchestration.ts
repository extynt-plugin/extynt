/** The roster of specialists a turn consulted, drawn under the answer: one chip per specialist, expandable to what it wrote. */
import { el } from "./panel-dom.js";
import { currentLanguage, t } from "./panel-language.js";
import { plainTextOf, type UiKey } from "@extynt/ui-text";
import type { OrchestrationSummary } from "./orchestration.js";

type Activity = OrchestrationSummary["activity"][number];
interface RoleState {
  readonly status: UiKey;
  readonly tone: string;
}

const ROLE_LABELS: ReadonlyMap<string, UiKey> = new Map<string, UiKey>([
  ["visual-scene", "chat.roles.visualScene"],
  ["motion", "chat.roles.motion"],
  ["execution", "chat.roles.execution"],
  ["planner", "chat.roles.planner"],
  ["reviewer", "chat.roles.reviewer"],
  ["expression", "chat.roles.expression"],
]);

const RUNNING: RoleState = { status: "chat.roles.status.working", tone: "pending" };
const FAILED: RoleState = { status: "chat.roles.status.needsCorrection", tone: "unavailable" };
const FINISHED: RoleState = { status: "chat.roles.status.finished", tone: "done" };
const UNAVAILABLE: RoleState = { status: "chat.roles.status.unavailable", tone: "unavailable" };
const CONSULTED: RoleState = { status: "chat.roles.status.consulted", tone: "done" };
const NOT_USED: RoleState = { status: "chat.roles.status.notUsed", tone: "pending" };

function textOf(key: UiKey): string {
  return plainTextOf(currentLanguage(), key);
}

const ACTIVITY_STATES: ReadonlyMap<Activity["status"], RoleState> = new Map([
  ["running", RUNNING],
  ["failed", FAILED],
  ["completed", FINISHED],
]);

const openStreams = new Set<string>();

function setOpen(chip: HTMLElement, open: boolean): void {
  chip.setAttribute("data-open", open ? "true" : "false");
  chip.setAttribute("aria-expanded", open ? "true" : "false");
}

function toggle(chip: HTMLElement, role: string): void {
  const open = chip.getAttribute("data-open") !== "true";
  setOpen(chip, open);
  if (open) openStreams.add(role);
  else openStreams.delete(role);
}

function makeExpandable(chip: HTMLElement, role: string, detail: string): void {
  chip.setAttribute("role", "button");
  setOpen(chip, openStreams.has(role));
  chip.tabIndex = 0;
  chip.appendChild(el("div", "agent-stream", detail));
  chip.onclick = (event) => {
    event.stopPropagation();
    toggle(chip, role);
  };
  chip.onkeydown = (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    chip.click();
  };
}

function chipFor(label: string, state: string, tone: string): HTMLElement {
  const chip = el("span", "agent-chip " + tone);
  chip.appendChild(el("span", "agent-role", label));
  chip.appendChild(el("span", "agent-status", " · " + state));
  return chip;
}

function stateOf(summary: OrchestrationSummary, role: string): RoleState {
  const activity = summary.activity.find((entry) => entry.role === role);
  if (activity) return ACTIVITY_STATES.get(activity.status) ?? FINISHED;
  if (summary.unavailable.some((entry) => entry.role === role)) return UNAVAILABLE;
  return summary.delegates.includes(role) ? CONSULTED : NOT_USED;
}

function involved(summary: OrchestrationSummary, role: string): boolean {
  return summary.activity.some((entry) => entry.role === role) || summary.delegates.includes(role) || summary.unavailable.some((entry) => entry.role === role);
}

function registryOf(summary: OrchestrationSummary): ReadonlyArray<{ readonly role: string; readonly label: string }> {
  if (summary.registry.length > 0) return summary.registry;
  return [...ROLE_LABELS].map(([role, label]) => ({ role, label: textOf(label) }));
}

/** Adds the roster for a turn's orchestration summary to the answer row: the plan-and-checks owner, then each specialist involved. */
export function appendOrchestrationRoster(parent: HTMLElement, summary: OrchestrationSummary): void {
  const roster = el("div", "agent-roster");
  roster.setAttribute("aria-label", t("chat.roles.roster"));
  const working = summary.activity.some((entry) => entry.status === "running");
  roster.appendChild(chipFor(textOf("chat.roles.planAndChecks"), textOf(working ? "chat.roles.status.coordinating" : "chat.roles.status.finished"), "owner"));
  registryOf(summary)
    .filter((entry) => involved(summary, entry.role))
    .forEach((entry) => {
      const state = stateOf(summary, entry.role);
      const chip = chipFor(entry.label, textOf(state.status), state.tone);
      const activity = summary.activity.find((item) => item.role === entry.role);
      const detail = activity ? [activity.reasoning, activity.text].filter(Boolean).join("\n\n") : "";
      if (detail) makeExpandable(chip, entry.role, detail);
      roster.appendChild(chip);
    });
  parent.appendChild(roster);
}
