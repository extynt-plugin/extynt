/**
 * The native host lane under test: a real sidecar talking to tools/fake-plugin over its real protocol. The project the plugin
 * serves is the one `mutableSnapshot` describes, so a plan proposed against what the adapter read applies, verifies and undoes end to end.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MCP_SERVER_VERSION, jsonFieldsOf } from "@extynt/mcp-server";
import { entry, makeLayer, makeProject, ok, startFakePlugin } from "@extynt/fake-plugin";
import type { FakePlugin, FakePluginOptions, FakeRequest, FixtureLayer, FixtureProject, HostCallHandler } from "@extynt/fake-plugin";
import { ReadOnlySidecar } from "../src/server.js";
import { isJsonArray, isJsonObject, type JsonValue } from "@extynt/decode";
import { fieldOf, parseJson, readJson, textOf, type JsonArray, type JsonObject } from "./http-json.js";
import { authorization, token, toolResult, withVerificationAck, type ToolCallEnvelope } from "./sidecar-fixture.js";
import { present } from "./present.js";

export const COMP = "229";
export const LAYER = "351";
/** The ids of the layers `nativeProject(extra)` adds after the first. */
export const OTHER_LAYERS: readonly string[] = ["352", "353", "354"];

type Row = JsonObject;
const isRow = (value: JsonValue | undefined): value is Row => isJsonObject(value);

const MARKER = "ADBE Marker";
const KEYED = "ADBE Transform Group/ADBE Opacity";

function contentHash(layer: Row): string {
  return createHash("sha1").update(JSON.stringify(Object.fromEntries(Object.keys(layer).filter((key) => key !== "hash").map((key) => [key, layer[key]])))).digest("hex").slice(0, 16);
}

function hashed(layer: FixtureLayer): FixtureLayer {
  Object.defineProperty(layer, "hash", { enumerable: true, configurable: true, get: () => contentHash(layer) });
  return layer;
}

function richProperties(): FixtureLayer["propertyPaths"] {
  const keyed = { ...entry(KEYED, { matchName: "ADBE Opacity", displayName: "Opacity", value: 100 }), keyframeCount: 2 };
  return [
    entry(`ADBE Effect Parade/ADBE Gaussian Blur 2/ADBE Gaussian Blur 2-0001`, { matchName: "ADBE Gaussian Blur 2-0001", displayName: "Blurriness", value: 4 }),
    entry("ADBE Transform Group/ADBE Position", { matchName: "ADBE Position", displayName: "Position", valueType: "vector", value: [960, 540] }),
    keyed,
    entry(MARKER, { matchName: MARKER, displayName: "Marker", valueType: "marker", value: { unsupported: "marker" } }),
  ];
}

/** The project of `mutableSnapshot`, in the shape the plugin reads: one composition, one text layer "Original" and `extra` more layers; every layer holds a marker property and a keyframed one. */
export function nativeProject(extra = 0): FixtureProject {
  const project = makeProject();
  const composition = present(project.compositions[0]);
  const first = makeLayer(LAYER, 1, { name: "Original", type: "text", selected: true, propertyPaths: richProperties() });
  const others = OTHER_LAYERS.slice(0, extra).map((id, at) => makeLayer(id, at + 2, { name: `Other ${id}`, propertyPaths: richProperties() }));
  composition.id = COMP;
  composition.layers = [first, ...others].map(hashed);
  project.activeCompositionId = COMP;
  project.selectedLayerIds = [LAYER];
  project.items = (project.items ?? []).map((item) => (item.id === "5" ? { ...item, id: COMP, compositionId: COMP } : item));
  return project;
}

function detailsAnswer(plugin: FakePlugin): HostCallHandler {
  return (args) => {
    const scopes = isJsonArray(args.scopes) ? args.scopes.filter(isRow) : [];
    const include = isJsonArray(args.include) ? args.include : [];
    const layers = scopes.flatMap((scope) => {
      const composition = plugin.state.project.compositions.find((candidate) => candidate.id === scope.compId);
      const wanted = isJsonArray(scope.layerIds) ? scope.layerIds : undefined;
      return (composition?.layers ?? []).filter((layer) => !wanted || wanted.includes(layer.id)).map((layer) => ({ compId: String(scope.compId), layerId: layer.id, properties: detailRows(layer, include) }));
    });
    return ok(JSON.stringify({ ok: true, layers }));
  };
}

