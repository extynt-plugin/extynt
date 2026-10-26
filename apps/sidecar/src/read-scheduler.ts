/**
 * Asks the host for the smallest read that closes the gap between the sidecar's record and After Effects, on every plugin
 * event, focus report and claim. Concurrency model: the rules (read-rules) decide from the stored snapshot and the host's
 * stamp; at most one `refresh_snapshot` waits in the host work queue, and a later ask widens it (read-queue); a read the
 * host takes is remembered by id until its answer is merged onto the base (snapshot-merge); whether a part of the base is
 * current is judged by stamp alone (read-currency). Nothing is read while a native call is unresolved.
 */
import { nativeMutationQuarantine } from "./native-mutation-lease.js";
import { baseViewOf } from "./read-base-view.js";
import { freshStamp } from "./read-currency.js";
import { queueSnapshotRefresh, refreshPending, type ReadSpec } from "./read-queue.js";
import { decideRead, type ReadInput } from "./read-rules.js";
import { focusFresh } from "./live-focus.js";
import type { SidecarState } from "./server-state.js";

export { freshStamp as usableStamp } from "./read-currency.js";
export { freshSchedulerMemory } from "./read-rules.js";
export type { LiveStamp } from "./read-currency.js";
export type { SchedulerMemory } from "./read-rules.js";

export type SchedulerState = Pick<SidecarState, "agentMailbox" | "awaitingFreshSnapshotAfterPair" | "collection" | "eventLog" | "inFlight" | "inventory" | "latest" | "liveFocus" | "liveStamp" | "nativeBridge" | "now" | "options" | "readScheduler" | "readSequence">;

function quarantined(state: SchedulerState): boolean {
  return !!(state.nativeBridge.accessQuarantine() ?? nativeMutationQuarantine(state.inFlight) ?? state.collection.nativeAccessQuarantine());
}

function inputOf(state: SchedulerState, source: ReadInput["source"]): ReadInput {
  const now = state.now().getTime(), focus = state.liveFocus;
  return {
    now, source, awaitingFirstRead: state.awaitingFreshSnapshotAfterPair, inventoryKnown: !!state.inventory, pending: refreshPending(state), base: state.latest ? baseViewOf(state.latest) : undefined,
    focus: focus && focusFresh(focus, now) ? focus : null, stamp: freshStamp(state), memory: state.readScheduler,
  };
}

function logScheduled(state: SchedulerState, spec: ReadSpec): void {
  const { read } = spec, scoped = read.scope === "full" ? null : read;
  state.eventLog("read.scheduled", { reason: spec.reason, scope: read.scope, compositions: scoped?.compositionIds.length, items: scoped?.includeItems });
}

/** Looks at the sidecar's record and queues the read it calls for, if any. Never while a native call is unresolved. */
export function tickReadScheduler(state: SchedulerState, source: ReadInput["source"]): ReadSpec | null {
  if (quarantined(state)) return null;
  const before = state.readScheduler.ask, decision = decideRead(inputOf(state, source)), after = decision.memory.ask;
  state.readScheduler = decision.memory;
  if (after?.gaveUp && !(before?.key === after.key && before.gaveUp)) state.eventLog("read.gave-up", { key: after.key, asked: after.count });
  if (!decision.spec) return null;
  queueSnapshotRefresh(state, decision.spec);
  logScheduled(state, decision.spec);
  return decision.spec;
}
