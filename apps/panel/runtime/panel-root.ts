/** The composition root: wires the modules, loads the sidecar's bootstrap, and starts the live link. */
import { addRow, notice, renderTranscript } from "./panel-chat-render.js";
import { sendApproval, sendChat, sendContinuation, sendLongPrompt, wireComposerKeys } from "./panel-chat.js";
import { syncJobs } from "./panel-chat-jobs.js";
import { closingArrived } from "./panel-closing.js";
import { stopChat } from "./panel-chat-stop.js";
import { fillComposer, setComposerBusy } from "./panel-composer.js";
import { isChatInFlight } from "./panel-turn.js";
import { wireReferences } from "./panel-references.js";
import { captureFrameForAttachment, renderAttachment, wireAttachment } from "./panel-attach.js";
import { onBarAction, wireBar } from "./panel-bar-view.js";
import { wireContext } from "./panel-context.js";
import { wireDebug } from "./panel-debug.js";
import { byId, chatMessage } from "./panel-dom.js";
import { hooks } from "./panel-hooks.js";
import { wireAbout } from "./panel-about.js";
import { wireLearning } from "./panel-learning.js";
import { wireMemory } from "./panel-memory-view.js";
import { wireMemoryHistory } from "./panel-memory-history.js";
import { loadModelSettings } from "./panel-model-apply.js";
import { openModelMenu } from "./panel-model-menu.js";
import { openModelSettings } from "./panel-model-form.js";
import { refreshPickerTrigger } from "./panel-model-pill.js";
import { wireModelLanguage } from "./panel-model-language.js";
import { backFromPage, closePage, onViewShown, openPage, showPageView, togglePage, wirePageTitle } from "./panel-page.js";
import { pauseExplanation } from "./panel-pause-text.js";
import { refreshChanges } from "./panel-changes-feed.js";
import { syncPlanCards } from "./panel-plan-fold.js";
import { refreshPlans } from "./panel-plans.js";
import { createNewSession, getChatTranscript, loadSessions, onSessionsChanged } from "./panel-sessions.js";
import { refreshSessionList, wireSessionSearch } from "./panel-session-list.js";
import { wireLanguageSetting } from "./panel-language-setting.js";
import { keepStaticTextPainted } from "./panel-static-text.js";
import { wireSettings } from "./panel-settings.js";
import { flipSheet, openSheet, sheetOpen, wireSheet } from "./panel-sheet.js";
import { openRecovery } from "./panel-sheet-connection.js";
import { touchStatus } from "./panel-status-signal.js";
import { wireSuggestions } from "./panel-suggest-view.js";
import { announceSelection, turnRunning } from "./panel-suggest-hooks.js";
import { applyItem, approveBrief, continueItem, declineVariant, discardItem, useVariant, wireWaiting } from "./panel-waiting.js";
import { wireVariants } from "./panel-variants-view.js";
import { refreshWorkflowStatus, wireWorkflowStatus } from "./panel-workflow.js";
import { diagnosticId, isUnreachable, reloadForFreshToken, send, transportContext } from "./panel-transport.js";
import { refreshTelemetryDisplay } from "./panel-usage.js";
import { loadBootstrap } from "./ui-api.js";
import { startUiSync } from "./ui-sync.js";
import { dispatch, subscribeUi, uiState } from "./ui-state.js";
import type { UiTopic } from "./ui-state.js";
import { sidecarPaired } from "./panel-memory-hooks.js";
import {  } from "@extynt/decode";
import { acknowledged } from "./wire-decoders.js";
import type { SessionId } from "./ids.js";
import type { BarActionId, WaitingItem } from "./panel-bar.js";

function wireHooks(): void {
  hooks.notice = notice;
  hooks.addRow = addRow;
  hooks.renderTranscript = renderTranscript;
  hooks.fillComposer = fillComposer;
  hooks.sendChat = sendChat;
  hooks.sendLongPrompt = sendLongPrompt;
  hooks.openPage = openPage;
  hooks.openSheet = openSheet;
  hooks.openModelSettings = openModelSettings;
  hooks.refreshPlans = refreshPlans;
  hooks.refreshChanges = refreshChanges;
  hooks.isChatInFlight = isChatInFlight;
  hooks.setComposerBusy = setComposerBusy;
}

function newChat(): void {
  createNewSession();
  if (isChatInFlight()) setComposerBusy(true);
  renderTranscript();
  refreshSessionList();
  closePage();
  chatMessage.focus();
  turnRunning(false);
}

function onClick(id: string, run: (event: MouseEvent) => void): void {
  const node = byId(id);
  if (node) node.addEventListener("click", run);
}

