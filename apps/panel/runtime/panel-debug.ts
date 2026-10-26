/**
 * The Developer page (versions, the host link, an event tail, the catalogue tools), and the Chats
 * page's chat-log save and clear. The event tail shows event names and ids only: never a prompt, an answer or a model's reasoning.
 */
import { productVersion } from "./native.js";
import { catalogueProgressDecoder } from "./panel-catalogue-line.js";
import type { CatalogueProgress } from "./panel-catalogue-line.js";
import { byId, clearChildren, clockTime, el, setText } from "./panel-dom.js";
import { clearChatHistory } from "./panel-sessions.js";
import { observeCatalogueProgress } from "./panel-learning.js";
import { onLanguageChange, t } from "./panel-language.js";
import { diagnosticId, later, pollContext, send, transportContext } from "./panel-transport.js";
import { exportChatLogs } from "./ui-api.js";
import { subscribeUi, uiState } from "./ui-state.js";
import { refreshWorkflowStatus } from "./panel-workflow.js";
import { jsonValue, type JsonValue, object } from "@extynt/decode";

let clearArmedUntil = 0;
let lastProgress: CatalogueProgress | null = null;

function show(value: JsonValue, target = "activity-list"): void {
  const out = byId(target);
  if (!out) return;
  out.hidden = false;
  out.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function hostWords(): string {
  const host = uiState().host;
  if (!host) return t("settings.debug.unknown");
  const parts = [
    host.state,
    host.pluginVersion ? t("settings.debug.pluginVersion", { version: host.pluginVersion }) : "",
    host.idleAgeMs === null ? "" : t("settings.debug.hostIdle", { seconds: Math.round(host.idleAgeMs / 1000) }),
    host.stall ? t("settings.debug.hostStall", { verdict: host.stall.verdict, seconds: Math.round(host.stall.waitedMs / 1000) }) : "",
  ];
  return parts.filter(Boolean).join(" · ");
}

function versionsLine(): string {
  const native = uiState().native;
  return [
    t("settings.debug.uiVersion", { version: productVersion() || t("settings.about.unknown") }),
    native && native.pluginVersion ? t("settings.debug.pluginVersion", { version: native.pluginVersion }) : "",
    native && native.aeVersion ? t("settings.debug.aeVersion", { version: native.aeVersion }) : "",
  ].filter(Boolean).join(" · ");
}

function focusLine(): string {
  const state = uiState();
  if (state.focus && state.focus.compositionName) return t("settings.debug.focus", { name: state.focus.compositionName, selected: state.focus.selected });
  return state.project ?? t("settings.debug.none");
}

function sidecarWords(): string {
  const state = uiState();
  if (!state.reachable) return t("settings.debug.notReachable");
  const connected = t("settings.debug.connected");
  return state.sidecarVersion ? connected + " · " + state.sidecarVersion : connected;
}

function paintStatusGrid(): void {
  setText("diag-sidecar", sidecarWords());
  setText("diag-product", versionsLine());
  setText("diag-snapshot", focusLine());
  setText("diag-host", hostWords());
}

function pausedWords(progress: CatalogueProgress): string {
  if (progress.state === "complete") return " · " + t("settings.debug.catalogue.complete");
  if (progress.state !== "paused" && progress.state !== "unavailable") return "";
  return progress.pauseReason === "not-scratch-project" ? " · " + t("settings.debug.catalogue.pausedNotScratch") : " · " + t("settings.debug.catalogue.paused");
}

function catalogueLine(progress: CatalogueProgress | null): string {
  if (!progress) return t("settings.debug.catalogue.none");
  if (progress.state === "idle") return t("settings.debug.catalogue.idle");
  const counts = t("settings.debug.catalogue.counts", { count: progress.installed, collected: progress.collected, pending: progress.pending, failed: progress.failed });
  return t("settings.debug.catalogue.line", { details: counts + pausedWords(progress) });
}

function paintCatalogueLine(): void {
  setText("catalogue-progress", catalogueLine(lastProgress));
}

const catalogueStartDecoder = object({ progress: catalogueProgressDecoder, catalogue: catalogueProgressDecoder });

function startCatalogue(): void {
  setText("catalogue-progress", t("settings.debug.catalogue.starting"));
  const context = pollContext("POST", "/v1/catalogue/start", diagnosticId("catalogue"));
  send({ method: "POST", path: "/v1/catalogue/start", body: {}, context, decoder: catalogueStartDecoder }, (reply) => {
    if (!reply.ok) { setText("catalogue-progress", t("settings.debug.catalogue.noAnswer")); return; }
    lastProgress = reply.value.progress ?? reply.value.catalogue;
    paintCatalogueLine();
    observeCatalogueProgress(lastProgress);
  });
}

function readHostCapabilities(): void {
  show(t("settings.debug.readingEffects"));
  const context = transportContext("POST", "/v1/host/census", diagnosticId("census"));
  send({ method: "POST", path: "/v1/host/census", body: {}, context, decoder: jsonValue }, (reply) => show(reply.ok ? reply.value : reply.error.reason));
}

function saveChatLog(): void {
  show(t("settings.debug.chatLog.saving"), "chats-result");
  exportChatLogs((reply) => show(reply.ok ? t("settings.debug.chatLog.saved", { count: reply.value.sessions, path: reply.value.path }) : reply.error.reason, "chats-result"));
}

function clearHistory(button: HTMLElement): void {
  if (Date.now() > clearArmedUntil) {
    clearArmedUntil = Date.now() + 4000;
    button.textContent = t("settings.debug.history.pressAgain");
    later(() => { button.textContent = t("settings.debug.history.clear"); }, 4000);
    return;
  }
  clearArmedUntil = 0;
  button.textContent = t("settings.debug.history.clear");
  clearChatHistory((cleared) => show(cleared ? t("settings.debug.history.cleared") : t("settings.debug.history.turnRunning"), "chats-result"));
}

const TAIL_LINES = 40;
const tail: string[] = [];

type UiSnapshot = ReturnType<typeof uiState>;

const TAIL_BY_TOPIC: ReadonlyMap<string, (state: UiSnapshot) => string> = new Map([
  ["activity", (state: UiSnapshot) => (state.jobs.length ? state.jobs.map((job) => "activity " + job.jobId + " " + job.status).join(" · ") : t("settings.debug.tail.activityIdle"))],
  ["mcp", (state: UiSnapshot) => {
    const call = state.mcpCalls.at(-1);
    return call ? "mcp #" + call.id + " " + call.tool + " " + call.state : "";
  }],
  ["dropped", (state: UiSnapshot) => t("settings.debug.tail.dropped", { count: state.dropped.streamFrames, chatLog: state.dropped.chatLogEvents })],
  ["host", (state: UiSnapshot) => (state.host ? "host " + state.host.state : "")],
  ["reach", (state: UiSnapshot) => t(state.reachable ? "settings.debug.tail.linkUp" : "settings.debug.tail.linkDown")],
]);
const TAIL_TOPIC_ONLY = ["change", "undo", "plans", "closing", "thumbs", "preview"];

function tailLine(topic: string, detail: string | undefined): string {
  const state = uiState();
  const describe = TAIL_BY_TOPIC.get(topic);
  if (describe) return describe(state);
  if (TAIL_TOPIC_ONLY.includes(topic)) return topic + (detail ? " " + detail : "");
  return "";
}

function paintTail(): void {
  const box = byId("event-tail");
  if (!box) return;
  clearChildren(box);
  if (!tail.length) { box.appendChild(el("div", "muted", t("settings.debug.nothingYet"))); return; }
  tail.forEach((line) => box.appendChild(el("div", "", line)));
}

function noteEvent(topic: string, detail: string | undefined): void {
  const line = tailLine(topic, detail);
  if (!line) return;
  const stamped = clockTime() + " " + line;
  if (tail[0]?.slice(9) === line) return;
  tail.unshift(stamped);
  if (tail.length > TAIL_LINES) tail.length = TAIL_LINES;
  paintTail();
}

function on(id: string, run: (node: HTMLElement) => void): void { const node = byId(id); if (node) node.addEventListener("click", () => run(node)); }

function repaintDeveloper(): void {
  paintStatusGrid();
  paintCatalogueLine();
  paintTail();
}

export function wireDebug(): void {
  on("chat-history-export", saveChatLog);
  on("benchmark-history-clear", clearHistory);
  on("catalogue-build", startCatalogue);
  on("host-capabilities", readHostCapabilities);
  on("workflow-refresh", refreshWorkflowStatus);
  subscribeUi((topic, detail) => { if (topic === "host" || topic === "focus" || topic === "reach") paintStatusGrid(); noteEvent(topic, detail); });
  onLanguageChange(repaintDeveloper);
  repaintDeveloper();
}
