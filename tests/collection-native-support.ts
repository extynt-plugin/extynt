// Support for the collection-native tests: the real collection host scripts over a simulated project, served as the fake plugin's
// collection host_call entries, and the agent's own tool calls that drive them through the host lane's runners.
import vm from 'node:vm';
import { decodeJson, decodeOrThrow, jsonObject, wireJson } from '../packages/decode/dist/src/index.js';
import { ok } from '../tools/fake-plugin/dist/src/index.js';
import type { FakePluginOptions, FakeRequest, WireObject } from '../tools/fake-plugin/dist/src/index.js';
import { runCollectionTool as collectionTool } from '../apps/sidecar/dist/src/collection-tools.js';
import type { CollectionToolDeps, CollectionToolLimits } from '../apps/sidecar/dist/src/collection-tools.js';
import type { Opaque } from '../apps/sidecar/dist/src/snapshot-view.js';
import type { ReceiverOutcome } from '../apps/sidecar/dist/src/receiver-types.js';
import { startHostRig } from '../apps/sidecar/dist/tests/host-rig.js';
import type { HostRig, RigOptions } from '../apps/sidecar/dist/tests/host-rig.js';
import { fieldOf, maybeTextOf, numberOf, recordOf, textOf } from '../apps/sidecar/dist/tests/http-json.js';
import type { JsonObject } from '../apps/sidecar/dist/tests/http-json.js';
import { hostTextFunction, loadHostFiles } from '../apps/panel/dist/tests/host-sources.js';

/** A request for a graph page: the target of a new job or the job to continue, with its page size and start. */
export type PageRequest = {
  readonly target?: { readonly kind: string };
  readonly jobId?: string;
  readonly limit?: number;
  readonly startCursor?: number;
};

/** The agent's collection tool, given the seconds to wait or those and an abort signal, answered as plain JSON. */
export async function runCollectionTool(
  deps: CollectionToolDeps, name: string, args: PageRequest | JsonObject, limits: number | CollectionToolLimits,
): Promise<JsonObject> {
  const outcome = await collectionTool(deps, name, args, typeof limits === 'number' ? { wait: limits } : limits);
  return decodeOrThrow(jsonObject, decodeOrThrow(wireJson, outcome));
}

/** One composition of the simulated project; reading its layers fails the test. */
export class SimulatedComposition {
  id: number;
  name: string;
  numLayers = 1000;
  parentFolder = { id: 0 };
  constructor(id: number) {
    this.id = id;
    this.name = `Comp ${id}`;
  }
  layer(): never { throw new Error('INDEX_MUST_NOT_READ_LAYERS'); }
}

/** The project object the host scripts read. */
export interface SimulatedProject {
  revision: number;
  numItems: number;
  item: (index: number) => SimulatedComposition | undefined;
  activeItem: null;
  file: null;
}

/** The application object of the simulated host. */
export interface SimulatedApp {
  project: SimulatedProject;
  version: string;
  buildNumber: number;
  effects: readonly string[];
}

/** The simulated project: its items, project and application objects, and a typed call into the host scripts. */
export interface SimulatedHost {
  readonly context: vm.Context;
  readonly items: SimulatedComposition[];
  readonly project: SimulatedProject;
  readonly app: SimulatedApp;
  newItem(id: number): SimulatedComposition;
  itemAt(index: number): SimulatedComposition;
  call(entry: string, request: JsonObject): JsonObject;
}

function requiredItem(items: readonly SimulatedComposition[], index: number): SimulatedComposition {
  const found = items[index];
  if (found === undefined) throw new Error(`the simulated project has no item at ${index}`);
  return found;
}

const HOST_NOW = Date.parse('2026-10-04T12:00:00.000Z');

class FrozenDate extends Date {
  override getTime(): number { return HOST_NOW; }
}

