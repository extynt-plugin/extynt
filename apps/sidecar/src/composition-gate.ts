/**
 * The wait before the agent acts on a composition: the sidecar's copy of each composition it is about to read or plan from
 * must be the one After Effects holds now. A copy that is behind is read straight away (no settle debounce: the agent is
 * waiting), scoped to those compositions, and the wait ends when the read lands, the host reports an error, or the deadline
 * passes. On a timeout the agent goes ahead with a note, and the apply-time stamp check stays the safety net.
 */
import { visitStrings } from "./bounded-strings.js";
import { baseViewOf } from "./read-base-view.js";
import { compositionCurrent, freshStamp } from "./read-currency.js";
import { MAX_READ_COMPOSITIONS, queueSnapshotRefresh, withdrawSnapshotRefresh } from "./read-queue.js";
import type { SchedulerState } from "./read-scheduler.js";
import type { HttpCoreCapability } from "./server-http-core.js";
import type { SidecarState } from "./server-state.js";
import type { Opaque } from "./snapshot-view.js";

interface GateDeps {
  readonly state: Pick<SidecarState, "panel" | "panelSnapshotWaitMs"> & Partial<Pick<SidecarState, "hostLink">> & SchedulerState;
  readonly transport: Pick<HttpCoreCapability, "waitUntil">;
}
type GateState = GateDeps["state"];
interface CompositionOutcome { state: "current" | "refreshed" | "timeout"; note?: string }

const ID_SCAN = { strings: 5000, depth: 8, length: 128 };

/** The compositions in `held` that a tool's arguments name, found by a bounded scan of their strings. */
export function compositionIdsMentioned(args: Opaque, held: ReadonlySet<string>): string[] {
  const found = new Set<string>();
  visitStrings(args, ID_SCAN, (text) => { if (held.has(text)) found.add(text); });
  return [...found];
}

function timeoutNote(ids: readonly string[]): string {
  const one = ids.length === 1;
  return `Composition${one ? "" : "s"} ${ids.join(", ")} could not be re-read from After Effects in time, so ${one ? "its" : "their"} content in this context may be out of date. Call ae_refresh_snapshot before planning from ${one ? "it" : "them"}.`;
}

function behind(state: GateState, ids: readonly string[]): string[] {
  const stored = state.latest;
  if (!stored || !freshStamp(state) || state.hostLink?.status().state !== "online") return [];
  const held = baseViewOf(stored).held;
  return [...new Set(ids)].filter((id) => held.has(id) && !compositionCurrent(state, id));
}

function covers(state: GateState, before: SidecarState["latest"], ids: readonly string[], revision: number | null): boolean {
  const stored = state.latest;
  if (!stored || stored === before) return false;
  const base = baseViewOf(stored);
  return revision === null || ids.every((id) => !base.held.has(id) || (base.observed[id] ?? -1) >= revision);
}

async function readNow(deps: GateDeps, stale: string[], wait: number, signal: AbortSignal | undefined): Promise<boolean> {
  const { state } = deps, stamp = freshStamp(state), before = state.latest, askedAt = state.now().getTime(), revision = stamp?.revision ?? null;
  const counted = before ? baseViewOf(before).itemCount : null, itemsMoved = stamp?.items != null && counted !== null && counted !== stamp.items;
  queueSnapshotRefresh(state, { reason: "gate", read: { scope: "compositions", compositionIds: stale, includeItems: itemsMoved } });
  state.eventLog("composition.refresh-requested", { compositions: stale.length });
  await deps.transport.waitUntil(() => covers(state, before, stale, revision) || (state.panel.lastError?.at ?? -1) >= askedAt, wait, signal);
  return covers(state, before, stale, revision);
}

async function refreshAll(deps: GateDeps, stale: readonly string[], wait: number, signal: AbortSignal | undefined): Promise<string[]> {
  const deadline = deps.state.now().getTime() + wait * 1000;
  for (let at = 0; at < stale.length; at += MAX_READ_COMPOSITIONS) {
    const remaining = (deadline - deps.state.now().getTime()) / 1000;
    if (!(remaining > 0 && await readNow(deps, stale.slice(at, at + MAX_READ_COMPOSITIONS), remaining, signal))) return stale.slice(at);
  }
  return [];
}

async function ensureCurrent(deps: GateDeps, ids: readonly string[], wait: number, signal: AbortSignal | undefined): Promise<CompositionOutcome> {
  const { state } = deps, stale = behind(state, ids);
  if (stale.length === 0) return { state: "current" };
  const left = wait > 0 ? await refreshAll(deps, stale, wait, signal) : stale;
  if (left.length === 0) { withdrawSnapshotRefresh(state); return { state: "refreshed" }; }
  state.eventLog("composition.refresh-timeout", { compositions: left.length, waitedSeconds: wait });
  return { state: "timeout", note: timeoutNote(left) };
}

/** The gate for the compositions a tool is about to read: `ensureCompositionsCurrent` re-reads the stale ones and waits, up to the snapshot wait unless told otherwise. */
export function createCompositionGate(deps: GateDeps): { ensureCompositionsCurrent(ids: readonly string[], wait?: number, signal?: AbortSignal): Promise<CompositionOutcome> } {
  return { ensureCompositionsCurrent: (ids, wait = deps.state.panelSnapshotWaitMs / 1000, signal) => ensureCurrent(deps, ids, wait, signal) };
}
