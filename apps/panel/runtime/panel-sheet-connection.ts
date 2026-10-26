/**
 * The sheet's "Connection": each link (the helper, After Effects, the model), what the job is doing about it, and, when
 * extynt paused changes because it could not confirm the last one, the steps to clear that and a Done that asks again.
 */
import { el } from "./panel-dom.js";
import { section } from "./panel-sheet-waiting.js";
import { touchStatus } from "./panel-status-signal.js";
import { loadBootstrap } from "./ui-api.js";
import { dispatch, uiState } from "./ui-state.js";
import { countOf } from "./panel-bar.js";
import { t } from "./panel-language.js";
import type { Quarantine } from "./native-quarantine.js";
import type { UiJob } from "./ui-jobs.js";

type QuarantineKind = Quarantine["kind"];

function blockHappened(kind: QuarantineKind): string {
  if (kind === "mutation") return t("status.block.mutation");
  return kind === "read" ? t("status.block.read") : t("status.block.unknown");
}

function blockSteps(): ReadonlyArray<string> {
  return [t("status.block.step1"), t("status.block.step2"), t("status.block.step3"), t("status.block.step4")];
}

type Outcome = "" | "checking" | "still-blocked";

let recoveryOpen = false;
let outcome: Outcome = "";
let checking = false;

/** Opens the steps to clear a block, from the bar's "What happened". */
export function openRecovery(): void {
  recoveryOpen = true;
  outcome = "";
  touchStatus();
}

function outcomeWords(): string {
  if (outcome === "checking") return t("status.action.checking");
  return outcome === "still-blocked" ? t("status.block.stillBlocked") : "";
}

function linkRow(name: string, value: string, ok: boolean): HTMLElement {
  const row = el("div", "link-row");
  const dot = el("span", "dot");
  dot.setAttribute("data-state", ok ? "connected" : "offline");
  row.appendChild(dot);
  row.appendChild(el("span", "status-name", name));
  row.appendChild(el("span", "link-value", value));
  return row;
}

function stallWords(host: NonNullable<ReturnType<typeof uiState>["host"]>): string {
  if (host.stall?.verdict === "ae-busy") return host.stall.dialog ? t("status.link.busyDialog", { title: host.stall.dialog.title }) : t("status.link.busy");
  return host.stall ? t("status.link.notResponding") : t("status.link.notConnected");
}

function hostWords(): { readonly value: string; readonly ok: boolean } {
  const host = uiState().host;
  if (!host) return { value: t("status.link.notReported"), ok: false };
  const version = host.aeVersion ? host.aeVersion + " · " : "";
  const connected = host.state === "online" && !host.stall;
  return { value: version + (connected ? t("status.link.connected") : stallWords(host)), ok: connected };
}

function checkAgain(): void {
  if (checking) return;
  checking = true;
  outcome = "checking";
  touchStatus();
  loadBootstrap((reply) => {
    checking = false;
    if (reply.ok) dispatch({ type: "bootstrap", bootstrap: reply.value });
    const cleared = reply.ok && !uiState().quarantine;
    outcome = cleared ? "" : "still-blocked";
    if (cleared) recoveryOpen = false;
    touchStatus();
  });
}

function stepRow(text: string): HTMLElement {
  const row = el("li");
  const label = el("label");
  const box = el("input");
  box.type = "checkbox";
  label.appendChild(box);
  label.appendChild(el("span", "", text));
  row.appendChild(label);
  return row;
}

function recovery(kind: QuarantineKind): HTMLElement {
  const box = el("div", "state-note");
  const steps = el("ol", "state-steps");
  const done = el("button", "primary", t("status.action.done"));
  const actions = el("div", "state-actions");
  blockSteps().forEach((text) => steps.appendChild(stepRow(text)));
  done.type = "button";
  done.addEventListener("click", checkAgain);
  const result = el("span", "state-outcome", outcomeWords());
  result.setAttribute("role", "status");
  actions.appendChild(done);
  actions.appendChild(result);
  box.appendChild(el("p", "state-head", t("status.block.title")));
  box.appendChild(el("p", "", blockHappened(kind)));
  box.appendChild(steps);
  box.appendChild(el("p", "state-fine", t("status.block.fallback")));
  box.appendChild(actions);
  return box;
}

function modelWords(configured: boolean | null | undefined): string {
  if (configured === false) return t("status.link.notSetUp");
  return configured ? t("status.link.configured") : t("status.link.unknown");
}

function progressWords(job: UiJob): string {
  const [done = "0", total = "0"] = countOf(job).split("/");
  const values = { done: done, total: total };
  return job.cycle > 0 ? t("status.job.progressCycle", { ...values, cycle: t("status.job.cycle", { count: job.cycle }) }) : t("status.job.progress", values);
}

function pausedLine(job: UiJob): string {
  return countOf(job) ? t("status.connection.pausedAt", { progress: progressWords(job) }) : t("status.connection.paused");
}

function quarantineNode(kind: QuarantineKind): HTMLElement {
  if (recoveryOpen) return recovery(kind);
  const open = el("button", "ghost", t("status.action.whatHappened"));
  open.type = "button";
  open.addEventListener("click", openRecovery);
  return open;
}

/** The Connection section: one row per link, the paused job's note, and the recovery steps when blocked. */
export function connectionSection(job: UiJob | null): HTMLElement {
  const state = uiState();
  const box = section(t("status.sheet.connection"));
  const host = hostWords();
  box.appendChild(linkRow(t("status.link.helper"), state.reachable ? (state.sidecarVersion || t("status.link.running")) : t("status.link.notReachable"), state.reachable));
  box.appendChild(linkRow(t("status.link.afterEffects"), host.value, host.ok));
  box.appendChild(linkRow(t("status.link.model"), modelWords(state.modelConfigured), state.modelConfigured === true));
  if (job && (!host.ok || !state.reachable)) box.appendChild(el("p", "plan-sub", pausedLine(job)));
  if (state.quarantine) box.appendChild(quarantineNode(state.quarantine.kind));
  return box;
}
