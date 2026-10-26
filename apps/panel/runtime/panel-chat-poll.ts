/** While a turn is open the panel asks the sidecar for its progress, and gives up on a turn that goes quiet. */
import { progressReplyDecoder } from "./chat-reply.js";
import { setLiveProgress } from "./panel-progress.js";
import { abortActiveTurn, activeTurn, isChatInFlight, noteTurnProgress } from "./panel-turn.js";
import { diagnosticId, pollContext, send, type Reply } from "./panel-transport.js";
import type { LiveProgress } from "./chat-reply.js";
import type { Infer } from "@extynt/decode";

type ProgressReply = Infer<typeof progressReplyDecoder>;

const CHAT_IDLE_TIMEOUT_MS = 180000;
const PROGRESS_POLL_MS = 900;
const MAX_PROGRESS_FAILURES = 3;

let idleTimer: ReturnType<typeof setTimeout> | null = null;
let progressTimer: ReturnType<typeof setInterval> | null = null;
let progressBusy = false;
let progressFailures = 0;

function isLive(requestId: string): boolean {
  const active = activeTurn();
  return isChatInFlight() && active !== null && active.requestId === requestId && !active.settled;
}

function armIdleWatchdog(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = null;
    abortActiveTurn("idle");
  }, CHAT_IDLE_TIMEOUT_MS);
}

function noteProgress(progress: LiveProgress): void {
  armIdleWatchdog();
  setLiveProgress(progress);
  noteTurnProgress(progress.usage, progress.step);
}

function onProgress(requestId: string, reply: Reply<ProgressReply>): void {
  progressBusy = false;
  if (!isLive(requestId)) return;
  if (!reply.ok || !reply.value.ok) {
    progressFailures += 1;
    if (progressFailures >= MAX_PROGRESS_FAILURES) stopProgressPolling();
    return;
  }
  progressFailures = 0;
  const progress = reply.value.progress;
  if (progress && progress.requestId === requestId) noteProgress(progress);
}

function poll(requestId: string): void {
  if (!isChatInFlight() || progressBusy) return;
  progressBusy = true;
  const path = "/v1/chat/progress";
  const context = pollContext("GET", path, diagnosticId("progress"));
  send({ method: "GET", path: path + "?requestId=" + encodeURIComponent(requestId), body: null, context, decoder: progressReplyDecoder }, (reply) => onProgress(requestId, reply));
}

/** Stops asking for progress and disarms the idle watchdog. */
export function stopProgressPolling(): void {
  if (progressTimer) clearInterval(progressTimer);
  if (idleTimer) clearTimeout(idleTimer);
  progressTimer = null;
  idleTimer = null;
  progressBusy = false;
}

/** Asks for the turn's progress every moment until the turn ends or the sidecar stops answering. */
export function startProgressPolling(requestId: string): void {
  stopProgressPolling();
  progressFailures = 0;
  progressTimer = setInterval(() => poll(requestId), PROGRESS_POLL_MS);
}
