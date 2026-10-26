// The one way work enters the host lane's queue; the lane is woken here so it drains without polling.
import type { SidecarState } from "../server-state.js";
import type { AgentMailboxItem } from "../server-types.js";

/** What enqueueing needs of the sidecar state; `hostWake` is optional so narrow `Pick` views and test doubles can enqueue. */
export type HostWorkQueueState = Pick<SidecarState, "agentMailbox"> & Partial<Pick<SidecarState, "hostWake">>;

/** Appends `item` to the queue and wakes the host lane. */
export function enqueueHostWork(state: HostWorkQueueState, item: AgentMailboxItem): void {
  state.agentMailbox.push(item);
  state.hostWake?.();
}

/** Puts `item` at the front of the queue so it is claimed before the work already waiting, and wakes the host lane. */
export function enqueueHostWorkAhead(state: HostWorkQueueState, item: AgentMailboxItem): void {
  state.agentMailbox.unshift(item);
  state.hostWake?.();
}

/** Removes and returns the first queued item `wanted` accepts, or undefined when none waits. */
export function takeHostWork(state: Pick<SidecarState, "agentMailbox">, wanted: (item: AgentMailboxItem) => boolean): AgentMailboxItem | undefined {
  const index = state.agentMailbox.findIndex(wanted);
  return index < 0 ? undefined : state.agentMailbox.splice(index, 1)[0];
}
