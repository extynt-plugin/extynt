// The contracts of the host lane: the work kinds a runner handles, the link's status, and the context a runner receives.
import type { CallOptions, HostIdentity, PingDirectResult, PluginClient, StallReport } from "@extynt/host-native";
import type { InProcessReceivers } from "../receiver-types.js";
import type { AgentMailboxItem } from "../server-types.js";
import type { SidecarState } from "../server-state.js";
import type { HashMemory } from "./hash-memory.js";

const HOST_WORK_KINDS = ["apply_plan", "undo_plan", "refresh_snapshot", "capture_frame", "collection_page", "catalogue_page", "preview_controls", "host_census"] as const;
export type HostWorkKind = (typeof HOST_WORK_KINDS)[number];

/** Narrows a claimed item's kind to one a runner can be registered for. */
export function isHostWorkKind(kind: string): kind is HostWorkKind {
  return HOST_WORK_KINDS.some((known) => known === kind);
}

/** The data of a queued work item, as it was queued. */
export type HostWorkData = AgentMailboxItem["approvedData"];

/** The fields an event-log line carries. */
export type LogFields = Parameters<SidecarState["eventLog"]>[1];

/**
 * The link to the plugin as the sidecar reads it. `since` is the epoch ms when `state` last changed; `host` is which After Effects this is, as the
 * plugin reports it (or derived from `aeVersion` when it does not say), null until the first connection and kept after a disconnect like `aeVersion`;
 * `reason` says why the link is not online (discovery missing, stale, connect refused, host closed) and is null while it is.
 */
export interface HostLinkStatus {
  state: "offline" | "connecting" | "online" | "stalled" | "closing";
  since: number;
  instanceId: string | null;
  pluginVersion: string | null;
  aeVersion: string | null;
  host: HostIdentity | null;
  pid: number | null;
  libraryVersion: string | null;
  lastEventAt: number | null;
  idleAgeMs: number | null;
  stall: StallReport | null;
  busyKind: HostWorkKind | null;
  busySince: number | null;
  reason?: string | null;
}

/** What the rest of the sidecar reads to decide HOST_OFFLINE and to report the plugin; `state.hostLink` holds one. */
export interface HostLink { status(): HostLinkStatus }

/**
 * What a runner may do with the link beyond reading its status: make stalls visible in it (`callOptions` for a call whose stall should show, paired
 * with `clearStall` once it settles), and learn the plugin's static facts (`ping` is the `ping_direct` answer taken at connect, undefined if that failed).
 */
export interface HostLinkHandle extends HostLink {
  callOptions(extra?: CallOptions): CallOptions;
  clearStall(): void;
  noteLibrary(version: string): void;
  ping(): PingDirectResult | undefined;
}

/** A plain status link seen as a handle that adds nothing: for tests and doubles that only report status. */
export function linkHandleOf(link: HostLink): HostLinkHandle {
  return { status: () => link.status(), callOptions: (extra = {}) => extra, clearStall: () => undefined, noteLibrary: () => undefined, ping: () => undefined };
}

/** The status of a link that has not connected: offline since `since`, with no plugin facts. */
export function offlineLinkStatus(since: number): HostLinkStatus {
  return {
    state: "offline", since, instanceId: null, pluginVersion: null, aeVersion: null, host: null, pid: null, libraryVersion: null,
    lastEventAt: null, idleAgeMs: null, stall: null, busyKind: null, busySince: null,
  };
}

/** The link before any plugin connection: always offline. */
export function offlineHostLink(since: number): HostLink {
  const status = offlineLinkStatus(since);
  return { status: () => ({ ...status }) };
}

/**
 * What a runner receives. `hashes` remembers which layers the stored snapshot's last read saw at which hash, so the reads of a write fetch details
 * only for what moved; `capturePlan` asks the reader lane for a before or after thumbnail of a plan and is absent where no reader lane is composed.
 */
export interface HostLaneContext {
  client: PluginClient;
  state: SidecarState;
  receivers: InProcessReceivers;
  link: HostLinkHandle;
  hashes: HashMemory;
  capturePlan?: (planId: string, side: "before" | "after", urgency?: "idle" | "ahead") => boolean;
  now(): number;
  log(event: string, fields: LogFields): void;
}

/** Runs one claimed work item against the plugin and settles it (receipt, quarantine, snapshot) through `context.receivers`. */
export type HostRunner = (item: HostWorkData, context: HostLaneContext) => Promise<void>;

/** Where runners register for the kind of work they handle. */
export interface HostRunnerRegistry { register(kind: HostWorkKind, runner: HostRunner): void }

/** The lane's own registry: the same registration, with the table of runners readable for rigs that wrap one. */
export interface HostRunnerTable extends HostRunnerRegistry { readonly runners: Map<HostWorkKind, HostRunner> }