/** `size` compositions whose layers must never be read by an index page; the project reports a revision as After Effects does. */
export function simulatedHost(size = 300): SimulatedHost {
  class FolderItem {}
  const items = Array.from({ length: size }, (_, i) => new SimulatedComposition(i + 1));
  const project: SimulatedProject = { revision: 4, numItems: size, item: n => items[n - 1], activeItem: null, file: null };
  const app: SimulatedApp = { project, version: '26.2.1', buildNumber: 2, effects: [] };
  const context = vm.createContext({ app, CompItem: SimulatedComposition, FolderItem, Date: FrozenDate, $: { os: 'Mac' } });
  loadHostFiles(context, 'collection.jsx');
  const call = (entry: string, request: JsonObject): JsonObject => {
    const decoded = decodeJson(hostTextFunction(context, entry)(JSON.stringify(request)), jsonObject);
    if (!decoded.ok) throw new Error(`${entry} did not answer with a JSON object`);
    return decoded.value;
  };
  return { context, items, project, app, newItem: id => new SimulatedComposition(id), itemAt: index => requiredItem(items, index), call };
}

/** Code that runs before a plugin entry answers. */
export interface CollectionHooks {
  before?: (entry: string, args: WireObject) => Promise<void>;
}

/** The collection entries of the plugin, backed by the host scripts. `hooks.before(entry, args)` runs first and may be async. */
export function collectionEntries(host: SimulatedHost, hooks: CollectionHooks = {}): NonNullable<FakePluginOptions['hostCalls']> {
  const entry = (name: string) => async (args: WireObject) => {
    await hooks.before?.(name, args);
    return ok(hostTextFunction(host.context, name)(JSON.stringify(args)));
  };
  return { aeCollectIndexPage: entry('aeCollectIndexPage'), aeCollectDetailPage: entry('aeCollectDetailPage'), aeCollectValuePage: entry('aeCollectValuePage') };
}

/** Rig options plus the hooks that run before the collection entries answer. */
export interface CollectionRigOptions extends RigOptions {
  hooks?: CollectionHooks;
}

/** A host-lane rig whose plugin serves `host`'s collection scripts; `options.plugin.hostCalls` replaces entries. */
export async function collectionRig(host: SimulatedHost, options: CollectionRigOptions = {}): Promise<HostRig> {
  return startHostRig({ ...options, plugin: { ...options.plugin, hostCalls: { ...collectionEntries(host, options.hooks), ...options.plugin?.hostCalls } } });
}

export const sleep = (ms: number): Promise<void> => new Promise(resolve => { setTimeout(resolve, ms); });

const deps = (rig: HostRig): CollectionToolDeps => ({ state: rig.sidecar, transport: { notifyChange() {}, waitUntil: async () => false } });

/** The tool's own wait: polls the demand until it settles or `seconds` pass, as the HTTP transport does. */
export const waitingDeps = (rig: HostRig): CollectionToolDeps => ({
  state: rig.sidecar,
  transport: {
    notifyChange() {},
    async waitUntil(done, seconds) {
      for (const end = Date.now() + seconds * 1000; !done(); await sleep(5)) if (Date.now() > end) return false;
      return true;
    },
  },
});

/** The dispatch the sidecar queued for the lane. */
export interface Dispatch {
  readonly ticket: string;
  readonly generation: number;
}

/** A demand the sidecar accepted: the tool's answer, the dispatch it queued and the demand id. */
export interface StartedDemand {
  readonly result: JsonObject;
  readonly dispatch: Dispatch;
  readonly ticket: string;
}

/** Asks for a page and returns at once, whether the sidecar queued it or turned it away. */
export function askDemand(rig: HostRig, args: PageRequest): Promise<JsonObject> {
  return runCollectionTool(deps(rig), 'ae_read_graph_page', args, 0);
}

/** Asks for a page and returns at once: the demand id and the dispatch the sidecar queued for the lane. */
export async function startDemand(rig: HostRig, args: PageRequest): Promise<StartedDemand> {
  const result = await askDemand(rig, args);
  if (fieldOf(result, 'ok') !== true) throw new Error(`the demand was turned away: ${JSON.stringify(result)}`);
  const dispatch = recordOf(rig.sidecar.agentMailbox.at(-1), 'approvedData.dispatch');
  return { result, dispatch: { ticket: textOf(dispatch, 'ticket'), generation: numberOf(dispatch, 'generation') }, ticket: textOf(result, 'data.demandId') };
}