function detailRows(layer: FixtureLayer, include: JsonArray): Row[] {
  return layer.propertyPaths.flatMap((property): Row[] => {
    if (property.matchName === MARKER) return include.includes("marker") ? [{ path: property.path, value: [] }] : [];
    const count = include.includes("keyDigest") && isRow(property) && typeof property.keyframeCount === "number" ? property.keyframeCount : 0;
    return count > 0 ? [{ path: property.path, keyframeCount: count, keyDigest: `kd-${layer.id}-${property.path}-${count}` }] : [];
  });
}

/** The apply a successful plugin answers: renames the layer in the project it serves and moves its revision, as After Effects would. */
export function renameApply(plugin: FakePlugin, extra: Row = {}): HostCallHandler {
  return (args) => {
    const operations = Array.isArray(args.operations) ? args.operations : [];
    const first = operations.find(isRow);
    const layer = plugin.state.project.compositions[0]?.layers[0];
    if (layer && first && typeof first.name === "string") layer.name = first.name;
    plugin.state.watch = { ...plugin.state.watch, revision: (plugin.state.watch.revision ?? 0) + 1 };
    return ok(JSON.stringify({ ok: true, steps: [{ operation: "set_layer_name", compositionId: COMP, layerId: LAYER }], undoGroups: 1, batchSize: 8, ...extra }));
  };
}

/** The undo a plugin answers: puts the layer name back and moves the revision, as Edit > Undo would. */
export function renameUndo(plugin: FakePlugin, name = "Original"): HostCallHandler {
  return () => {
    const layer = plugin.state.project.compositions[0]?.layers[0];
    if (layer) layer.name = name;
    plugin.state.watch = { ...plugin.state.watch, revision: (plugin.state.watch.revision ?? 0) + 1 };
    return ok(JSON.stringify({ ok: true, method: "edit-undo", times: 1 }));
  };
}

export interface NativeRig {
  sidecar: ReadOnlySidecar;
  logged: Array<{ event: string; fields: Row }>;
  plugin: FakePlugin;
  base: string;
  agent(name: string, args?: JsonObject): Promise<{ status: number; body: ToolCallEnvelope }>;
  ui(name: string, args?: JsonObject): Promise<{ status: number; body: ToolCallEnvelope }>;
  setLive(): void;
  refresh(): Promise<void>;
  batches(): string[][];
  entries(): string[];
  hostCallArgs(entry: string): Row | undefined;
  writes(): string[];
  proposeRename(name?: string): Promise<string>;
  waitFor(done: () => boolean, ms?: number): Promise<void>;
}

export interface RigOptions { plugin?: Partial<FakePluginOptions>; sidecar?: Partial<ConstructorParameters<typeof ReadOnlySidecar>[0]>; skipRefresh?: boolean; noLinkWait?: boolean }


function opNames(request: FakeRequest): string[] {
  const ops = Array.isArray(request.body.ops) ? request.body.ops.filter(isRow) : [];
  return ops.map((op) => (op.op === "host_call" ? `host_call:${String(op.entry)}` : String(op.op)));
}

export async function until(done: () => boolean, ms = 4000): Promise<void> {
  const start = Date.now();
  while (!done()) {
    if (Date.now() - start > ms) throw new Error("condition not reached in time");
    await new Promise((resolve) => { setTimeout(resolve, 5); });
  }
}

interface NativeParts { plugin: FakePlugin; sidecar: ReadOnlySidecar; logged: NativeRig["logged"]; base: string }

