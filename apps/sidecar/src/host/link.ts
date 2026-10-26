// The sidecar's link to the extynt plugin: finds native.json, connects with backoff while the file names a live process,
// reports status (online, stalled, offline with a reason) and pairs the sidecar state to each new connection.
import { connectPlugin, hostIdentityOf, hostRefusal, readPluginEndpoint, watchPluginEndpoint } from "@extynt/host-native";
import type { CallOptions, ConnectOptions, PingDirectResult, PluginClient, PluginEndpoint, PluginEvent, StallReport } from "@extynt/host-native";
import type { SidecarState } from "../server-state.js";
import { uiEventsFor } from "../ui-events.js";
import type { HostLinkHandle, HostLinkStatus, HostWorkKind } from "./lane-types.js";
import { offlineLinkStatus } from "./lane-types.js";
import { identityOf, pairNativeHost, type LinkIdentity } from "./link-pairing.js";

const RECONNECT_INITIAL_MS = 250;
const RECONNECT_MAX_MS = 5000;

/** The link the lane and the rest of the sidecar hold: the status and call options of a `HostLinkHandle`, plus start and stop, the live client (undefined while offline or connecting), and subscriptions that return their unsubscribe. `onEvent` hears every plugin event after the link has noted it; `onConnected` fires once per connection, after pairing; `onChange` fires on every status change. */
export interface HostLinkController extends HostLinkHandle {
  start(): void;
  stop(): void;
  client(): PluginClient | undefined;
  onEvent(listener: (event: PluginEvent) => void): () => void;
  onConnected(listener: (client: PluginClient) => void): () => void;
  onChange(listener: (status: HostLinkStatus) => void): () => void;
  setBusy(kind: HostWorkKind | null): void;
}

interface HostLinkDeps {
  state: SidecarState;
  discoveryPath: string;
  connect?: (options: ConnectOptions) => Promise<PluginClient>;
  watch?: ConnectOptions["watch"];
  callTimeoutMs?: number;
  stallAfterMs?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
}

function offlineStatus(since: number): HostLinkStatus {
  return { ...offlineLinkStatus(since), reason: "Waiting for After Effects." };
}

