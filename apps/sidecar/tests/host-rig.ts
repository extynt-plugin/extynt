/** The harness the native host-lane tests share: a sidecar, the fake plugin, a connected client, the reader runners, and a small stand-in for Card F1's lane that runs queued work in the order the lane will. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectPlugin } from "@extynt/host-native";
import type { PluginClient } from "@extynt/host-native";
import { initialWatchState, makeLayer, makeProject, startFakePlugin } from "@extynt/fake-plugin";
import type { FakePlugin, FakePluginOptions, FixtureProject } from "@extynt/fake-plugin";
import { linkHandleOf, offlineHostLink } from "../src/host/lane-types.js";
import { isHostWorkKind, type HostLaneContext, type HostLinkStatus, type LogFields, type HostRunner, type HostRunnerRegistry, type HostWorkKind } from "../src/host/lane-types.js";
import { createHostReaders, type HostReaders } from "../src/host/readers.js";
import type { EventTimers } from "../src/host/events.js";
import type { UiEvent } from "../src/host/ui-events.js";
import type { InProcessReceivers } from "../src/receiver-types.js";
import type { ReadOnlySidecar } from "../src/server.js";
import { mailboxQuarantine } from "../src/server-panel-lease.js";
import { sidecarForPlugin, token } from "./sidecar-fixture.js";
import { listOf, parseJson, type JsonArray } from "./http-json.js";
import { present } from "./present.js";

export const NATIVE_PANEL = "native:1:1";

/** A project whose layers carry hashes, so an unchanged layer can be told from a changed one. */
export function hashedProject(): FixtureProject {
  const project = makeProject(), composition = present(project.compositions[0]);
  composition.layers = [makeLayer("11", 1, { hash: "h11-a", name: "Title" }), makeLayer("12", 2, { hash: "h12-a", name: "Back" })];
  return project;
}

export function onlineLink(): { status(): HostLinkStatus } {
  const base = offlineHostLink(0).status();
  return { status: () => ({ ...base, state: "online", instanceId: NATIVE_PANEL, pid: 1, pluginVersion: "0.1.0-fake", aeVersion: "25.0" }) };
}

/** Timers the test fires by hand, so the coalescing window closes when the test says and never on the wall clock. */
export function manualTimers(): EventTimers & { fire(): number; waiting(): number } {
  let queue: Array<{ run: () => void; delayMs: number }> = [];
  return {
    set: (run, delayMs) => { const entry = { run, delayMs }; queue.push(entry); return () => { queue = queue.filter((waiting) => waiting !== entry); }; },
    fire: () => { const due = queue; queue = []; for (const entry of due) entry.run(); return due.length; },
    waiting: () => queue.length,
  };
}

export interface HostRig {
  sidecar: ReadOnlySidecar;
  plugin: FakePlugin;
  client: PluginClient;
  readers: HostReaders;
  receivers: InProcessReceivers;
  ui: UiEvent[];
  logs: Array<{ event: string; fields: LogFields }>;
  timers: ReturnType<typeof manualTimers>;
  context: HostLaneContext;
  calls: string[];
  bodies: Array<{ call: string; args: JsonArray }>;
  pair(): void;
  drain(): Promise<HostWorkKind[]>;
  settle(): Promise<void>;
  close(): Promise<void>;
}

type Note = <A>(name: string, args: A) => void;
const ACTIONS = ["reserve", "settle", "dispatch", "complete", "cancel", "prepare", "start"];

function noter(calls: string[], bodies: HostRig["bodies"]): Note {
  return (name, args) => {
    const copy = listOf(parseJson(JSON.stringify(args) ?? "[]"), "");
    const first = copy[0];
    const action = typeof first === "string" && ACTIONS.includes(first) ? `:${first}` : "";
    calls.push(`${name}${action}`);
    bodies.push({ call: `${name}${action}`, args: copy });
  };
}

function recording(real: InProcessReceivers, calls: string[], bodies: HostRig["bodies"]): InProcessReceivers {
  const note = noter(calls, bodies);
  return {
    acceptSnapshot: (...a) => { note("acceptSnapshot", a); return real.acceptSnapshot(...a); },
    acceptHostCensus: (...a) => { note("acceptHostCensus", a); return real.acceptHostCensus(...a); },
    acceptReceipt: (...a) => real.acceptReceipt(...a), beginApply: (...a) => real.beginApply(...a), acceptPipelineEvent: (...a) => real.acceptPipelineEvent(...a),
    acceptCapture: (...a) => { note("acceptCapture", a); return real.acceptCapture(...a); },
    acceptFocus: (...a) => real.acceptFocus(...a),
    acceptPanelEvent: (...a) => { note("acceptPanelEvent", a); return real.acceptPanelEvent(...a); },
    collection: (...a) => { note("collection", a); return real.collection(...a); },
    catalogue: (...a) => { note("catalogue", a); return real.catalogue(...a); },
    nativeBridge: (...a) => { note("bridge", a); return real.nativeBridge(...a); },
  };
}

