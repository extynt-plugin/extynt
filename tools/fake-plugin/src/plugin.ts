// startFakePlugin: a loopback TCP server that speaks the native protocol (docs/native/protocol.md) and writes native.json.
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";
import { WATCH_INTERVAL_MS, WATCH_STILL_MS, isHostEntry } from "@extynt/host-native";
import type { ChangeReason, HostEntry, PluginEndpoint, PluginEvent } from "@extynt/host-native";
import { dispatchOp } from "./dispatch.js";
import { initialWatchState, makeProject } from "./fixtures.js";
import type { WatchReport } from "./fixtures.js";
import { ok, refuse, sleep } from "./replies.js";
import type { Reply } from "./replies.js";
import { Session } from "./session.js";
import type { SessionHost } from "./session.js";
import type { DropTarget, FakePlugin, FakePluginOptions, FakeRequest, FakeState, Handler, HostCallHandler } from "./types.js";

const REASON_BY_MEMBER: ReadonlyMap<string, ChangeReason> = new Map<string, ChangeReason>([
  ["revision", "revision"], ["items", "revision"], ["selection", "selection"], ["selectedLayers", "selection"], ["activeCompId", "active"],
  ["activeCompName", "active"], ["time", "time"], ["projectName", "project"], ["projectPath", "project"], ["epoch", "project"],
]);

function reasonsFor(patch: Partial<WatchReport>): ChangeReason[] {
  const reasons = new Set<ChangeReason>();
  for (const member of Object.keys(patch)) {
    const reason = REASON_BY_MEMBER.get(member);
    if (reason) reasons.add(reason);
  }
  return reasons.size > 0 ? [...reasons] : ["revision"];
}

function inRange(value: number | undefined, range: { min: number; max: number; default: number }): number | null {
  if (value === undefined) return range.default;
  return Number.isInteger(value) && value >= range.min && value <= range.max ? value : null;
}

function initialState(options: FakePluginOptions): FakeState {
  const project = options.project ?? makeProject(), revisionGuard = options.revisionGuard ?? "on";
  return {
    idleAgeMs: 5, waitingOnDialog: null, idleTicks: 1000, queueDepth: 0, oldestQueuedMs: null, pluginVersion: options.pluginVersion ?? "0.1.0-fake",
    aeVersion: options.aeVersion ?? "25.0", revisionGuard, reportHost: true, pid: options.pid ?? process.pid, arch: "arm64", libraryVersion: null, project, watch: initialWatchState(project, revisionGuard),
  };
}

class FakeServer implements FakePlugin, SessionHost {
  readonly token: string;
  readonly state: FakeState;
  readonly requests: FakeRequest[] = [];
  readonly handlers = new Map<string, Handler>();
  readonly hostCalls = new Map<HostEntry, HostCallHandler>();
  readonly discoveryPath: string;
  port = 0;
  private readonly server = net.createServer((socket) => this.accept(socket));
  private readonly sessions = new Set<Session>();
  private readonly watchers = new Set<Session>();
  private readonly options: FakePluginOptions;
  private accepted = 0;
  private seq = 0;
  private wroteDiscovery = false;

  constructor(options: FakePluginOptions) {
    this.options = options;
    this.token = options.token ?? "f".repeat(64);
    this.discoveryPath = join(options.stateDirectory, "native.json");
    this.state = initialState(options);
    this.install(options);
  }

  private install({ handlers = {}, hostCalls = {} }: FakePluginOptions): void {
    for (const [op, handler] of Object.entries(handlers)) if (handler) this.handlers.set(op, handler);
    for (const [entry, handler] of Object.entries(hostCalls)) if (handler && isHostEntry(entry)) this.hostCalls.set(entry, handler);
  }

  get endpoint(): PluginEndpoint {
    return {
      path: this.discoveryPath,
      port: this.port,
      token: this.token,
      pid: this.state.pid,
      pluginVersion: this.state.pluginVersion,
      aeVersion: this.state.aeVersion,
    };
  }

  get watcherCount(): number { return this.watchers.size; }

