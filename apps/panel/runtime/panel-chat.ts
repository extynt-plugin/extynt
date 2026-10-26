/** Sending a turn: the request, its outcome in the thread, steering a running turn, and the composer's keys. */
import { chatReplyDecoder, steerReplyDecoder, type ChatReply } from "./chat-reply.js";
import { getAttachedFrame, renderAttachment, setAttachedFrame } from "./panel-attach.js";
import { appendOrchestrationRoster } from "./panel-chat-orchestration.js";
import { startProgressPolling, stopProgressPolling } from "./panel-chat-poll.js";
import { addRow, chatHistoryForRequest, notice } from "./panel-chat-render.js";
import { stoppedText } from "./panel-chat-stop.js";
import { autosizeComposer, fillComposer, paintComposer, setComposerBusy } from "./panel-composer.js";
import { bindTurnContext, messageContext, releaseTurnContext } from "./panel-context.js";
import { chatButton, chatMessage, setText } from "./panel-dom.js";
import { hooks } from "./panel-hooks.js";
import { currentLanguage, onLanguageChange, t } from "./panel-language.js";
import { plainTextOf, type UiKey } from "@extynt/ui-text";
import { approveMessage } from "./panel-approval-text.js";
import { CONTINUE_MESSAGE } from "./panel-pause.js";
import { pauseExplanation } from "./panel-pause-text.js";
import { refreshPlans, upsertPlanMessage } from "./panel-plans.js";
import { clearEndedJob, clearSpend, followedJob, setLiveProgress, setStopNote } from "./panel-progress.js";
import { getReferenceImages, referencePayload, setReferenceImages, takeReferenceImages } from "./panel-references.js";
import { getCurrentSessionId, saveTranscript, setTurnSessionId, writingTranscript } from "./panel-sessions.js";
import { syncJobs } from "./panel-chat-jobs.js";
import { diagnosticId, send, transportContext, type Reply, type TransportError, type TransportContext } from "./panel-transport.js";
import { activeTurn, isChatInFlight, resetTurnProgress, setActiveTurn, turnProgress } from "./panel-turn.js";
import { checkRateLimits, recordAbandonedTurnUsage } from "./panel-usage.js";
import { uiState } from "./ui-state.js";
import { type JsonObject } from "@extynt/decode";
import type { AnswerRow, NewRow } from "./transcript.js";

const CHAT_TIMEOUT_MS = 86_400_000;
const MAX_LINKED_PROJECT_LINKS = 16;
const CONFLICT_KEYS: ReadonlyMap<string, UiKey> = new Map<string, UiKey>([
  ["WORKFLOW_ENGINE_BUSY", "chat.conflict.engineBusy"],
  ["CHAT_ADMISSION_SUPERSEDED", "chat.conflict.superseded"],
]);

function modelSetupText(): string {
  return t("chat.model.setUpToStart");
}

function conflictText(error: TransportError): string | undefined {
  const key = error.status === 409 ? CONFLICT_KEYS.get(error.code ?? "") : undefined;
  return key ? plainTextOf(currentLanguage(), key) : undefined;
}

let continuingJobId: string | null = null;
let allowingLongPrompt = false;

function failure(text: string, retry: string): NewRow {
  return { kind: "error", text, failed: true, retry };
}

function imageField(): JsonObject {
  const frame = getAttachedFrame();
  const comma = frame ? frame.dataUrl.indexOf(",") : -1;
  if (!frame || comma <= 0) return {};
  return { image: { mediaType: frame.mediaType || "image/png", base64: frame.dataUrl.slice(comma + 1) } };
}

function optionalFields(): JsonObject {
  const session = getCurrentSessionId();
  return {
    ...(session ? { sessionId: session } : {}),
    ...(continuingJobId ? { continueJobId: continuingJobId } : {}),
    ...(allowingLongPrompt ? { allowLongPrompt: true } : {}),
    ...imageField(),
    ...(getReferenceImages().length ? { images: referencePayload() } : {}),
  };
}

function chatBody(requestId: string, typed: string): JsonObject {
  return {
    schemaVersion: "0.1",
    requestId,
    message: typed,
    history: chatHistoryForRequest(),
    autoApply: uiState().prefs.askBeforeApplying !== "always",
    ...optionalFields(),
  };
}

