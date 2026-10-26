// Public shapes of the fake plugin: the options, the recorded request, the handler signatures and the control surface.
import type { ChangeReason, EffectPopupEffect, HostEntry, PluginEndpoint, PluginEvent } from "@extynt/host-native";
import type { FixtureProject, WatchReport } from "./fixtures.js";
import type { RequestBody } from "./request.js";
import type { Reply } from "./replies.js";
import type { WireObject } from "./wire.js";

/** A request line the plugin accepted (token checked), as a handler sees it. `connection` numbers sockets in accept order from 1. */
export interface FakeRequest { id: string; op: string; connection: number; body: RequestBody }

/** A scripted answer for one op. */
export type Handler = (request: FakeRequest, plugin: FakePlugin) => Reply | Promise<Reply>;
/** `args` is the parsed object inside the `args` string of a `host_call`. */
export type HostCallHandler = (args: WireObject, request: FakeRequest, plugin: FakePlugin) => Reply | Promise<Reply>;

/** The mutable facts the default handlers answer from; tests assign to them directly. */
export interface FakeState {
  idleAgeMs: number | null;
  waitingOnDialog: { title: string; sinceMs: number } | null;
  idleTicks: number;
  queueDepth: number;
  oldestQueuedMs: number | null;
  pluginVersion: string;
  aeVersion: string;
  revisionGuard: "on" | "off";
  reportHost: boolean;
  pid: number;
  arch: string;
  libraryVersion: string | null;
  project: FixtureProject;
  watch: WatchReport;
  effectMenus?: EffectPopupEffect[];
}

/** How `startFakePlugin` is set up; everything but the state directory has a default. */
export interface FakePluginOptions {
  stateDirectory: string;
  token?: string;
  pid?: number;
  pluginVersion?: string;
  aeVersion?: string;
  revisionGuard?: "on" | "off";
  handlers?: Partial<Record<string, Handler>>;
  hostCalls?: Partial<Record<HostEntry, HostCallHandler>>;
  project?: FixtureProject;
  writeDiscovery?: boolean;
}

/** Which connections `dropConnections` closes. */
export type DropTarget = "all" | "watchers" | "requesters";

/** The running fake: its endpoint, the requests it saw, its handlers, and the controls tests use to change and break it. */
export interface FakePlugin {
  readonly port: number;
  readonly token: string;
  readonly discoveryPath: string;
  readonly endpoint: PluginEndpoint;
  readonly state: FakeState;
  readonly requests: FakeRequest[];
  readonly handlers: Map<string, Handler>;
  readonly hostCalls: Map<HostEntry, HostCallHandler>;
  readonly watcherCount: number;
  requestsFor(op: string): FakeRequest[];
  emit(event: PluginEvent): void;
  change(patch: Partial<WatchReport>, reason?: ChangeReason[]): void;
  still(): void;
  overflow(dropped: number): void;
  hostClosing(): void;
  sendRaw(text: string): void;
  sendRawChunks(chunks: string[], gapMs?: number): Promise<void>;
  dropConnections(which?: DropTarget): void;
  writeDiscovery(): void;
  removeDiscovery(): void;
  close(): Promise<void>;
}