async function nativeParts(t: { after(fn: () => void | Promise<void>): void }, options: RigOptions): Promise<NativeParts> {
  const directory = mkdtempSync(join(tmpdir(), "extynt-native-rig-"));
  const plugin = await startFakePlugin({ stateDirectory: directory, project: nativeProject(), ...options.plugin });
  plugin.state.watch = { ...plugin.state.watch, activeCompId: COMP, activeCompName: "Main", selection: [LAYER], selectedLayers: [{ id: LAYER, index: 1, name: "Original" }] };
  plugin.hostCalls.set("aeReadPropertyDetails", detailsAnswer(plugin));
  plugin.hostCalls.set("aeApplyPlan", renameApply(plugin));
  plugin.hostCalls.set("aeUndoPlan", renameUndo(plugin));
  const stateDirectory = mkdtempSync(join(tmpdir(), "extynt-native-state-"));
  const sidecar = new ReadOnlySidecar({ port: 0, token, discoveryPath: plugin.discoveryPath, stateDirectory, quietAgentLog: true, ...options.sidecar });
  const logged: NativeRig["logged"] = [];
  const baseLog = sidecar.eventLog;
  sidecar.eventLog = (event, fields) => { logged.push({ event, fields: jsonFieldsOf(fields) }); baseLog(event, fields); };
  const address = await sidecar.start();
  t.after(async () => { await sidecar.stop(); await plugin.close(); rmSync(directory, { recursive: true, force: true }); rmSync(stateDirectory, { recursive: true, force: true }); });
  return { plugin, sidecar, logged, base: `http://${address.host}:${address.port}` };
}

function hostCallArgsOf(plugin: FakePlugin, entry: string): Row | undefined {
  for (const request of plugin.requestsFor("batch")) {
    const ops = Array.isArray(request.body.ops) ? request.body.ops.filter(isRow) : [];
    const op = ops.find((candidate) => candidate.entry === entry);
    if (op && typeof op.args === "string") {
      const parsed = parseJson(op.args);
      return isRow(parsed) ? parsed : undefined;
    }
  }
  return undefined;
}

export async function nativeRig(t: { after(fn: () => void | Promise<void>): void }, options: RigOptions = {}): Promise<NativeRig> {
  const { plugin, sidecar, logged, base } = await nativeParts(t, options);
  const call = async (name: string, args: JsonObject, headers: Record<string, string>) => {
    const response = await fetch(`${base}/v1/mcp/tools/call`, { method: "POST", headers: { ...authorization, "content-type": "application/json", ...headers }, body: JSON.stringify({ name, arguments: args }) });
    return { status: response.status, body: toolResult(await readJson(response)) };
  };
  const rig: NativeRig = {
    sidecar, logged, plugin, base,
    agent: (name, args = {}) => call(name, { waitSeconds: 0, ...withVerificationAck(name, args) }, { "X-AE-Client": "agent", "X-AE-Client-Version": MCP_SERVER_VERSION }),
    ui: (name, args = {}) => call(name, args, { "X-AE-Client": "panel" }),
    setLive: () => {
      const { epoch, revision, items } = plugin.state.watch;
      if (revision !== null) sidecar.liveStamp = { epoch, revision, items, at: sidecar.now().getTime() };
    },
    refresh: async () => {
      sidecar.nativeHost?.lane.wake();
      await until(() => sidecar.latest !== undefined && !sidecar.awaitingFreshSnapshotAfterPair);
    },
    batches: () => plugin.requestsFor("batch").map(opNames),
    entries: () => plugin.requestsFor("batch").flatMap(opNames).filter((op) => op.startsWith("host_call:")).map((op) => op.slice(10)),
    hostCallArgs: (entry) => hostCallArgsOf(plugin, entry),
    writes: () => rig.entries().filter((entry) => entry === "aeApplyPlan" || entry === "aeUndoPlan"),
    proposeRename: async (name = "Renamed") => {
      const proposed = await rig.agent("ae_propose_plan", { summary: `Rename to ${name}`, operations: [{ type: "set_layer_name", target: { compositionId: COMP, layerId: LAYER }, name }] });
      return textOf(proposed.body, "data.planId");
    },
    waitFor: until,
  };
  if (!options.noLinkWait) await until(() => sidecar.hostLink.status().state === "online");
  if (!options.skipRefresh && !options.noLinkWait) await rig.refresh();
  return rig;
}

export { fieldOf, readJson, textOf };