function wireTopbar(): void {
  onClick("open-settings", () => togglePage("settings"));
  onClick("chat-title", () => togglePage("chats"));
  onClick("page-back", backFromPage);
  onClick("open-developer", () => openPage("debug"));
  onClick("chat-clear", newChat);
  onClick("snapshot", captureFrameForAttachment);
  onClick("model-picker", openModelMenu);
}

function retryConnection(): void {
  loadBootstrap((reply) => {
    if (reply.ok) {
      dispatch({ type: "bootstrap", bootstrap: reply.value });
      refreshPlans();
    } else if (isUnreachable(reply.error)) reloadForFreshToken();
    touchStatus();
  });
}

function setUp(): void {
  const field = byId("chat-output")?.querySelector("input");
  if (field && getChatTranscript().length === 0) {
    field.focus();
    return;
  }
  openModelSettings();
}

const ITEM_PRESS: ReadonlyMap<BarActionId, (item: WaitingItem) => void> = new Map([
  ["apply", applyItem],
  ["discard", discardItem],
  ["continue", continueItem],
  ["approve-brief", approveBrief],
  ["use-variant", useVariant],
  ["variant-none", declineVariant],
]);

const PLAIN_PRESS: ReadonlyMap<BarActionId, () => void> = new Map([
  ["stop", stopChat],
  ["retry", retryConnection],
  ["help", () => {
    openSheet();
    openRecovery();
  }],
  ["setup", setUp],
]);

function onBarPress(id: BarActionId, item: WaitingItem | null): void {
  const plain = PLAIN_PRESS.get(id);
  if (plain) {
    plain();
    return;
  }
  const onItem = ITEM_PRESS.get(id);
  if (item && onItem) onItem(item);
}

function onFocusTopic(): void {
  const focus = uiState().focus;
  if (focus?.selectionFingerprint) announceSelection(focus.selectionFingerprint, focus.selected);
  if (getChatTranscript().length === 0) renderTranscript();
}

function syncCards(): void {
  syncPlanCards();
  touchStatus();
}

const TOPIC_HANDLERS: ReadonlyMap<UiTopic, () => void> = new Map([
  ["undo", syncCards],
  ["thumbs", syncCards],
  ["activity", syncJobs],
  ["plans", refreshPlans],
  ["change", () => {
    refreshPlans();
    refreshChanges();
  }],
  ["focus", onFocusTopic],
  ["model", () => {
    if (getChatTranscript().length === 0) renderTranscript();
  }],
]);

function afterBootstrap(openId: SessionId | null): void {
  loadSessions(openId, () => {
    renderTranscript();
    syncJobs();
    refreshSessionList();
    loadModelSettings();
    refreshPlans();
    refreshChanges();
    hooks.refreshVariants();
    refreshWorkflowStatus();
    sidecarPaired();
    startUiSync();
  });
}

function startOffline(): void {
  createNewSession();
  renderTranscript();
}

function probeHealth(): void {
  const context = transportContext("GET", "/health", diagnosticId("probe"));
  send({ method: "GET", path: "/health", body: null, context, decoder: acknowledged }, () => touchStatus());
}

function bootFromSidecar(): void {
  loadBootstrap((reply) => {
    if (!reply.ok) {
      startOffline();
      probeHealth();
      return;
    }
    dispatch({ type: "bootstrap", bootstrap: reply.value });
    afterBootstrap(reply.value.currentSessionId);
  });
}

function wireModules(): void {
  wireComposerKeys();
  wireReferences();
  wireAttachment();
  wirePageTitle();
  wireContext();
  wireSettings();
  wireLanguageSetting();
  wireModelLanguage();
  wireAbout();
  wireDebug();
  wireLearning();
  wireMemory();
  wireMemoryHistory(() => null);
  wireSessionSearch();
  wireVariants();
  wireSuggestions({ isChatInFlight });
  wireSheet();
  wireBar({ open: sheetOpen, flip: flipSheet });
}

/** Wires every module to the page and, inside the host, boots from the sidecar; outside it, opens an offline chat. */
export function startPanel(insideHost: boolean): void {
  keepStaticTextPainted();
  wireHooks();
  wireTopbar();
  wireWorkflowStatus();
  wireWaiting({
    rows: getChatTranscript,
    busy: isChatInFlight,
    send: sendContinuation,
    approve: sendApproval,
    announce: (pause) => addRow({ kind: "assistant", text: pauseExplanation(), failed: true, pause }),
  });
  wireModules();
  onSessionsChanged(refreshSessionList);
  onBarAction(onBarPress);
  subscribeUi((topic, detail) => {
    if (topic === "closing" && detail) closingArrived(detail);
    else TOPIC_HANDLERS.get(topic)?.();
  });
  showPageView("settings");
  renderAttachment();
  refreshPickerTrigger();
  onViewShown("chats", refreshSessionList);
  onViewShown("debug", () => refreshTelemetryDisplay(true));
  if (insideHost) bootFromSidecar();
  else startOffline();
}
