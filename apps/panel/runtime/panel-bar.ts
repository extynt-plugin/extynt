/**
 * The status bar as a pure derivation: what the one strip above the composer says and offers, from the facts the panel
 * holds. No DOM here, so every state and its priority is a unit test.
 *
 * One state at a time, by priority: blocked, offline, needs-you (a decision only the user can make), locked (no model),
 * working, outside (only an outside MCP agent works), advisory, waiting (no first project read yet), learning, finished
 * and idle. It replaces the status banner, the catalogue line, the live step line, the pause card and the plans badge.
 * Stop, Apply, Discard and Continue exist only in the actions it returns.
 */
import type { Quarantine } from "./native-quarantine.js";
import type { CatalogueLine } from "./panel-catalogue-line.js";
import { timeLeft, type TimeLeft } from "./panel-bar-eta.js";
import type { HostStatus } from "./ui-contract.js";
import type { UiJob, UiMcpCall } from "./ui-jobs.js";
import { t } from "./panel-language.js";

type BarState = "blocked" | "offline" | "needs-you" | "locked" | "working" | "outside" | "learning" | "finished" | "idle";
type BarTone = "red" | "grey" | "amber" | "accent" | "dashed" | "quiet";
/** The buttons the bar can offer; Stop, Apply, Discard and Continue are reachable from nowhere else. */
export type BarActionId = "stop" | "apply" | "discard" | "continue" | "approve-brief" | "use-variant" | "variant-none" | "retry" | "help" | "setup";
/** One button: its action, label and style, and whether a press is out. */
export interface BarAction {
  readonly id: BarActionId;
  readonly label: string;
  readonly style: "primary" | "ghost" | "danger";
  readonly disabled?: boolean;
}

/**
 * A decision waiting for the user. `kind` says which button set the bar shows. `prompt` is the bar's question ("Apply batch
 * 8?", "Pick an easing"); `detail` the line under it (what applying does, how many options, what Continue does); `source` who
 * asked ("extynt" for the panel's own chat, otherwise the outside agent's name); `choiceLabel` the variant button ("Use soft
 * out"); `busy` that a press is out so the buttons wait; `note` what the last press said, shown in place of the detail.
 */
export interface WaitingItem {
  readonly kind: "plan" | "variant" | "pause" | "approval";
  readonly id: string;
  readonly title: string;
  readonly prompt: string;
  readonly detail: string;
  readonly source: string;
  readonly external: boolean;
  readonly applyLabel: string;
  readonly choiceLabel: string;
  readonly busy: boolean;
  readonly note: string;
}

/** What the finished line counts: verified checklist items over all of them, items applied only in part, and changes. */
export interface FinishedFacts {
  readonly verified: number;
  readonly total: number;
  readonly partly: number;
  readonly changes: number;
}
/** How many checklist items the finished line counts as done: the verified ones, or the plans applied when those are more because a plan was not tied to an item. */
export function doneItems(count: { readonly verified: number; readonly total: number; readonly applied: number }): number {
  return Math.max(count.verified, Math.min(count.total, count.applied));
}

/** The state of a stop request: stopping while it is out; failed and stopped carry the sidecar's words. */
export interface StopNote {
  readonly phase: "stopping" | "failed" | "stopped";
  readonly text: string;
}

/**
 * The facts the bar is derived from. `job` is the job the sidecar runs now; `turnOpen` is true while this panel's own request
 * is open; `progress` is what that request is doing now, from its progress poll; `calls` are MCP calls from outside agents;
 * `waitingAt` picks which waiting item the buttons act on; `awaitingSnapshot` means the host is paired but its first read of
 * the project has not landed, so nothing can plan or apply yet.
 */
export interface BarInputs {
  readonly reachable: boolean;
  readonly unreachableMs: number;
  readonly host: HostStatus | null;
  readonly hostSinceMs: number;
  readonly quarantine: Quarantine | null;
  readonly modelConfigured: boolean | null;
  readonly nowMs: number;
  readonly job: UiJob | null;
  readonly turnOpen: boolean;
  readonly progress: { readonly label: string; readonly step: number } | null;
  readonly stop: StopNote | null;
  readonly calls: ReadonlyArray<UiMcpCall>;
  readonly waiting: ReadonlyArray<WaitingItem>;
  readonly waitingAt: number;
  readonly learning: CatalogueLine | null;
  readonly finished: FinishedFacts | null;
  readonly project: string | null;
  readonly changeCount: number | null;
  readonly awaitingSnapshot: boolean;
}

interface BarSegment {
  readonly name: string;
  readonly verified: number;
  readonly total: number;
}