function subscribe<Listener>(listeners: Set<Listener>, listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

const isLive = (status: HostLinkStatus): boolean => status.state === "online" || status.state === "stalled";

class NativeHostLink implements HostLinkController {
  private current: HostLinkStatus;
  private connection: PluginClient | undefined;
  private connectPing: PingDirectResult | undefined;
  private connectionCount = 0;
  private watcher: { close(): void } | undefined;
  private retry: NodeJS.Timeout | undefined;
  private backoffMs: number;
  private stopped = true;
  private attempting = false;
  private readonly events = new Set<(event: PluginEvent) => void>();
  private readonly connected = new Set<(client: PluginClient) => void>();
  private readonly changes = new Set<(status: HostLinkStatus) => void>();
  private readonly deps: HostLinkDeps;

  constructor(deps: HostLinkDeps) {
    this.deps = deps;
    this.backoffMs = deps.initialBackoffMs ?? RECONNECT_INITIAL_MS;
    this.current = offlineStatus(this.now());
  }

  private now(): number { return this.deps.state.now().getTime(); }

  status(): HostLinkStatus { return { ...this.current }; }

  client(): PluginClient | undefined { return this.connection; }

  ping(): PingDirectResult | undefined { return this.connectPing; }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.watcher = watchPluginEndpoint(this.deps.discoveryPath, () => this.discover());
    this.discover();
  }

  stop(): void {
    this.stopped = true;
    this.watcher?.close();
    this.watcher = undefined;
    this.clearRetry();
    const client = this.connection;
    this.goOffline("The sidecar is stopping.");
    client?.close();
  }

  onEvent(listener: (event: PluginEvent) => void): () => void { return subscribe(this.events, listener); }

  onConnected(listener: (client: PluginClient) => void): () => void { return subscribe(this.connected, listener); }

  onChange(listener: (status: HostLinkStatus) => void): () => void { return subscribe(this.changes, listener); }

  callOptions(extra: CallOptions = {}): CallOptions {
    const { callTimeoutMs, stallAfterMs } = this.deps;
    const timeout = callTimeoutMs === undefined ? {} : { timeoutMs: callTimeoutMs };
    const stall = stallAfterMs === undefined ? {} : { stallAfterMs };
    return { ...timeout, ...stall, ...extra, onStall: (report) => { this.noteStall(report); extra.onStall?.(report); } };
  }

  clearStall(): void {
    if (this.current.state === "stalled") this.set({ state: "online", stall: null, idleAgeMs: null });
  }

  setBusy(kind: HostWorkKind | null): void {
    this.set({ busyKind: kind, busySince: kind === null ? null : this.now() });
  }

  noteLibrary(version: string): void {
    if (this.current.libraryVersion !== version) this.set({ libraryVersion: version });
  }

  private noteStall(report: StallReport): void {
    if (!isLive(this.current)) return;
    this.deps.state.panel.lastSeenAt = this.now();
    this.set({ state: "stalled", stall: report, idleAgeMs: report.idleAgeMs });
  }

  private set(patch: Partial<HostLinkStatus>): void {
    const before = this.current, { state } = this.deps;
    const since = patch.state !== undefined && patch.state !== before.state ? this.now() : before.since;
    this.current = { ...before, ...patch, since };
    const snapshot = this.status();
    for (const listener of this.changes) listener(snapshot);
    uiEventsFor(state).publish({ type: "poke" });
    state.hostWake();
    if (snapshot.state !== before.state) state.eventLog("host.link-status", { state: snapshot.state, reason: snapshot.reason ?? null });
  }

  private goOffline(reason: string): void {
    this.connection = undefined;
    this.connectPing = undefined;
    this.set({ state: "offline", reason, stall: null, idleAgeMs: null, busyKind: null, busySince: null, instanceId: null });
  }

  private clearRetry(): void {
    if (this.retry) clearTimeout(this.retry);
    this.retry = undefined;
  }

  private discover(): void {
    if (this.stopped || this.attempting || this.connection) return;
    const found = readPluginEndpoint(this.deps.discoveryPath);
    this.clearRetry();
    if (found.ok) { void this.attempt(found.endpoint); return; }
    if (this.current.state !== "offline" || this.current.reason !== found.message) this.goOffline(found.message);
  }

  private async attempt(endpoint: PluginEndpoint): Promise<void> {
    this.attempting = true;
    this.set({ state: "connecting", reason: null });
    try {
      const connect = this.deps.connect ?? connectPlugin;
      const client = await connect({
        endpoint, ...(this.deps.watch ? { watch: this.deps.watch } : {}),
        onEvent: (event) => this.onPluginEvent(event),
        onClose: (reason) => this.onClosed(reason),
      });
      if (this.stopped) client.close();
      else await this.finishConnect(client, endpoint);
    } catch (error) {
      this.goOffline(`Could not connect to After Effects: ${error instanceof Error ? error.message : String(error)}`);
      this.scheduleRetry();
    } finally {
      this.attempting = false;
    }
  }

  private async finishConnect(client: PluginClient, endpoint: PluginEndpoint): Promise<void> {
    this.connection = client;
    this.connectionCount += 1;
    this.backoffMs = this.deps.initialBackoffMs ?? RECONNECT_INITIAL_MS;
    const ping = await client.pingDirect();
    if (this.connection !== client) return;
    this.connectPing = ping.kind === "ok" ? ping.result : undefined;
    const identity = identityOf(this.connectPing, endpoint, this.connectionCount);
    const host = hostIdentityOf(this.connectPing?.host, identity.aeVersion), refusal = hostRefusal(host);
    if (refusal) this.refuse(client, refusal);
    else this.markOnline(client, identity, host);
  }

  private markOnline(client: PluginClient, identity: LinkIdentity, host: HostLinkStatus["host"]): void {
    pairNativeHost(this.deps.state, identity);
    this.deps.state.panel.lastSeenAt = this.now();
    this.set({
      state: "online", reason: null, ...identity, host, pid: identity.pid || null, libraryVersion: this.connectPing?.library.version ?? null,
      lastEventAt: this.now(), stall: null, idleAgeMs: this.connectPing?.idleAgeMs ?? null,
    });
    for (const listener of this.connected) listener(client);
    this.deps.state.eventLog("host.link-connected", { instanceId: identity.instanceId, pluginVersion: identity.pluginVersion });
  }

  private refuse(client: PluginClient, reason: string): void {
    this.goOffline(reason);
    client.close();
  }

  private onPluginEvent(event: PluginEvent): void {
    this.deps.state.panel.lastSeenAt = this.now();
    if (event.event === "host-closing") this.set({ state: "closing", reason: "After Effects is closing.", lastEventAt: this.now() });
    else this.current = { ...this.current, lastEventAt: this.now() };
    for (const listener of this.events) listener(event);
  }

  private onClosed(reason: "host-closing" | "reset" | "closed-by-client"): void {
    if (reason === "closed-by-client") return;
    this.goOffline(reason === "host-closing" ? "After Effects closed." : "The connection to After Effects was lost.");
    if (!this.stopped) this.scheduleRetry();
  }

  private scheduleRetry(): void {
    if (this.stopped || this.retry) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.deps.maxBackoffMs ?? RECONNECT_MAX_MS, delay * 2);
    this.retry = setTimeout(() => { this.retry = undefined; this.discover(); }, delay);
    this.retry.unref();
  }
}

/** Builds the link. It connects with backoff only while the discovery file names a live process: a closed or killed After Effects ends the retries until the file changes, and a host below the supported floor is refused and never retried. */
export function createHostLink(deps: HostLinkDeps): HostLinkController {
  return new NativeHostLink(deps);
}
