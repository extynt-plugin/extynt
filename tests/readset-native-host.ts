// Shared by the native read-set suites: the real host jsx library over a vm-simulated project, answering the fake plugin's host_call entries.
import vm from 'node:vm';
import type { HostEntry } from '../packages/host-native/dist/src/index.js';
import { makeLayer, makeProject, ok } from '../tools/fake-plugin/dist/src/index.js';
import type { FakePlugin, FakeState, FixtureProject, WireObject, WireValue } from '../tools/fake-plugin/dist/src/index.js';
import { isWireArray, isWireObject } from '../tools/fake-plugin/dist/src/index.js';
import { hostTextFunction, loadHostFiles } from '../apps/panel/dist/tests/host-sources.js';
import { decodeOrThrow, jsonObject } from '../packages/decode/dist/src/index.js';
import type { JsonObject } from '../packages/decode/dist/src/index.js';
import { parseJson } from '../apps/sidecar/dist/tests/http-json.js';

export const COLLECTION_ENTRIES: readonly HostEntry[] = ['aeCollectIndexPage', 'aeCollectDetailPage', 'aeCollectValuePage', 'aeCollectBlurControl', 'aeCollectEffectCreation'];

/** The plugin's epoch and the project revision a scoped read is stamped with. */
export type Stamp = { epoch: number; revision: number };

/** The members of the plugin's watch that a world overrides. */
export type WatchOverlay = Partial<FakeState['watch']>;

/** What every simulated project exposes to the harness: the revision After Effects would show for it. */
export interface SimulatedProject {
  revision: number;
}

/** The global scope of the host library: the simulated After Effects `app` and the epoch the plugin injects before each entry. */
export interface HostScope {
  readonly app: { readonly project: SimulatedProject };
  __extyntProjectEpoch?: number;
}

/** One host entry call as the world received it: the entry, the arguments it ran with and the JSON text it answered. */
export interface HostCall {
  readonly entry: HostEntry;
  readonly args: WireObject;
  readonly text: string;
}

/** Changes what the host receives for an entry, as a command altered after the sidecar sent it. */
export type Rewrite = (entry: HostEntry, args: WireObject) => WireObject;

/** A simulated project behind the plugin: its host scope, the watch it shows, and the log of host calls it answered. */
export interface HostWorld {
  readonly context: HostScope;
  readonly project: SimulatedProject;
  readonly watch: () => WatchOverlay;
  readonly fixture?: () => FixtureProject;
  log: HostCall[];
  rewrite?: Rewrite;
}

/** The identifiers of the single composition and layer a world mirrors into the plugin's project. */
export interface MirrorIds {
  readonly compId: string;
  readonly layerId: string;
  readonly layerName: string;
}

/** A vm global scope holding the host library: `globals` are the After Effects objects the fixture simulates. */
export function hostContext<Globals extends HostScope>(globals: Globals): Globals {
  const scope = { JSON, Array, FolderItem: class {}, PropertyValueType: { OneD: 1 }, PropertyType: { PROPERTY: 1 }, $: { os: 'Macintosh OS' }, ...globals };
  vm.createContext(scope);
  loadHostFiles(scope, 'collection.jsx');
  loadHostFiles(scope, 'probe.jsx');
  return scope;
}

/** Runs one host entry as the plugin does: the epoch the plugin reports is injected first, the answer is the entry's own JSON text. */
export function runEntry(world: HostWorld, plugin: FakePlugin, entry: HostEntry, args: WireObject): string {
  world.context.__extyntProjectEpoch = plugin.state.watch.epoch;
  const sent = world.rewrite ? world.rewrite(entry, args) : args;
  const text = hostTextFunction(world.context, entry)(JSON.stringify(sent));
  world.log.push({ entry, args: sent, text });
  plugin.state.watch = { ...plugin.state.watch, revision: world.context.app.project.revision };
  return text;
}

/**
 * Makes the plugin answer `entries` from the world's host library; `world.log` records every call and its answer. `world.rewrite(entry, args)`,
 * when set, changes what the host receives (a command altered after the sidecar sent it).
 */
export function bindWorld(plugin: FakePlugin, world: HostWorld, entries: readonly HostEntry[]): void {
  world.log = [];
  for (const entry of entries) plugin.hostCalls.set(entry, (args) => ok(runEntry(world, plugin, entry, args)));
}

export const callsTo = (world: HostWorld, entry: HostEntry): HostCall[] => world.log.filter((call) => call.entry === entry);

function lastCall(world: HostWorld, entry: HostEntry): HostCall {
  const call = callsTo(world, entry).at(-1);
  if (call === undefined) throw new Error(`no host call to ${entry}`);
  return call;
}

export const lastAnswer = (world: HostWorld, entry: HostEntry): JsonObject => decodeOrThrow(jsonObject, parseJson(lastCall(world, entry).text));

/** The targeted readback the host attached to its last apply answer. */
export const lastReadback = (world: HostWorld): JsonObject => decodeOrThrow(jsonObject, lastAnswer(world, 'aeApplyPlan').metadataReadback);

/** The command the sidecar sent for the plugin's apply, as the host received it. */
export const sentCommand = (world: HostWorld): WireObject => lastCall(world, 'aeApplyPlan').args;

/** Calls the host's apply entry directly, as a second delivery of an already applied command would. */
export const applyAgain = (world: HostWorld, plugin: FakePlugin, command: WireObject): JsonObject => decodeOrThrow(jsonObject, parseJson(runEntry(world, plugin, 'aeApplyPlan', command)));

/** `args` with every operation replaced by `change(operation)`, the way a command is altered after its approval. */
export function rewriteOperations(args: WireObject, change: (operation: WireObject) => WireObject): WireObject {
  const operations = args.operations;
  if (!isWireArray(operations)) return args;
  const changed: WireValue[] = operations.map((operation) => (isWireObject(operation) ? change(operation) : operation));
  return { ...args, operations: changed };
}

/** The project the plugin serves: one composition and layer under the ids the world uses, so a read of what the world shows finds it. */
export function mirrorProject({ compId, layerId, layerName }: MirrorIds): FixtureProject {
  const project = makeProject(), composition = project.compositions[0];
  if (composition === undefined) throw new Error('the default fixture project has no composition');
  composition.id = compId;
  composition.layers = [makeLayer(layerId, 1, { name: layerName })];
  project.activeCompositionId = compId;
  project.items = (project.items ?? []).map((item) => (item.id === '5' ? { ...item, id: compId, compositionId: compId } : item));
  return project;
}
