// Default answers for the read ops, drawn from the fixture project and the mutable FakeState.
import { deriveHostIdentity } from "@extynt/host-native";
import type { PathTargetBody } from "./request.js";
import { ok, refuse } from "./replies.js";
import type { Reply } from "./replies.js";
import type { FixtureComposition } from "./fixtures.js";
import type { FakePlugin, FakeRequest } from "./types.js";
import { decodedValue, wireOfDocument } from "./wire.js";
import type { WireObject } from "./wire.js";

const MAX_TARGETS = 4096;

type DefaultOp = (plugin: FakePlugin, request: FakeRequest) => Reply;

const ZERO_HASH = "0".repeat(32);
const ONE_HASH = "1".repeat(32);

function hostReport(state: FakePlugin["state"]) {
  if (!state.reportHost) return {};
  const { source, ...wire } = deriveHostIdentity(state.aeVersion);
  const capabilities = { ...wire.capabilities, expressionText: "utf16", suitesComplete: true, streamSuite: 10, revisionGuard: state.revisionGuard };
  return { host: { ...wire, aegpApi: "1.9", capabilities } };
}

function pingReply(plugin: FakePlugin): Reply {
  const { state } = plugin;
  return ok({ pong: true, mainThread: true, pluginVersion: state.pluginVersion, aeVersion: state.aeVersion, pid: state.pid, ...hostReport(state), suites: {} });
}

function pingDirectReply(plugin: FakePlugin): Reply {
  const { state } = plugin;
  return ok({
    pong: true, mainThread: false, pluginVersion: state.pluginVersion, aeVersion: state.aeVersion, pid: state.pid, ...hostReport(state), arch: state.arch,
    idleAgeMs: state.idleAgeMs, idleTicks: state.idleTicks, queueDepth: state.queueDepth, oldestQueuedMs: state.oldestQueuedMs,
    watchers: plugin.watcherCount, waitingOnDialog: state.waitingOnDialog, library: { version: state.libraryVersion, entryFile: state.libraryVersion === null ? null : "probe.jsx" },
  }, { timing: { dispatchedBy: "socket" } });
}

function readProject(plugin: FakePlugin, request: FakeRequest): Reply {
  const { project } = plugin.state;
  return ok(request.body.hashes === true ? { ...project, itemsHash: ZERO_HASH, projectHash: ONE_HASH } : project);
}

function readComp(plugin: FakePlugin, request: FakeRequest): Reply {
  const { project } = plugin.state;
  const { compId } = request.body;
  if (compId === undefined) return refuse("BAD_REQUEST", "read_comp needs compId");
  const composition = project.compositions.find((candidate) => candidate.id === compId);
  return composition ? ok({ ...project, compositions: [composition] }) : refuse("COMP_NOT_FOUND", `No composition ${String(compId)}.`);
}

function readOne(compositions: FixtureComposition[], target: PathTargetBody): WireObject {
  const base = { compId: target.compId, layerId: target.layerId, path: target.path };
  const composition = compositions.find((candidate) => candidate.id === target.compId);
  if (!composition) return { ...base, found: false, error: "COMP_NOT_FOUND" };
  const layer = composition.layers.find((candidate) => candidate.id === target.layerId);
  if (!layer) return { ...base, found: false, error: "LAYER_NOT_FOUND" };
  const found = layer.propertyPaths.find((candidate) => candidate.path === target.path);
  return found ? { ...base, found: true, entry: found } : { ...base, found: false, error: "PATH_NOT_FOUND" };
}

function readPaths(plugin: FakePlugin, request: FakeRequest): Reply {
  const targets = request.body.targets ?? [];
  if (targets.length === 0 || targets.length > MAX_TARGETS) return refuse("BAD_REQUEST", `targets must be an array of 1 to ${MAX_TARGETS} objects`);
  const valid = targets.filter((target) => target !== null);
  if (valid.length !== targets.length) return refuse("BAD_REQUEST", "each target needs compId, layerId and a non-empty path");
  const results = valid.map((target) => readOne(plugin.state.project.compositions, target));
  return ok(decodedValue(wireOfDocument({ source: "native", results, warnings: [] })));
}

function hashProject(plugin: FakePlugin): Reply {
  return ok({ source: "native", algorithm: "xxh3-128", projectHash: ONE_HASH, itemsHash: ZERO_HASH, compositions: plugin.state.project.compositions.map((composition) => ({ id: composition.id })), warnings: [] });
}

function revision(plugin: FakePlugin): Reply {
  const { revisionGuard, watch } = plugin.state;
  if (revisionGuard === "off") return ok({ source: "native", revision: null, revisionUs: 0, floorUs: 0, revisionRaw: "", error: "revision guard is off for this After Effects version" });
  return ok({ source: "native", revision: watch.revision, revisionUs: 62, floorUs: 40, revisionRaw: String(watch.revision) });
}

function effectMenus(plugin: FakePlugin, request: FakeRequest): Reply {
  if (request.body.compId === undefined || request.body.layerId === undefined) return refuse("BAD_REQUEST", "effect_menus needs compId and layerId");
  return ok(decodedValue(wireOfDocument({ source: "native", effects: plugin.state.effectMenus ?? [] })));
}

const DEFAULT_OPS: ReadonlyMap<string, DefaultOp> = new Map<string, DefaultOp>([
  ["ping", pingReply],
  ["ping_direct", pingDirectReply],
  ["revision", revision],
  ["read_project", readProject],
  ["read_comp", readComp],
  ["read_paths", readPaths],
  ["hash_project", hashProject],
  ["watch_state", (plugin) => ok(plugin.state.watch)],
  ["effect_menus", effectMenus],
]);

/** The answer for an op nobody scripted. `host_call` and `batch` are handled by the dispatcher. */
export function defaultReply(plugin: FakePlugin, request: FakeRequest): Reply {
  const answer = DEFAULT_OPS.get(request.op);
  return answer ? answer(plugin, request) : refuse("UNKNOWN_OP", `Unknown op ${request.op}.`);
}