export interface RigOptions { plugin?: Partial<FakePluginOptions>; sidecar?: { now?: () => Date }; realTimers?: boolean; thumbsEnabled?: () => boolean }

type HostClaim = ReturnType<HostReaders["claimAhead"]>;

function nextClaim(sidecar: ReadOnlySidecar, readers: HostReaders, now: number): HostClaim {
  const ahead = readers.claimAhead(now);
  if (ahead) return ahead;
  const queued = sidecar.agentMailbox.shift();
  const kind = String(queued?.approvedData.kind);
  if (queued && isHostWorkKind(kind)) {
    sidecar.inFlight = { kind, id: kind, claimedAt: now };
    return { kind, item: queued.approvedData };
  }
  return readers.claimBackground(now);
}

interface DrainParts { sidecar: ReadOnlySidecar; readers: HostReaders; context: HostLaneContext; runners: Map<HostWorkKind, HostRunner> }

function hostDrain(parts: DrainParts): () => Promise<HostWorkKind[]> {
  return async () => {
    const ran: HostWorkKind[] = [];
    for (;;) {
      if (mailboxQuarantine(parts.sidecar)) return ran;
      const claim = nextClaim(parts.sidecar, parts.readers, parts.context.now());
      const runner = claim ? parts.runners.get(claim.kind) : undefined;
      if (!claim || !runner) return ran;
      await runner(claim.item, parts.context);
      ran.push(claim.kind);
    }
  };
}

export async function startHostRig(options: RigOptions = {}): Promise<HostRig> {
  const directory = mkdtempSync(join(tmpdir(), "extynt-host-rig-"));
  const project = options.plugin?.project ?? hashedProject();
  const plugin = await startFakePlugin({ stateDirectory: directory, ...options.plugin, project });
  plugin.state.watch = initialWatchState(project);
  const sidecar = sidecarForPlugin({ port: 0, token, quietAgentLog: true, ...(options.sidecar?.now ? { now: options.sidecar.now } : {}) });
  await sidecar.start();
  const ui: UiEvent[] = [], logs: HostRig["logs"] = [], calls: string[] = [], bodies: HostRig["bodies"] = [], timers = manualTimers();
  const receivers = recording(sidecar.receivers, calls, bodies);
  sidecar.eventLog = (event, fields) => { logs.push({ event, fields }); };
  sidecar.activePanelInstanceId = NATIVE_PANEL;
  sidecar.collection.pair(NATIVE_PANEL);
  const readers = createHostReaders({ state: sidecar, receivers, sink: { publish: (event) => ui.push(event) }, ...(options.realTimers ? {} : { timers }), ...(options.thumbsEnabled ? { thumbsEnabled: options.thumbsEnabled } : {}) });
  const client = await connectPlugin({ endpoint: plugin.endpoint, watch: { intervalMs: 50, stillMs: 250 }, onEvent: (event) => readers.events.onEvent(event), onClose: () => undefined });
  sidecar.hostLink = onlineLink();
  const context: HostLaneContext = { client, state: sidecar, receivers, link: linkHandleOf(sidecar.hostLink), hashes: readers.hashes, now: () => sidecar.now().getTime(), log: (event, fields) => { logs.push({ event, fields }); } };
  const runners = new Map<HostWorkKind, HostRunner>();
  const registry: HostRunnerRegistry = { register: (kind, runner) => { runners.set(kind, runner); } };
  readers.register(registry);
  const settle = () => new Promise<void>((resolve) => { setTimeout(resolve, 60); });

  const drain = hostDrain({ sidecar, readers, context, runners });

  return {
    sidecar, plugin, client, readers, receivers, ui, logs, timers, context, calls, bodies,
    pair() { sidecar.awaitingFreshSnapshotAfterPair = true; sidecar.pendingPanelReset = true; readers.afterPair(); },
    drain, settle,
    async close() { readers.events.reset(); client.close(); await plugin.close(); await sidecar.stop(); rmSync(directory, { recursive: true, force: true }); },
  };
}

export async function until(done: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!done()) {
    if (Date.now() - start > timeoutMs) throw new Error("condition not reached in time");
    await new Promise((resolve) => { setTimeout(resolve, 5); });
  }
}
