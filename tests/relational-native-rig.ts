// A real native-lane sidecar on the fake plugin, whose collection, census and apply entries run the shipped jsx over the simulated relational project.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { fieldOf, readJson } from '../apps/panel/dist/tests/json-narrow.js';
import type { HostLaneContext, HostRunner, HostRunnerRegistry, HostRunnerTable, HostWorkKind } from '../apps/sidecar/dist/src/host/lane-types.js';
import type { InProcessReceivers, ReceiverOutcome } from '../apps/sidecar/dist/src/receiver-types.js';
import { ReadOnlySidecar } from '../apps/sidecar/dist/src/server.js';
import type { SidecarOptions } from '../apps/sidecar/dist/src/server-types.js';
import { decodeOrThrow, wireJson } from '../packages/decode/dist/src/index.js';
import type { JsonValue } from '../packages/decode/dist/src/index.js';
import type { VerifiedReadbackInput } from '../apps/sidecar/dist/src/graph-control-types.js';
import type { CallOptions, HostEntry, PluginClient, PluginOp } from '../packages/host-native/dist/src/index.js';
import { MCP_SERVER_VERSION } from '../packages/mcp-server/dist/src/index.js';
import { entry, makeLayer, makeProject, ok, startFakePlugin } from '../tools/fake-plugin/dist/src/index.js';
import type { FakePlugin, FixtureProject, WireObject } from '../tools/fake-plugin/dist/src/index.js';
import type { WatchReport } from '../tools/fake-plugin/dist/src/fixtures.js';
import { relationalHost } from './relational-native-host.ts';
import type { RelationalHost } from './relational-native-host.ts';

const TOKEN = 'relational-native-token';
const HOST_ENTRIES: readonly HostEntry[] = ['aeCollectIndexPage', 'aeCollectDetailPage', 'aeCollectValuePage', 'aeCollectBlurControl', 'aeCollectEffectCreation', 'aeApplyPlan', 'aeHostCensus'];

/** One plugin call the rig served: the entry, the arguments the lane sent and the answer it was given. */
export interface RigCall {
  readonly entry: HostEntry;
  readonly args: WireObject;
  readonly result: JsonValue;
}

/** One ticket the lane completed through the collection receiver. */
export interface RigCompletion {
  readonly ticket: JsonValue | undefined;
  readonly status: number;
  readonly body: JsonValue;
}

/** One receipt the apply runner handed to the receiver, and what the receiver answered. */
export interface RigReceipt {
  readonly receipt: JsonValue;
  readonly outcome: ReceiverOutcome;
  readonly answer: JsonValue;
}

/** The arguments of a tool call: JSON, where a field holding `undefined` is left out of the request. */
export interface ToolArguments {
  readonly [key: string]: JsonValue | undefined;
}

/** What a tool route answered: the HTTP status and the decoded body. */
export interface ToolReply {
  readonly status: number;
  readonly body: JsonValue;
}

/** Runs before the plugin answers a call; a test uses it to hold the call or to edit the project mid-call. */
export type BeforeNative = (entry: HostEntry, args: WireObject) => Promise<void>;

/** Changes the page a native entry answered before the lane sees it. */
export type RewriteNative = (entry: HostEntry, page: JsonValue) => JsonValue;

/** Decides what the receiver sees of a receipt: it gets the receipt and the function that delivers one. */
export type ReceiptHook = (receipt: JsonValue, send: (next: JsonValue) => Promise<ReceiverOutcome>) => Promise<ReceiverOutcome>;

/** How the rig is started. */
export interface RigOptions {
  readonly sidecar?: Partial<SidecarOptions>;
}

/** The running sidecar and fake plugin, the host they read, and everything the lane did against them. */
export interface Rig {
  readonly host: RelationalHost;
  readonly plugin: FakePlugin;
  readonly sidecar: ReadOnlySidecar;
  readonly directory: string;
  base: string;
  readonly calls: RigCall[];
  readonly completions: RigCompletion[];
  readonly leases: JsonValue[];
  readonly receipts: RigReceipt[];
  beforeNative: BeforeNative | undefined;
  rewrite: RewriteNative | undefined;
  receiptHook: ReceiptHook | undefined;
  callTimeoutMs: number | undefined;
  collectionReceivers: InProcessReceivers | undefined;
  tool(name: string, args: ToolArguments): Promise<ToolReply>;
  quiet(): Promise<void>;
  change(): void;
}

