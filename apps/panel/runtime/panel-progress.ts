/**
 * What the open request and the last stop are doing, kept apart from any element: the status bar and the sheet read it,
 * the chat writes it. The progress poll's label is the sidecar's own plain tool label; the model's narration is never in it.
 */
import type { LiveProgress } from "./chat-reply.js";
import type { StopNote } from "./panel-bar.js";
import type { SessionId } from "./ids.js";
import { touchStatus } from "./panel-status-signal.js";
import type { UiJob } from "./ui-jobs.js";
import { uiState } from "./ui-state.js";

const REASONING_TAIL = 1200;
const STOP_NOTE_MS = 8000;

let live: LiveProgress | null = null;
let reasoning = "";
let spend: { readonly input: number; readonly output: number } | null = null;
let stop: StopNote | null = null;
let stopTimer: ReturnType<typeof setTimeout> | null = null;
const ENDED_CHATS_KEPT = 8;
let ended = new Map<SessionId, UiJob>();
let lastJob: UiJob | null = null;
let following: UiJob | null = null;

/** The job the sidecar runs now, if any. */
export function runningJob(): UiJob | null {
  return uiState().jobs[0] ?? null;
}

/** The job the panel follows without a request of its own open. */
export function followedJob(): UiJob | null {
  return following;
}

/** Follows a job, or lets go of it. */
export function followJob(job: UiJob | null): void {
  following = job;
}

/** The progress of the open request. */
export function liveProgress(): LiveProgress | null {
  return live;
}

/** The tail of the open request's narration. */
export function liveReasoning(): string {
  return reasoning;
}

/** Tokens the open request has spent so far, from its progress poll. */
export function liveSpend(): { readonly input: number; readonly output: number } | null {
  return spend;
}

/** Records the open request's progress, or clears it. */
export function setLiveProgress(progress: LiveProgress | null): void {
  live = progress;
  if (!progress) {
    reasoning = "";
    touchStatus();
    return;
  }
  if (progress.reasoning) reasoning = progress.reasoning.slice(-REASONING_TAIL);
  if (progress.usage && progress.usage.totalTokens) spend = { input: progress.usage.inputTokens, output: progress.usage.outputTokens };
  touchStatus();
}

/** Forgets the spend of the last request. */
export function clearSpend(): void {
  spend = null;
}

/** The sidecar's answer to the last Stop, while it is shown. */
export function stopNote(): StopNote | null {
  return stop;
}

/** Records the sidecar's answer to Stop (or "Stopping…" while the request is out); the words clear on their own after a moment. */
export function setStopNote(note: StopNote | null): void {
  stop = note;
  if (stopTimer !== null) clearTimeout(stopTimer);
  stopTimer = null;
  if (note && note.phase !== "stopping") {
    stopTimer = setTimeout(() => {
      stopTimer = null;
      stop = null;
      touchStatus();
    }, STOP_NOTE_MS);
  }
  touchStatus();
}

/** Remembers the job last seen running, so a job that ends can be summed up. */
export function rememberJob(job: UiJob | null): void {
  if (job) lastJob = job;
}

/** The job last seen running. */
export function lastSeenJob(): UiJob | null {
  return lastJob;
}

/** The job whose end the chat `sessionId` still reports ("Done · 5/5"); cleared by the next message of that chat. */
export function endedJob(sessionId: SessionId | null): UiJob | null {
  return sessionId === null ? null : ended.get(sessionId) ?? null;
}

/** Records the job whose end the chat `sessionId` reports. The latest few chats keep theirs; the oldest go first. */
export function setEndedJob(job: UiJob, sessionId: SessionId): void {
  ended.delete(sessionId);
  ended.set(sessionId, job);
  while (ended.size > ENDED_CHATS_KEPT) {
    const oldest = ended.keys().next().value;
    if (oldest === undefined) break;
    ended.delete(oldest);
  }
  touchStatus();
}

/** Forgets the job whose end the chat `sessionId` reported. */
export function clearEndedJob(sessionId: SessionId | null): void {
  if (sessionId !== null) ended.delete(sessionId);
  touchStatus();
}