/**
 * What the bar draws. `text` is the line in the collapsed bar and `sub` the second line (step detail, the count of what is
 * held, the reason). `title` and `meta` are the open sheet's head ("Working" / "cycle 3 · 41 min"); empty reuses text and sub.
 * `eta` is "≈ 20–30 min left", "estimating…" or "ETA resumes when connected", empty when there is none. `chip` is the dashed
 * chip of an outside agent working beside the user's own job.
 */
export interface BarView {
  state: BarState;
  tone: BarTone;
  text: string;
  sub: string;
  title: string;
  meta: string;
  eta: string;
  slowing: boolean;
  count: string;
  actions: BarAction[];
  stepper: { readonly at: number; readonly of: number } | null;
  segments: BarSegment[];
  chip: string;
  tag: string;
  alert: boolean;
}

const SHOW_OFFLINE_AFTER_MS = 3000;
const OFFLINE_LONG_AFTER_MS = 10000;
const FLOOR_MAJOR = 25;
const MIN_WAIT_MS = 250;


function blank(state: BarState, tone: BarTone, text: string): BarView {
  return { state: state, tone: tone, text: text, sub: "", title: "", meta: "", eta: "", slowing: false, count: "", actions: [], stepper: null, segments: [], chip: "", tag: "", alert: false };
}

function hostDown(host: HostStatus): boolean {
  if (host.state === "offline" || host.state === "connecting" || host.state === "closing") return true;
  return host.state === "stalled" && host.stall !== null && host.stall.verdict === "plugin-unresponsive";
}

function busyText(stall: NonNullable<HostStatus["stall"]>): string {
  return stall.dialog ? t("status.bar.dialogWaiting", { title: stall.dialog.title }) : t("status.bar.busy");
}

/** "claude-code" and "claude_code" read as "Claude Code". */
export function prettyClient(client: string): string {
  const words = client.split(/[-_\s]+/).filter(Boolean);
  return words.length ? words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ") : t("status.client.fallback");
}

/** "ae_propose_plan" reads as "propose plan". */
export function prettyTool(tool: string): string { return tool.replace(/^ae_/, "").replace(/_/g, " "); }


/** 41 min, 2 h 06 min. */
export function elapsedWords(startedAt: string, nowMs: number): string {
  const started = Date.parse(startedAt);
  if (!isFinite(started)) return "";
  const minutes = Math.max(0, Math.floor((nowMs - started) / 60000));
  if (minutes < 60) return t("status.time.minutes", { count: minutes });
  const rest = minutes % 60;
  return t("status.time.hoursMinutes", { hours: Math.floor(minutes / 60), minutes: (rest < 10 ? "0" : "") + rest });
}

/** "18/60": verified checklist items over all of them. Empty when the job has no checklist. */
export function countOf(job: UiJob | null): string {
  const list = job && job.checklist ? job.checklist.items : [];
  if (!list.length) return "";
  return list.filter((item) => item.status === "verified").length + "/" + list.length;
}

function cycleStepOf(inputs: BarInputs): string {
  const job = inputs.job, step = job && job.step > 0 ? job.step : inputs.progress && inputs.progress.step > 0 ? inputs.progress.step : 0;
  return [job && job.cycle > 0 ? t("status.job.cycle", { count: job.cycle }) : "", step > 0 ? t("status.job.step", { count: step }) : ""].filter(Boolean).join(" · ");
}

function segmentsOf(job: UiJob | null): BarSegment[] {
  const phases = job && job.checklist ? job.checklist.phases : [];
  return phases.map((phase) => ({ name: phase.name, verified: phase.verified, total: phase.total }));
}

function stoppable(inputs: BarInputs): boolean { return inputs.job !== null || inputs.turnOpen; }

function stopAction(inputs: BarInputs): BarAction[] {
  if (!stoppable(inputs)) return [];
  if (inputs.stop && inputs.stop.phase === "stopping") return [{ id: "stop", label: t("status.bar.stopping"), style: "danger", disabled: true }];
  return [{ id: "stop", label: t("status.action.stop"), style: "danger" }];
}

function activityText(inputs: BarInputs): string {
  const job = inputs.job;
  if (job && job.activity) return job.activity;
  return inputs.progress && inputs.progress.label ? inputs.progress.label : t("status.bar.thinking");
}

function stopSub(inputs: BarInputs): string { return inputs.stop ? inputs.stop.text || t("status.bar.stopping") : ""; }

function etaOf(inputs: BarInputs, state: { paused: boolean; linkDown: boolean }): TimeLeft {
  const job = inputs.job;
  if (!job || !job.checklist) return { kind: "hidden" };
  return timeLeft({ startedAt: job.startedAt, waits: job.waits, items: job.checklist.items, nowMs: inputs.nowMs }, state);
}