/** Waits until `done` holds, failing the test when it does not within `ms`. */
export async function until(done: () => boolean, ms = 4000): Promise<void> {
  const start = Date.now();
  while (!done()) {
    assert.ok(Date.now() - start <= ms, 'the sidecar and plugin did not reach the expected state in time');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

function pluginProject(host: RelationalHost): FixtureProject {
  const project = makeProject();
  const position = entry('ADBE Transform Group/ADBE Position', { matchName: 'ADBE Position', displayName: 'Position', valueType: 'vector', value: [0, 0] });
  const composition = project.compositions[0];
  if (composition === undefined) throw new Error('the fixture project has no composition');
  composition.id = host.comp.id;
  composition.layers = [makeLayer(host.title.id, 1, { name: 'Title', type: 'text', selected: true, propertyPaths: [position] })];
  project.project = { name: 'Untitled', filePath: null, dirty: false };
  project.activeCompositionId = host.comp.id;
  project.selectedLayerIds = [host.title.id];
  project.items = (project.items ?? []).map(item => item.id === '5' ? { ...item, id: host.comp.id, compositionId: host.comp.id } : item);
  return project;
}

function syncWatch(rig: Rig, emit = false): void {
  const { epoch, revision } = rig.host.stamp();
  const watch = rig.plugin.state.watch;
  if (watch.epoch === epoch && watch.revision === revision) return;
  const patch: Partial<WatchReport> = { epoch: epoch ?? watch.epoch, revision: revision ?? null };
  if (emit) rig.plugin.change(patch);
  else rig.plugin.state.watch = { ...watch, ...patch };
}

function hostEntry(rig: Rig, name: HostEntry): void {
  rig.plugin.hostCalls.set(name, async args => {
    await rig.beforeNative?.(name, args);
    const result = readJson(rig.host.call(name, args));
    syncWatch(rig);
    const shown = rig.rewrite ? rig.rewrite(name, result) : result;
    rig.calls.push({ entry: name, args, result: shown });
    return ok(JSON.stringify(shown));
  });
}

function isRunnerTable(registry: HostRunnerRegistry): registry is HostRunnerTable {
  return 'runners' in registry;
}

function laneRegistry(sidecar: ReadOnlySidecar): HostRunnerTable {
  const registry = sidecar.nativeHost?.lane.registry;
  if (registry === undefined || !isRunnerTable(registry)) throw new Error('the sidecar has no readable lane registry');
  return registry;
}

/** Wraps a lane runner so `build` can observe or alter what it hands to the sidecar's in-process receivers, and `wrapClient` what it calls the plugin with. */
export function interpose(
  rig: Rig,
  kind: HostWorkKind,
  build: (receivers: InProcessReceivers, context: HostLaneContext) => InProcessReceivers,
  wrapClient: (client: PluginClient) => PluginClient = client => client,
): void {
  const registry = laneRegistry(rig.sidecar);
  const original: HostRunner | undefined = registry.runners.get(kind);
  if (original === undefined) throw new Error(`no runner is registered for ${kind}`);
  registry.register(kind, (item, context) => original(item, { ...context, receivers: build(context.receivers, context), client: wrapClient(context.client) }));
}

function timedClient(rig: Rig, client: PluginClient): PluginClient {
  return {
    get endpoint() { return client.endpoint; },
    request: <R>(op: PluginOp, options?: CallOptions) => client.request<R>(op, options),
    batch: (ops, options) => client.batch(ops, options),
    hostCall: (name, args, options = {}) =>
      client.hostCall(name, args, rig.callTimeoutMs === undefined ? options : { timeoutMs: rig.callTimeoutMs, ...options }),
    pingDirect: timeoutMs => client.pingDirect(timeoutMs),
    close: () => { client.close(); },
  };
}

/** The body of a receiver answer as JSON. */
export function answerOf(outcome: ReceiverOutcome): JsonValue {
  return decodeOrThrow(wireJson, outcome.body);
}

function recordLease(rig: Rig, action: 'reserve' | 'settle', outcome: ReceiverOutcome): void {
  const lease = fieldOf(answerOf(outcome), 'lease');
  if (action === 'reserve' && lease) rig.leases.push(lease);
}

function observeCollection(rig: Rig): void {
  interpose(rig, 'collection_page', receivers => {
    rig.collectionReceivers = receivers;
    return {
      ...receivers,
      async collection(action, body) {
        const outcome = await receivers.collection(action, body);
        if (action === 'complete') rig.completions.push({ ticket: fieldOf(decodeOrThrow(wireJson, body), 'ticket'), status: outcome.status, body: answerOf(outcome) });
        return outcome;
      },
      async nativeBridge(action, body) {
        const outcome = await receivers.nativeBridge(action, body);
        recordLease(rig, action, outcome);
        return outcome;
      },
    };
  }, client => timedClient(rig, client));
}

function observeApply(rig: Rig): void {
  interpose(rig, 'apply_plan', receivers => ({
    ...receivers,
    async nativeBridge(action, body) {
      const outcome = await receivers.nativeBridge(action, body);
      recordLease(rig, action, outcome);
      return outcome;
    },
    async acceptReceipt(receipt, instanceId) {
      const send = (next: JsonValue): Promise<ReceiverOutcome> => receivers.acceptReceipt(next, instanceId);
      const proof = decodeOrThrow(wireJson, receipt);
      const outcome = rig.receiptHook ? await rig.receiptHook(proof, send) : await send(proof);
      rig.receipts.push({ receipt: proof, outcome, answer: answerOf(outcome) });
      return outcome;
    },
  }));
}

function toolCaller(rig: Rig): Rig['tool'] {
  const headers = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', 'X-AE-Client': 'agent', 'X-AE-Client-Version': MCP_SERVER_VERSION };
  return async (name, args) => {
    const response = await fetch(`${rig.base}/v1/mcp/tools/call`, { method: 'POST', headers, body: JSON.stringify({ name, arguments: { waitSeconds: 0, ...args } }) });
    return { status: response.status, body: readJson(await response.text()) };
  };
}

async function startedRig(t: TestContext, options: RigOptions): Promise<Rig> {
  const host = relationalHost();
  const directory = mkdtempSync(join(tmpdir(), 'extynt-relational-native-'));
  const stateDirectory = mkdtempSync(join(tmpdir(), 'extynt-relational-native-state-'));
  const plugin = await startFakePlugin({ stateDirectory: directory, project: pluginProject(host) });
  const sidecar = new ReadOnlySidecar({ port: 0, token: TOKEN, discoveryPath: plugin.discoveryPath, stateDirectory, quietAgentLog: true, ...options.sidecar });
  t.after(async () => {
    await sidecar.stop();
    await plugin.close();
    rmSync(directory, { recursive: true, force: true });
    rmSync(stateDirectory, { recursive: true, force: true });
  });
  const rig: Rig = {
    host, plugin, sidecar, directory: stateDirectory, base: '', calls: [], completions: [], leases: [], receipts: [],
    beforeNative: undefined, rewrite: undefined, receiptHook: undefined, callTimeoutMs: undefined, collectionReceivers: undefined,
    tool: (name, args) => toolCaller(rig)(name, args),
    quiet: async () => { await laneOf(sidecar).idle(); },
    change: () => { syncWatch(rig, true); },
  };
  return rig;
}

function laneOf(sidecar: ReadOnlySidecar): NonNullable<ReadOnlySidecar['nativeHost']>['lane'] {
  if (sidecar.nativeHost === undefined) throw new Error('the sidecar has no native host');
  return sidecar.nativeHost.lane;
}

/** Starts the sidecar and plugin and waits for the pair-time read and census; the pair snapshot stays, and a collection snapshot is set beside it. */
export async function startRig(t: TestContext, options: RigOptions = {}): Promise<Rig> {
  const rig = await startedRig(t, options);
  const { plugin, sidecar, host } = rig;
  plugin.state.watch = { ...plugin.state.watch, activeCompId: host.comp.id, activeCompName: 'Main', selection: [host.title.id], projectName: 'Untitled', projectPath: null, items: host.projectItems.length };
  syncWatch(rig);
  for (const name of HOST_ENTRIES) hostEntry(rig, name);
  const address = await sidecar.start();
  rig.base = `http://${address.host}:${address.port}`;
  await until(() => sidecar.hostLink.status().state === 'online');
  await until(() => sidecar.latest !== undefined && !sidecar.awaitingFreshSnapshotAfterPair);
  await until(() => rig.calls.some(call => call.entry === 'aeHostCensus'));
  await rig.quiet();
  observeCollection(rig);
  observeApply(rig);
  return rig;
}

/** Calls `before` with the arguments of every later call to `target[method]`, then runs the original. */
export function spy<Name extends string, Args extends readonly VerifiedReadbackInput[], Result>(
  target: Record<Name, (...args: Args) => Result>,
  method: Name,
  before: (...args: NoInfer<Args>) => void,
): void {
  const original = target[method];
  Reflect.set(target, method, (...args: Args): Result => { before(...args); return original.call(target, ...args); });
}
