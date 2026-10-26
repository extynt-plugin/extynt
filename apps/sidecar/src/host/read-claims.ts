// The claims the host lane makes on the sidecar's own queues, in the order they must be made: a bounded collection page goes
// ahead of everything (an agent is waiting on it), and background work (a plan's thumbnails, then the catalogue) only when nothing else waits.
import { takeHostWork } from "./work-queue.js";
import { decode, object, string } from "@extynt/decode";
import { jsonFieldsOf } from "@extynt/mcp-server";
import { nativeMutationQuarantine } from "../native-mutation-lease.js";
import type { SidecarState } from "../server-state.js";
import type { AgentMailboxItem } from "../server-types.js";
import type { HostWorkData, HostWorkKind } from "./lane-types.js";
import { cachedFontKey } from "../server-census-fonts.js";
import type { ThumbService } from "./thumbs.js";

/** A claim on the sidecar's own queues: the kind of work and the item to run. */
export interface ReadClaim { kind: HostWorkKind; item: HostWorkData }

type ClaimState = Pick<SidecarState, "activeChatTurn" | "activePanelInstanceId" | "agentMailbox" | "catalogue" | "collection" | "hostFacts" | "hostProfile" | "inFlight" | "nativeBridge" | "now" | "workflowContinuationQueue">;

const dispatchTicket = object({ dispatch: object({ ticket: string() }) });

function quarantined(state: ClaimState): boolean {
  return !!(state.nativeBridge.accessQuarantine() ?? nativeMutationQuarantine(state.inFlight) ?? state.collection.nativeAccessQuarantine());
}

const isCollectionPage = (item: AgentMailboxItem): boolean => item.approvedData.kind === "collection_page";

function takeCollectionPage(state: ClaimState): HostWorkData | undefined {
  return takeHostWork(state, isCollectionPage)?.approvedData;
}

/** The next collection page whose ticket is still current; a stale one is dropped. */
export function claimAhead(state: ClaimState, now: number): ReadClaim | undefined {
  if (quarantined(state)) return undefined;
  for (let page = takeCollectionPage(state); page; page = takeCollectionPage(state)) {
    const dispatch = decode(dispatchTicket, page);
    if (!dispatch.ok || !state.collection.dispatchCurrent(dispatch.value.dispatch.ticket)) continue;
    state.inFlight = { kind: "collection_page", id: dispatch.value.dispatch.ticket, claimedAt: now };
    return { kind: "collection_page", item: page };
  }
  return undefined;
}

function claimThumbnail(state: ClaimState, now: number, thumbs: Pick<ThumbService, "next">): ReadClaim | undefined {
  const thumb = thumbs.next();
  if (!thumb) return undefined;
  state.inFlight = { kind: "capture_frame", id: thumb.id, claimedAt: now };
  return { kind: "capture_frame", item: thumb.item };
}

function claimFonts(state: ClaimState, now: number): ReadClaim | undefined {
  if (state.hostFacts.fonts.phase !== "pending") return undefined;
  const requestId = `fonts-${now.toString(36)}`, key = cachedFontKey(state.hostProfile);
  state.hostFacts.fonts = { phase: "loading", at: now };
  state.inFlight = { kind: "host_census", id: requestId, claimedAt: now };
  return { kind: "host_census", item: { kind: "host_census", requestId, part: "fonts", ...(key ? { fontFingerprint: key } : {}) } };
}

function claimCatalogue(state: ClaimState, now: number): ReadClaim | undefined {
  const idle = !state.activeChatTurn && state.workflowContinuationQueue.size === 0;
  const page = state.catalogue.nextInstanceRead(idle, state.activePanelInstanceId ?? null);
  if (!page) return undefined;
  state.inFlight = { kind: "catalogue_page", id: page.ticket, claimedAt: now };
  return { kind: "catalogue_page", item: jsonFieldsOf(page) };
}

/**
 * Offered only when the mailbox is empty and nothing runs: a plan's thumbnail first, then the installed fonts (the census half that asks for the
 * key of the list already held), then the catalogue, which also waits for the agent to finish its turn and for a queued workflow continuation to
 * start, and which the user's After Effects only ever reads for an effect already in their project (probe pages run in the headless engine).
 */
export function claimBackground(state: ClaimState, now: number, thumbs: Pick<ThumbService, "next">): ReadClaim | undefined {
  if (quarantined(state) || state.inFlight || state.agentMailbox.length > 0) return undefined;
  return claimThumbnail(state, now, thumbs) ?? claimFonts(state, now) ?? claimCatalogue(state, now);
}