function jobSummary(inputs: BarInputs): string {
  const job = inputs.job;
  if (!job) return "";
  return [countOf(job) ? t("status.bar.jobPausedItems", { items: countOf(job) }) : t("status.bar.jobPaused"), job.cycle > 0 ? t("status.job.cycle", { count: job.cycle }) : ""].filter(Boolean).join(" · ");
}

function olderView(host: HostStatus | null): BarView | null {
  if (!host || (host.state !== "online" && host.state !== "stalled")) return null;
  const major = host.aeVersion === null ? NaN : parseInt(host.aeVersion, 10);
  if (!(major < FLOOR_MAJOR)) return null;
  const view = blank("blocked", "red", t("status.bar.tooOld", { version: host.aeVersion ?? "", minimum: FLOOR_MAJOR }));
  view.alert = true;
  return view;
}

function blockedView(inputs: BarInputs): BarView | null {
  if (inputs.quarantine) {
    const view = blank("blocked", "red", t("status.bar.blocked"));
    view.alert = true;
    view.actions = [{ id: "help", label: t("status.action.whatHappened"), style: "ghost" }, ...stopAction(inputs)];
    view.sub = stopSub(inputs);
    return view;
  }
  return olderView(inputs.host);
}

function helperView(inputs: BarInputs): BarView | null {
  if (inputs.unreachableMs < SHOW_OFFLINE_AFTER_MS) return null;
  const long = inputs.unreachableMs >= OFFLINE_LONG_AFTER_MS, view = blank("offline", "grey", long ? t("status.bar.helper") : t("status.bar.reconnecting"));
  if (long) view.actions = [{ id: "retry", label: t("status.action.tryAgain"), style: "ghost" }];
  return view;
}

function awayView(inputs: BarInputs): BarView {
  const view = blank("offline", "grey", t("status.bar.awayTitle")), job = inputs.job;
  view.sub = t("status.bar.awayHint");
  if (job) {
    const eta = etaOf(inputs, { paused: false, linkDown: true });
    view.count = countOf(job); view.sub = jobSummary(inputs); view.segments = segmentsOf(job);
    view.eta = eta.kind === "offline" ? eta.text : "";
  }
  view.actions = stopAction(inputs);
  return view;
}

function offlineView(inputs: BarInputs): BarView | null {
  if (!inputs.reachable) return helperView(inputs);
  const host = inputs.host;
  if (!host) return null;
  if (host.state === "stalled" && host.stall && host.stall.verdict === "ae-busy") {
    const view = blank("offline", "grey", busyText(host.stall));
    view.actions = stopAction(inputs);
    view.count = countOf(inputs.job);
    return view;
  }
  if (!hostDown(host) || inputs.hostSinceMs < SHOW_OFFLINE_AFTER_MS) return null;
  return awayView(inputs);
}

function decisionActions(item: WaitingItem): BarAction[] {
  const disabled = item.busy;
  if (item.kind === "plan") return [{ id: "apply", label: item.applyLabel, style: "primary", disabled: disabled }, { id: "discard", label: t("status.action.discard"), style: "ghost", disabled: disabled }];
  if (item.kind === "variant") return [{ id: "use-variant", label: item.choiceLabel, style: "primary", disabled: disabled }, { id: "variant-none", label: t("status.action.noneOfThese"), style: "ghost", disabled: disabled }];
  if (item.kind === "approval") return [{ id: "approve-brief", label: t("status.action.buildIt"), style: "primary", disabled: disabled }];
  return [{ id: "continue", label: t("status.action.continue"), style: "primary", disabled: disabled }];
}

function needsYouView(inputs: BarInputs): BarView | null {
  if (!inputs.waiting.length) return null;
  const at = Math.min(Math.max(0, inputs.waitingAt), inputs.waiting.length - 1);
  const item = inputs.waiting[at];
  if (!item) return null;
  const view = blank("needs-you", "amber", item.prompt);
  view.sub = [item.note || item.detail, item.external ? item.source : ""].filter(Boolean).join(" · ");
  view.actions = [...decisionActions(item), ...stopAction(inputs)];
  view.stepper = inputs.waiting.length > 1 ? { at: at + 1, of: inputs.waiting.length } : null;
  view.count = countOf(inputs.job);
  view.segments = segmentsOf(inputs.job);
  view.title = view.text;
  view.meta = jobMeta(inputs.job, inputs.nowMs);
  return view;
}

