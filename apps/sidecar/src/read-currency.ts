/**
 * Whether the sidecar's own copy of a composition (or of the item list) is the one After Effects holds right now. The
 * answer comes from the sidecar's record alone: the revision each part was last read at, against the revision the host's
 * last stamp reported. No host call is made here; a part that cannot be proven current is simply not current.
 */
import { baseViewOf } from "./read-base-view.js";
import { observedOfWhole } from "./snapshot-merge.js";
import type { SidecarState } from "./server-state.js";

/**
 * AE's native stamp; `at` is when the observation behind it was made. `ttlMs` is set only on stamps the plugin's events
 * carry: the age within which such a stamp is current, whatever was read since.
 */
export interface LiveStamp {
  epoch: number;
  revision: number;
  items: number | null;
  at: number;
  ttlMs?: number;
}

export type CurrencyState = Pick<SidecarState, "latest" | "liveStamp" | "now">;

const STAMP_MAX_AGE_MS = 5000;

/**
 * The last stamp, when it is recent enough to mean anything. An event stamp (`ttlMs`) is pushed the moment AE changes and
 * confirmed by every `still`, so recent is current. A stamp without a `ttlMs` must also be no older than the newest read: from
 * before the last read it says nothing that read did not already see, and after an apply it would still show the revision
 * from before the plan ran and make the fresh read look out of date.
 */
export function freshStamp(state: CurrencyState, maxAgeMs = STAMP_MAX_AGE_MS): LiveStamp | null {
  const stamp = state.liveStamp;
  if (!stamp || state.now().getTime() - stamp.at > Math.min(maxAgeMs, stamp.ttlMs ?? maxAgeMs)) return null;
  if (stamp.ttlMs !== undefined) return stamp;
  return state.latest && stamp.at < Date.parse(state.latest.receivedAt) ? null : stamp;
}

/** The compositions the stored snapshot holds. */
export function heldCompositions(state: Pick<SidecarState, "latest">): ReadonlySet<string> {
  return state.latest ? baseViewOf(state.latest).held : new Set<string>();
}

/** True when the stored copy of the composition was read at AE's current revision and nothing keeps it from being whole; a scoped collection snapshot is as current as the one composition it holds. */
export function compositionCurrent(state: CurrencyState, id: string, maxAgeMs = STAMP_MAX_AGE_MS): boolean {
  const stamp = freshStamp(state, maxAgeMs);
  if (!state.latest || !stamp) return false;
  const base = baseViewOf(state.latest);
  return base.epoch === stamp.epoch && base.held.has(id) && !base.gaps.has(id) && base.observed[id] === stamp.revision;
}

/** True when the item list was read at AE's current revision and still has the count the host reports. */
export function itemsCurrent(state: CurrencyState, maxAgeMs = STAMP_MAX_AGE_MS): boolean {
  const stamp = freshStamp(state, maxAgeMs);
  if (!state.latest || !stamp) return false;
  const observed = state.latest.observed ?? observedOfWhole(state.latest.snapshot);
  return observed.epoch === stamp.epoch && observed.itemsRevision === stamp.revision && (stamp.items === null || observed.itemCount === stamp.items);
}

/** True when AE's stamp is the stored snapshot's own: nothing happened since the last read. */
export function stampMatchesLatest(state: CurrencyState, maxAgeMs = STAMP_MAX_AGE_MS): boolean {
  const stamp = freshStamp(state, maxAgeMs);
  if (!state.latest || !stamp) return false;
  const base = baseViewOf(state.latest);
  return base.hostStamp?.epoch === stamp.epoch && base.hostStamp.revision === stamp.revision;
}