function sendTyped(text: string, jobId: string | null): void {
  if (isChatInFlight()) return;
  const draft = chatMessage.value;
  const frame = getAttachedFrame();
  const references = getReferenceImages();
  chatMessage.value = text;
  setAttachedFrame(null);
  setReferenceImages([]);
  continuingJobId = jobId;
  try {
    sendChat();
  } finally {
    continuingJobId = null;
    chatMessage.value = draft;
    setAttachedFrame(frame);
    setReferenceImages(references);
    renderAttachment();
    autosizeComposer();
  }
}

/** A Continue click is the typed word "continue" naming the job its card belonged to; the draft and attached frame are put back after. */
export function sendContinuation(jobId: string): void {
  sendTyped(CONTINUE_MESSAGE, jobId);
}

/** A Build click is the reader's approval of the design brief, typed for them; the draft and attached frame are put back after. */
export function sendApproval(): void {
  sendTyped(approveMessage(), null);
}

/** Send anyway on a prompt the sidecar refused as too long: the same words again, this time allowed past the limit. */
export function sendLongPrompt(text: string): void {
  if (isChatInFlight()) return;
  fillComposer(text);
  allowingLongPrompt = true;
  try {
    sendChat();
  } finally {
    allowingLongPrompt = false;
  }
}

function admitted(): boolean {
  const verdict = checkRateLimits();
  if (verdict.blocked) {
    notice(t("chat.rateLimit.reached"), "bad");
    return false;
  }
  if (verdict.warned) notice(verdict.message || "", "warn");
  if (uiState().modelConfigured === false) {
    notice(modelSetupText(), "warn", "open-model");
    return false;
  }
  return true;
}

function userRow(message: string, requestId: string): NewRow {
  const frame = getAttachedFrame();
  const refIds = takeReferenceImages();
  const context = messageContext(uiState().focus);
  return {
    kind: "user", text: message, requestId,
    ...(context ? { context } : {}),
    ...(frame ? { captureId: frame.captureId } : {}),
    ...(refIds.length ? { refIds } : {}),
  };
}

function beginTurn(requestId: string): void {
  setAttachedFrame(null);
  renderAttachment();
  chatMessage.value = "";
  autosizeComposer();
  setComposerBusy(true);
  clearEndedJob(getCurrentSessionId());
  setStopNote(null);
  clearSpend();
  resetTurnProgress();
  setTurnSessionId(getCurrentSessionId());
  bindTurnContext();
  setLiveProgress({ requestId, label: "", step: 0, usage: null, reasoning: "" });
  startProgressPolling(requestId);
}

/** Sends the composer's words as a turn. */
export function sendChat(): void {
  if (isChatInFlight()) return;
  const typed = chatMessage.value;
  const message = typed.trim();
  if (!message || !admitted()) return;
  const requestId = diagnosticId("chat");
  const body = chatBody(requestId, typed);
  addRow(userRow(message, requestId));
  beginTurn(requestId);
  const context = { ...transportContext("POST", "/v1/chat", requestId), timeoutMs: CHAT_TIMEOUT_MS };
  setActiveTurn(context);
  send({ method: "POST", path: "/v1/chat", body, context, decoder: chatReplyDecoder }, (reply) => {
    try {
      finishChatTurn(context, reply, message);
    } finally {
      setTurnSessionId(null);
    }
  });
  chatMessage.focus();
}

function handleChatError(error: TransportError, message: string): void {
  if (error.local) {
    notice(error.message === t("chat.transport.stopped") ? stoppedText() : error.message, "warn");
    return;
  }
  if (error.status === 401) return;
  if (error.status === 503) {
    notice(modelSetupText(), "warn", "open-model");
    return;
  }
  addRow(failure(conflictText(error) ?? error.reason, message));
}

function answerExtras(result: ChatReply, model: string): Partial<Omit<AnswerRow, "kind" | "text" | "at">> {
  return {
    ...(result.usage?.totalTokens ? { usage: result.usage } : {}),
    ...(model ? { provider: model } : {}),
    ...(result.requestId !== null ? { requestId: result.requestId } : {}),
    ...(result.projectLinks.length ? { projectLinks: [...result.projectLinks] } : {}),
    ...(result.pause ? { pause: result.pause } : {}),
    ...(result.approval ? { approval: result.approval } : {}),
  };
}

function answerRow(result: ChatReply, model: string): NewRow {
  const paused = result.pause !== null;
  return {
    kind: result.outcome === "failed" && !paused ? "error" : "assistant",
    text: paused ? pauseExplanation() : result.answer,
    failed: result.outcome === "failed",
    tools: [...result.tools],
    reasoning: [...result.reasoning],
    ...answerExtras(result, model),
  };
}

