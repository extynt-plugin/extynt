/**
 * Runs one request of a scenario against a sidecar: the wait for the catalogue (skipped when no engine host could answer it), the
 * deadline, the progress watcher and the wait for applying.
 */
import { accepts, object, string } from "@extynt/decode";
import type { ChatResponse } from "./chat-wire.js";
import { boundedElapsedMs } from "./clock.js";
import type { FakePluginHost } from "./fake-plugin-host.js";
import { untilSettled, untilWorkflowIdle } from "./fake-plugin-wait.js";
import { wasCutOff } from "./run-report.js";
import type { ChatProgress, ChatRequest, SidecarHandle } from "./sidecar-client.js";

/** What every turn of a run shares. */
export interface TurnSettings {
  sidecar: SidecarHandle;
  timeoutMs: number;
  fakeHost: boolean;
  pluginEndpoint: boolean;
  watch: boolean;
}

interface TurnInput {
  scenarioId: string;
  index: number;
  message: string;
  history: NonNullable<ChatRequest["history"]>;
  host: FakePluginHost | undefined;
}

interface TurnResult { response: ChatResponse; durationMs: number | undefined; logStart: number; logEnd: number; cutOff: boolean }

const CATALOGUE_WAIT_MS = 60_000;
const CATALOGUE_POLL_MS = 250;
const CATALOGUE_SETTLED = new Set(["complete", "disabled", "unavailable", "paused"]);
const WATCH_INTERVAL_MS = 2_000;
const QUIET_BEAT_MS = 30_000;

class HarnessTimeout extends Error {
  constructor(timeoutMs: number) {
    super(`no answer within ${timeoutMs}ms`);
    this.name = "HarnessTimeout";
  }
}

const hasCode = accepts(object({ code: string() }));

async function untilCatalogued(sidecar: SidecarHandle): Promise<void> {
  const deadline = Date.now() + CATALOGUE_WAIT_MS;
  for (;;) {
    const progress = await sidecar.catalogue().catch(() => null);
    if (!progress || progress.engineHosts === 0 || (progress.state !== undefined && CATALOGUE_SETTLED.has(progress.state)) || progress.pending === 0) return;
    if (Date.now() > deadline) { process.stdout.write(`    catalogue still ${progress.state} with ${progress.pending} pending after ${CATALOGUE_WAIT_MS / 1000}s; starting the turn anyway\n`); return; }
    await new Promise((resolve) => setTimeout(resolve, CATALOGUE_POLL_MS));
  }
}

function progressLine(progress: ChatProgress): string {
  return `step ${progress.step ?? "?"}/${progress.maxSteps ?? "?"} ${progress.phase ?? ""} ${progress.label ?? ""}`.trim();
}

interface WatchState { lastLine: string; notesSeen: number; lastChangeAt: number; lastBeatAt: number }

function reportProgress(state: WatchState, progress: ChatProgress): void {
  const at = new Date().toISOString().slice(11, 19), now = Date.now(), quiet = Math.round((now - state.lastChangeAt) / 1000);
  if (quiet >= 30 && now - state.lastBeatAt >= QUIET_BEAT_MS) {
    state.lastBeatAt = now;
    process.stdout.write(`    [${at}] waiting on the model (${quiet}s on step ${progress.step ?? "?"})\n`);
  }
  const notes = progress.notes ?? [];
  for (; state.notesSeen < notes.length; state.notesSeen += 1) process.stdout.write(`    [${at}] says: ${notes[state.notesSeen]}\n`);
  const line = progressLine(progress);
  if (line === state.lastLine) return;
  state.lastLine = line;
  state.lastChangeAt = now;
  process.stdout.write(`    [${at}] ${line}\n`);
}

function watchProgress(sidecar: SidecarHandle, requestId: string): ReturnType<typeof setInterval> {
  const state: WatchState = { lastLine: "", notesSeen: 0, lastChangeAt: Date.now(), lastBeatAt: 0 };
  const watching = setInterval(() => {
    void sidecar.progress().then((progress) => {
      if (progress && progress.requestId === requestId) reportProgress(state, progress);
    }).catch(() => undefined);
  }, WATCH_INTERVAL_MS);
  watching.unref();
  return watching;
}

function transportFailure(error: Error): ChatResponse {
  const code = hasCode(error.cause) ? ` [${error.cause.code}]` : "";
  const failureCode = error instanceof HarnessTimeout ? "HARNESS_TIMEOUT" : "TRANSPORT_FAILED";
  return { status: 0, body: { failure: { code: failureCode, message: `${error.message}${code}` } } };
}

async function requestWithDeadline(sidecar: SidecarHandle, request: ChatRequest, timeoutMs: number): Promise<ChatResponse> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new HarnessTimeout(timeoutMs)), timeoutMs);
    timer.unref();
  });
  try {
    return await Promise.race([sidecar.chat(request), expired]);
  } catch (error) {
    return transportFailure(error instanceof Error ? error : new Error(String(error)));
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function untilApplied(settings: TurnSettings, host: FakePluginHost | undefined): Promise<void> {
  if (settings.fakeHost && host) await untilSettled(settings.sidecar, host);
  if (settings.pluginEndpoint) await untilWorkflowIdle(settings.sidecar);
}

/** Sends one request and waits for the sidecar to finish applying what it answered. */
export async function runScenarioTurn(settings: TurnSettings, turn: TurnInput): Promise<TurnResult> {
  const { sidecar } = settings;
  const logStart = sidecar.logLines.length;
  const started = Date.now();
  const requestId = turn.index === 1 ? `chat-test-${turn.scenarioId}` : `chat-test-${turn.scenarioId}-t${turn.index}`;
  if (settings.fakeHost || settings.pluginEndpoint) await untilCatalogued(sidecar);
  const watching = settings.watch ? watchProgress(sidecar, requestId) : undefined;
  const response = await requestWithDeadline(
    sidecar,
    { requestId, message: turn.message, ...(turn.history.length ? { history: turn.history } : {}) },
    settings.timeoutMs,
  );
  if (watching) clearInterval(watching);
  await untilApplied(settings, turn.host);
  return { response, durationMs: boundedElapsedMs(started), logStart, logEnd: sidecar.logLines.length, cutOff: wasCutOff(response) };
}