function lockedView(inputs: BarInputs): BarView | null {
  if (inputs.modelConfigured === false) {
    const view = blank("locked", "amber", t("status.bar.setup"));
    view.actions = [{ id: "setup", label: t("status.action.setUp"), style: "primary" }];
    return view;
  }
  return null;
}

function jobMeta(job: UiJob | null, nowMs: number): string {
  if (!job) return "";
  return [job.cycle > 0 ? "cycle " + job.cycle : "", elapsedWords(job.startedAt, nowMs)].filter(Boolean).join(" · ");
}

function etaText(eta: TimeLeft): string {
  return eta.kind === "estimating" || eta.kind === "range" ? eta.text : "";
}

function workingView(inputs: BarInputs): BarView | null {
  if (!stoppable(inputs)) return null;
  const job = inputs.job;
  const view = blank("working", "accent", activityText(inputs));
  const eta = etaOf(inputs, { paused: job !== null && job.status === "waiting-apply", linkDown: false });
  view.title = t("status.bar.working");
  view.meta = jobMeta(job, inputs.nowMs);
  view.count = [countOf(job), cycleStepOf(inputs)].filter(Boolean).join(" · ");
  view.eta = etaText(eta);
  view.slowing = eta.kind === "range" && eta.slowing;
  view.sub = stopSub(inputs);
  view.segments = segmentsOf(job);
  view.actions = stopAction(inputs);
  const outside = inputs.calls.find((call) => call.state === "running");
  if (outside) view.chip = prettyClient(outside.client);
  return view;
}

function outsideView(inputs: BarInputs): BarView | null {
  const running = inputs.calls.filter((call) => call.state === "running");
  if (!running.length) return null;
  const call = running.at(-1);
  if (!call) return null;
  const view = blank("outside", "dashed", prettyClient(call.client) + " · " + prettyTool(call.tool));
  view.sub = t("status.bar.watching");
  return view;
}

function advisoryView(inputs: BarInputs): BarView | null {
  const host = inputs.host;
  if (host && host.experimental && host.state === "online") return blank("locked", "amber", t("status.bar.experimental", { version: host.aeVersion ?? "" }));
  return null;
}

function finishedView(facts: FinishedFacts): BarView {
  const view = blank("finished", "quiet", t("status.action.done"));
  view.sub = [facts.total > 0 ? facts.verified + "/" + facts.total : t("status.changes.count", { count: facts.changes }), facts.partly > 0 ? t("status.finished.partly", { count: facts.partly }) : ""].filter(Boolean).join(" · ");
  return view;
}

function idleView(inputs: BarInputs): BarView {
  const view = blank("idle", "quiet", [t("status.bar.ready"), inputs.project ?? "", inputs.changeCount === null ? "" : t("status.changes.count", { count: inputs.changeCount })].filter(Boolean).join(" · "));
  if (inputs.stop && inputs.stop.phase !== "stopping") view.text = inputs.stop.text;
  return view;
}

function awaitingView(): BarView {
  const view = blank("idle", "quiet", t("status.bar.waitingForProject"));
  view.sub = t("status.bar.readingAe");
  return view;
}

function eventView(inputs: BarInputs): BarView | null {
  return blockedView(inputs) ?? offlineView(inputs) ?? needsYouView(inputs) ?? lockedView(inputs) ?? workingView(inputs) ?? outsideView(inputs) ?? advisoryView(inputs);
}

/** What the bar shows for these facts. Always returns a view: the bar is always present. */
export function barView(inputs: BarInputs): BarView {
  const view = eventView(inputs);
  if (view) return view;
  if (inputs.awaitingSnapshot) return awaitingView();
  if (inputs.learning) return blank("learning", "quiet", inputs.learning.text);
  if (inputs.stop && inputs.stop.phase !== "stopping" && inputs.stop.text) return idleView(inputs);
  return inputs.finished ? finishedView(inputs.finished) : idleView(inputs);
}

function downFor(inputs: BarInputs): number | null {
  if (!inputs.reachable) return inputs.unreachableMs;
  return inputs.host && hostDown(inputs.host) ? inputs.hostSinceMs : null;
}

/** When the bar's own words next change with no event: the reconnect text turns into the helper text. */
export function nextChangeMs(inputs: BarInputs, view: BarView): number | null {
  const down = downFor(inputs);
  if (down === null) return null;
  if (view.state !== "offline") return Math.max(MIN_WAIT_MS, SHOW_OFFLINE_AFTER_MS - down);
  const reconnecting = !inputs.reachable && view.actions.length === 0;
  return reconnecting ? Math.max(MIN_WAIT_MS, OFFLINE_LONG_AFTER_MS - down) : null;
}
