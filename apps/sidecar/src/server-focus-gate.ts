// The check of the live focus against the latest project read, and the bounded re-read when they differ or the live view is gone.
import type { PlanStateCapability } from "./server-plan-state.js";
import type { HttpCoreCapability } from "./server-http-core.js";
import type { SidecarState } from "./server-state.js";
import { focusDifference, focusFresh, focusNote, type FocusDifference, type LiveFocus } from "./live-focus.js";
import { queueSnapshotRefresh, withdrawSnapshotRefresh, type ReadSpec } from "./read-queue.js";
import type { SchedulerState } from "./read-scheduler.js";

const SETTLE_SECONDS = 2.5;
const RECENT_READ_MS = 5_000;
const REREAD_NOTE = "Live selection from After Effects is unavailable (the panel has not reported it recently); the project was re-read just now, so the selection in this context is as of that read.";
const UNREAD_NOTE = "Live selection from After Effects is unavailable and the project could not be re-read in time, so the selection in this context may be out of date. Call ae_refresh_snapshot before planning from it.";
const REFRESH_ROUNDS = 2;

/** What the gate found: current, unknowable, re-read in time, or still different when the wait ran out (with the note the agent is told). */
export interface FocusOutcome {
  readonly state: "current" | "unknown" | "refreshed" | "timeout";
  readonly note?: string;
}

/** What a gate needs: the session state it reads and writes, the latest normalised read, and the transport it waits on. */
export interface FocusDeps {
  readonly state: Pick<SidecarState, "activePanelInstanceId" | "hostLink" | "latest" | "maxBodyBytes" | "options" | "panel" | "panelSnapshotWaitMs"> & SchedulerState;
  readonly planState: Pick<PlanStateCapability, "normalizedLatest">;
  readonly transport: Pick<HttpCoreCapability, "notifyChange" | "waitUntil">;
}

interface FocusObservation {
  readonly difference: FocusDifference | null;
  readonly focus: LiveFocus;
  readonly snapshot: NonNullable<ReturnType<PlanStateCapability["normalizedLatest"]>>;
}

type RefreshReason = FocusDifference | "unavailable";

function gateSpec(reason: RefreshReason, focus: LiveFocus | null): ReadSpec {
  const active = focus?.activeCompositionId;
  if ((reason === "composition" || reason === "selection") && active) return { reason: "gate", read: { scope: "compositions", compositionIds: [active], includeItems: true } };
  return { reason: "gate", read: { scope: "full" } };
}

/** Re-reads the project, bounded by a deadline, when After Effects shows something the last read did not see. */
export class FocusGate {
  constructor(private readonly deps: FocusDeps) {}

  observe(): FocusObservation | undefined {
    const { state, planState } = this.deps;
    const focus = state.liveFocus, snapshot = planState.normalizedLatest();
    if (!focus || !snapshot || !focusFresh(focus, state.now().getTime())) return undefined;
    return { difference: focusDifference(focus, snapshot), focus, snapshot };
  }

  private requestRefresh(reason: RefreshReason): number {
    const { state } = this.deps;
    const askedAt = state.now().getTime();
    queueSnapshotRefresh(state, gateSpec(reason, state.liveFocus));
    state.eventLog("focus.refresh-requested", { reason });
    return askedAt;
  }

  private async refreshRound(reason: RefreshReason, deadline: number, signal: AbortSignal | undefined): Promise<boolean> {
    const { state, transport } = this.deps;
    const before = state.latest?.receivedAt, requestedAt = this.requestRefresh(reason);
    const seconds = (deadline - state.now().getTime()) / 1000;
    if (seconds <= 0) return false;
    await transport.waitUntil(() => state.latest?.receivedAt !== before || (state.panel.lastError?.at ?? -1) >= requestedAt, seconds, signal);
    const landed = state.latest?.receivedAt !== before;
    if (landed) withdrawSnapshotRefresh(state);
    return landed;
  }

  private async settle(deadline: number, signal: AbortSignal | undefined): Promise<FocusObservation | undefined> {
    const { state, transport } = this.deps;
    const seen = this.observe();
    if (!seen?.difference) return seen;
    const reported = state.liveFocus, seconds = Math.min(SETTLE_SECONDS, (deadline - state.now().getTime()) / 1000);
    if (seconds > 0) await transport.waitUntil(() => state.liveFocus !== reported, seconds, signal);
    return this.observe();
  }

  private async refreshUntilCurrent(first: FocusObservation, deadline: number, signal: AbortSignal | undefined): Promise<FocusObservation | undefined> {
    let last: FocusObservation | undefined = first;
    for (let round = 0; round < REFRESH_ROUNDS && last?.difference; round += 1) {
      if (!(await this.refreshRound(last.difference, deadline, signal))) break;
      last = await this.settle(deadline, signal);
    }
    return last;
  }

  private async rereadWithoutLiveView(wait: number, signal: AbortSignal | undefined): Promise<FocusOutcome> {
    const { state } = this.deps;
    const now = state.now().getTime(), readAt = state.latest ? Date.parse(state.latest.receivedAt) : Number.NaN;
    const connected = state.hostLink.status().state === "online";
    if (!state.latest || !connected || now - readAt <= RECENT_READ_MS) return { state: "unknown" };
    if (await this.refreshRound("unavailable", now + Math.max(0, wait) * 1000, signal)) return { state: "refreshed", note: REREAD_NOTE };
    state.eventLog("focus.refresh-timeout", { reason: "unavailable", waitedSeconds: wait });
    return { state: "timeout", note: UNREAD_NOTE };
  }

  async ensureFocusCurrent(wait = this.deps.state.panelSnapshotWaitMs / 1000, signal?: AbortSignal): Promise<FocusOutcome> {
    const { state } = this.deps;
    const first = this.observe();
    if (!first) return this.rereadWithoutLiveView(wait, signal);
    if (!first.difference) return { state: "current" };
    const last = await this.refreshUntilCurrent(first, state.now().getTime() + Math.max(0, wait) * 1000, signal);
    if (!last?.difference) return { state: "refreshed" };
    state.eventLog("focus.refresh-timeout", { reason: last.difference, waitedSeconds: wait });
    return { state: "timeout", note: focusNote(last.difference, last.focus, last.snapshot) };
  }
}