function linkTurnMessages(context: TransportContext, result: ChatReply): void {
  const count = result.projectLinks.length;
  if (result.requestId !== context.requestId || count === 0 || count > MAX_LINKED_PROJECT_LINKS) return;
  writingTranscript().forEach((row) => {
    if ((row.kind === "assistant" || row.kind === "error" || row.kind === "user") && row.requestId === context.requestId) row.projectLinks = [...result.projectLinks];
  });
  saveTranscript();
}

function modelLabel(result: ChatReply): string {
  return result.provider?.label || result.provider?.displayName || result.model;
}

function finishSuccessfulChat(result: ChatReply): void {
  const model = modelLabel(result);
  setText("diag-model", model + (result.model && model !== result.model ? " · " + result.model : ""));
  if (result.fallback) notice(t("chat.fallback.tookOver", { from: result.fallback.from, reason: result.fallback.reason, model }), "warn");
  const row = addRow(answerRow(result, model));
  if (row && result.orchestration) appendOrchestrationRoster(row, result.orchestration);
  result.plans.forEach((plan) => upsertPlanMessage(plan));
  refreshPlans();
}

function settleTurnUi(context: TransportContext, failedWithoutAnswer: boolean): void {
  context.settled = true;
  setComposerBusy(false);
  setActiveTurn(null);
  stopProgressPolling();
  releaseTurnContext();
  if (failedWithoutAnswer) recordAbandonedTurnUsage(turnProgress().usage, turnProgress().steps);
  setLiveProgress(null);
  hooks.refreshChanges();
  syncJobs();
}

function refuseLongPrompt(result: ChatReply, message: string): void {
  addRow({ kind: "error", text: result.answer, failed: true, sendAnyway: message });
  if (!chatMessage.value) fillComposer(message);
}

function showOutcome(context: TransportContext, reply: Reply<ChatReply>, message: string): void {
  if (!reply.ok) {
    handleChatError(reply.error, message);
    return;
  }
  const result = reply.value.requestId === context.requestId ? reply.value : { ...reply.value, requestId: null, projectLinks: [] };
  if (!result.ok) {
    addRow(failure(result.error ? result.error.message : t("chat.answer.noAnswer"), message));
    return;
  }
  linkTurnMessages(context, result);
  if (result.failure?.code === "PROMPT_TOO_LONG") refuseLongPrompt(result, message);
  else finishSuccessfulChat(result);
}

function finishChatTurn(context: TransportContext, reply: Reply<ChatReply>, message: string): void {
  if (context.settled || activeTurn() !== context) return;
  settleTurnUi(context, !reply.ok);
  showOutcome(context, reply, message);
  hooks.refreshVariants();
}

function markSteer(steerId: string, delivered: boolean): void {
  const row = writingTranscript().find((entry) => entry.kind === "user" && entry.steerId === steerId);
  if (!row || row.kind !== "user") return;
  row.delivery = delivered ? "delivered" : "failed";
  row.failed = !delivered;
  saveTranscript();
}

function steerFailure(reply: Reply<{ readonly ok: boolean }>): string {
  if (reply.ok) return t("chat.steer.finished");
  return reply.error.local ? reply.error.message : t("chat.steer.notDelivered");
}

function sendSteer(): void {
  const typed = chatMessage.value;
  const message = typed.trim();
  const target = activeTurn()?.requestId ?? followedJob()?.requestId;
  if (!message || !target) return;
  chatMessage.value = "";
  autosizeComposer();
  clearEndedJob(getCurrentSessionId());
  const steerId = diagnosticId("steer-row");
  addRow({ kind: "user", text: message, steer: true, steerId, delivery: "pending" });
  const context = transportContext("POST", "/v1/chat/steer", diagnosticId("steer"));
  send({ method: "POST", path: "/v1/chat/steer", body: { requestId: target, message: typed }, context, decoder: steerReplyDecoder }, (reply) => {
    if (reply.ok && reply.value.ok) {
      markSteer(steerId, true);
      return;
    }
    markSteer(steerId, false);
    addRow(failure(steerFailure(reply), message));
  });
}

function onChatButtonClick(): void {
  if (isChatInFlight()) sendSteer();
  else sendChat();
}

/** Makes Enter send (or steer a running turn); Shift+Enter and IME composition are left alone. */
export function wireComposerKeys(): void {
  onLanguageChange(paintComposer);
  chatMessage.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    onChatButtonClick();
  });
  chatMessage.addEventListener("input", autosizeComposer);
  chatButton.addEventListener("click", onChatButtonClick);
}