  async listen(): Promise<void> {
    await new Promise<void>((resolve) => { this.server.listen(0, "127.0.0.1", resolve); });
    const address = this.server.address();
    this.port = typeof address === "object" && address ? address.port : 0;
    if (this.options.writeDiscovery !== false) this.writeDiscovery();
  }

  private accept(socket: net.Socket): void {
    this.accepted += 1;
    this.sessions.add(new Session(socket, this.accepted, this));
  }

  dispatch(request: FakeRequest): Promise<Reply> { return dispatchOp(this, request); }

  forget(session: Session): void {
    this.sessions.delete(session);
    this.watchers.delete(session);
  }

  async subscribe(session: Session, request: FakeRequest): Promise<void> {
    const intervalMs = inRange(request.body.intervalMs, WATCH_INTERVAL_MS);
    const stillMs = inRange(request.body.stillMs, WATCH_STILL_MS);
    if (intervalMs === null || stillMs === null) {
      await session.writeReply(request, refuse("BAD_REQUEST", "intervalMs must be 50 to 2000 and stillMs 250 to 10000."));
      return;
    }
    await session.writeReply(request, ok({ subscribed: true, intervalMs, stillMs }));
    session.watching = true;
    this.watchers.add(session);
    session.write(`${JSON.stringify(this.changeEvent(["initial"]))}\n`);
  }

  private changeEvent(reason: ChangeReason[]): PluginEvent {
    this.seq += 1;
    return { event: "change", seq: this.seq, at: performance.now(), reason, ...this.state.watch };
  }

  requestsFor(op: string): FakeRequest[] { return this.requests.filter((request) => request.op === op); }

  emit(event: PluginEvent): void { this.sendRaw(`${JSON.stringify(event)}\n`); }

  change(patch: Partial<WatchReport>, reason?: ChangeReason[]): void {
    this.state.watch = { ...this.state.watch, ...patch, ...(this.state.revisionGuard === "off" ? { revision: null } : {}) };
    this.emit(this.changeEvent(reason ?? reasonsFor(patch)));
  }

  still(): void {
    this.seq += 1;
    this.emit({ event: "still", seq: this.seq, at: performance.now(), epoch: this.state.watch.epoch, revision: this.state.watch.revision });
  }

  overflow(dropped: number): void { this.emit({ event: "overflow", dropped }); }

  hostClosing(): void {
    this.seq += 1;
    this.emit({ event: "host-closing", seq: this.seq, at: performance.now(), reason: "death-hook" });
    for (const session of this.sessions) session.socket.end();
  }

  sendRaw(text: string): void { for (const session of this.watchers) session.write(text); }

  async sendRawChunks(chunks: string[], gapMs = 5): Promise<void> {
    for (const chunk of chunks) {
      this.sendRaw(chunk);
      await sleep(gapMs);
    }
  }

  dropConnections(which: DropTarget = "all"): void {
    for (const session of this.sessions) {
      if (which === "all" || (which === "watchers") === session.watching) session.socket.destroy();
    }
  }

  writeDiscovery(): void {
    mkdirSync(this.options.stateDirectory, { recursive: true });
    const temporary = `${this.discoveryPath}.tmp`;
    const { pid, pluginVersion, aeVersion } = this.state;
    writeFileSync(temporary, JSON.stringify({ port: this.port, token: this.token, pid, pluginVersion, aeVersion }));
    renameSync(temporary, this.discoveryPath);
    this.wroteDiscovery = true;
  }

  removeDiscovery(): void {
    if (existsSync(this.discoveryPath)) rmSync(this.discoveryPath);
  }

  async close(): Promise<void> {
    for (const session of this.sessions) session.socket.destroy();
    await new Promise<void>((resolve) => { this.server.close(() => resolve()); });
    if (this.wroteDiscovery) this.removeDiscovery();
  }
}

/** Starts a fake plugin on a loopback port and, unless told not to, writes its discovery file. */
export async function startFakePlugin(options: FakePluginOptions): Promise<FakePlugin> {
  const plugin = new FakeServer(options);
  await plugin.listen();
  return plugin;
}