/** The agent's `ae_read_graph_page` without waiting, then the lane running what it queued, then `ae_get_graph_page` for the answer. */
export async function demandPage(rig: HostRig, args: PageRequest): Promise<JsonObject> {
  const pending = await askDemand(rig, args);
  if (fieldOf(pending, 'ok') !== true) return pending;
  await rig.drain();
  return runCollectionTool(deps(rig), 'ae_get_graph_page', { demandId: textOf(pending, 'data.demandId') }, 0);
}

/** The pages of a scan, and the first answer that did not observe one. */
export interface PageScan {
  readonly pages: JsonObject[];
  readonly failed: JsonObject | null;
}

/** Pages from `args` to the end of its job; stops at the first demand that did not observe a page. */
export async function scanPages(rig: HostRig, args: PageRequest): Promise<PageScan> {
  const pages: JsonObject[] = [];
  let next = args;
  for (;;) {
    const result = await demandPage(rig, next);
    if (fieldOf(result, 'ok') !== true || fieldOf(result, 'data.state') !== 'observed') return { pages, failed: result };
    pages.push(recordOf(result, 'data.page'));
    if (fieldOf(result, 'data.continuation') === null) return { pages, failed: null };
    next = { jobId: textOf(result, 'data.continuation.jobId'), ...(args.limit ? { limit: args.limit } : {}) };
  }
}

/** The error code of a demand that did not observe a page: the tool's own, or the one the demand failed with. */
export function codeOf(result: JsonObject): string | undefined {
  return fieldOf(result, 'ok') ? maybeTextOf(result, 'data.error.code') : maybeTextOf(result, 'error.code');
}

/** Where a retained row lives: the composition, layer and property indices it is scoped to. */
export interface RowScope {
  readonly compositionId?: string;
  readonly layerId?: string;
  readonly propertyIndices?: readonly number[];
}

/** The key the sidecar retains a row under. */
export const rowKey = (kind: string, id: string, scope: RowScope = {}): string =>
  JSON.stringify([kind, scope.compositionId ?? null, scope.layerId ?? null, scope.propertyIndices ?? null, id]);

export const hostCalls = (rig: HostRig): FakeRequest[] => rig.plugin.requestsFor('host_call');

/** A host entry that waits for the test: `entered` settles when the call arrives, `release()` lets it answer. */
export interface Gate {
  readonly entered: Promise<void>;
  release(): void;
  hook(): Promise<void>;
}

interface Pending {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

function pending(): Pending {
  let resolve = () => {};
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

/** A host entry that waits for the test: `entered` settles when the call arrives, `release()` lets it answer. */
export function gate(): Gate {
  const open = pending(), entered = pending();
  return { entered: entered.promise, release: open.resolve, hook: async () => { entered.resolve(); await open.promise; } };
}

/** The lane's client with every host call given `timeoutMs`; `timeoutMs.value` can change between calls. */
export function shortTimeouts(rig: HostRig, timeoutMs: number): { value: number } {
  const limit = { value: timeoutMs }, client = rig.client;
  rig.context.client = {
    endpoint: client.endpoint, close: () => client.close(), pingDirect: ms => client.pingDirect(ms),
    request: (op, options) => client.request(op, options), batch: (ops, options) => client.batch(ops, options),
    hostCall: (entry, args, options) => client.hostCall(entry, args, { timeoutMs: limit.value, ...options }),
  };
  return limit;
}

/** Code that runs ahead of or behind a collection receiver call. */
export interface ReceiverHooks {
  before?: (action: string, body: Opaque) => Promise<void>;
  after?: (action: string, body: Opaque) => Promise<void>;
}

/** Runs `before(action, body)` ahead of, and `after(action, body)` behind, every collection receiver call the lane makes. */
export function interceptCollection(rig: HostRig, hooks: ReceiverHooks): void {
  const real = rig.context.receivers;
  rig.context.receivers = {
    ...real,
    collection: async (action, body) => {
      await hooks.before?.(action, body);
      const outcome = await real.collection(action, body);
      await hooks.after?.(action, body);
      return outcome;
    },
  };
}

/** A new plugin connection pairs a new owner, as the link does. */
export function repair(rig: HostRig, instanceId: string): void {
  rig.sidecar.collection.pair(instanceId);
  rig.sidecar.activePanelInstanceId = instanceId;
}

/** The code a receiver refused with. */
export const refusalOf = (outcome: ReceiverOutcome): string | undefined => maybeTextOf(outcome.body, 'error.code');
