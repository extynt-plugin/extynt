// When a collection demand must be turned away as busy: only for a real conflict. A read waits in the mailbox for its turn, so background lane
// work (a frame capture, a snapshot refresh, a catalogue page, a census) never refuses it; a write in progress, one queued, or an unsettled native call does.
import { decode, object, string } from "@extynt/decode";
import type { SidecarState } from "./server-state.js";

const BACKGROUND_KINDS: ReadonlySet<string> = new Set(["capture_frame", "refresh_snapshot", "catalogue_page", "host_census"]);
const WRITE_KINDS: ReadonlySet<string> = new Set(["apply_plan", "undo_plan", "preview_controls"]);
const approvedKind = object({ kind: string() });

type BusyState = Pick<SidecarState, "agentMailbox" | "inFlight" | "panel">;

/** A background read whose native call has settled: it holds no write and other work only queues behind it. */
export function backgroundReadFlight(flight: NonNullable<SidecarState["inFlight"]>): boolean {
  return flight.nativeSettlement === undefined && BACKGROUND_KINDS.has(flight.kind);
}

function queuedWrite(item: BusyState["agentMailbox"][number]): boolean {
  const approved = decode(approvedKind, item.approvedData);
  return !!item.planId || (approved.ok && WRITE_KINDS.has(approved.value.kind));
}

/** Whether a collection demand must be refused because a write, a queued write or an unsettled native call holds the lane. */
export function collectionLaneBusy(state: BusyState): boolean {
  const flight = state.inFlight;
  if (flight && !backgroundReadFlight(flight)) return true;
  const { busy, busyKind } = state.panel;
  if (busy && !flight && (busyKind === null || !BACKGROUND_KINDS.has(busyKind))) return true;
  return state.agentMailbox.some(queuedWrite);
}
