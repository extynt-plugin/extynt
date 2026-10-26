// Op dispatch with the real plugin's semantics: handler overrides, host_call validation and the allowlist, and batch.
import { decodeJson } from "@extynt/decode";
import { HOST_ENTRIES, MAX_BATCH_OPS, isHostEntry } from "@extynt/host-native";
import type { BatchItem, HostEntry } from "@extynt/host-native";
import { defaultReply } from "./defaults.js";
import { ok, refuse, settle } from "./replies.js";
import type { Reply } from "./replies.js";
import type { RequestBody } from "./request.js";
import type { FakePlugin, FakeRequest } from "./types.js";
import { decodedValue, wireObject, wireOfDocument } from "./wire.js";
import type { WireObject, WireValue } from "./wire.js";

type WireBatchItem = Omit<BatchItem, "result"> & { result?: WireValue };
type Answered = Extract<Reply, { kind: "ok" | "error" }>;
type CompoundOp = (plugin: FakePlugin, request: FakeRequest) => Promise<Reply>;

const BATCH_OPS: ReadonlySet<string> = new Set(["ping", "revision", "read_project", "read_comp", "read_paths", "effect_menus", "hash_project", "host_call", "watch_state"]);

function mapOk(reply: Reply, change: (reply: Reply & { kind: "ok" }) => Reply): Reply {
  if (reply.kind === "late") return { kind: "late", delayMs: reply.delayMs, then: mapOk(reply.then, change) };
  return reply.kind === "ok" ? change(reply) : reply;
}

function parseArgs(text: string | undefined): WireObject | null {
  const decoded = text === undefined ? null : decodeJson(text, wireObject);
  return decoded?.ok ? decoded.value : null;
}

function hostCallResult(entry: HostEntry, reply: Reply & { kind: "ok" }, plugin: FakePlugin): Reply {
  const text = typeof reply.result === "string" ? reply.result : JSON.stringify(reply.result);
  const result = {
    source: "native", entry, result: text, scriptUs: 100, libraryLoaded: false, libraryLoadUs: 0,
    libraryVersion: plugin.state.libraryVersion ?? "fake+0", projectEpoch: plugin.state.watch.epoch, ...reply.hostMeta,
  };
  return ok(decodedValue(wireOfDocument(result)), { timing: reply.timing });
}

async function hostCall(plugin: FakePlugin, request: FakeRequest): Promise<Reply> {
  const { entry } = request.body;
  if (!isHostEntry(entry)) return refuse("ENTRY_NOT_ALLOWED", `entry ${String(entry)} is not allowed; allowed: ${HOST_ENTRIES.join(", ")}.`);
  const args = parseArgs(request.body.args);
  if (!args) return refuse("BAD_REQUEST", "args must be a string holding the JSON text of an object.");
  const handler = plugin.hostCalls.get(entry);
  const reply = handler ? await handler(args, request, plugin) : ok("{}");
  return mapOk(reply, (success) => hostCallResult(entry, success, plugin));
}

function entryRefusal(entry: RequestBody | null, index: number): Reply | null {
  if (entry?.op === undefined) return refuse("BAD_REQUEST", `ops[${index}] needs an op.`);
  return BATCH_OPS.has(entry.op) ? null : refuse("BAD_REQUEST", `ops[${index}]: ${entry.op} is not allowed inside a batch.`);
}

function validateBatch(request: FakeRequest): Reply | RequestBody[] {
  const { ops } = request.body;
  if (!ops || ops.length < 1 || ops.length > MAX_BATCH_OPS) return refuse("BAD_REQUEST", `ops must hold 1 to ${MAX_BATCH_OPS} entries.`);
  for (const [index, entry] of ops.entries()) {
    const refusal = entryRefusal(entry, index);
    if (refusal) return refusal;
  }
  return ops.filter((entry) => entry !== null);
}

function batchItem(entry: RequestBody, leaf: Answered): WireBatchItem {
  const base = { op: entry.op ?? "", ...(typeof entry.id === "string" ? { id: entry.id } : {}), mainThreadMs: 0, getterCalls: 0 };
  return leaf.kind === "ok" ? { ...base, ok: true, result: leaf.result } : { ...base, ok: false, error: leaf.error };
}

function subRequest(request: FakeRequest, entry: RequestBody): FakeRequest {
  return { id: typeof entry.id === "string" ? entry.id : "", op: entry.op ?? "", connection: request.connection, body: entry };
}

async function batch(plugin: FakePlugin, request: FakeRequest): Promise<Reply> {
  const entries = validateBatch(request);
  if (!Array.isArray(entries)) return entries;
  const results: WireBatchItem[] = [];
  let failed = 0;
  for (const entry of entries) {
    const leaf = await settle(await dispatchOp(plugin, subRequest(request, entry)));
    if (leaf.kind !== "ok" && leaf.kind !== "error") return leaf;
    results.push(batchItem(entry, leaf));
    if (leaf.kind === "error") failed += 1;
    if (leaf.kind === "error" && request.body.stopOnError === true) break;
  }
  return ok(decodedValue(wireOfDocument({ source: "native", results, ran: results.length, failed, requested: entries.length, totalMainThreadMs: 0 })));
}

const COMPOUND_OPS: ReadonlyMap<string, CompoundOp> = new Map<string, CompoundOp>([["host_call", hostCall], ["batch", batch]]);

/** Resolves one request to a reply: a scripted handler first, then the built-in behaviour for the op. */
export async function dispatchOp(plugin: FakePlugin, request: FakeRequest): Promise<Reply> {
  try {
    const handler = plugin.handlers.get(request.op);
    if (handler) return await handler(request, plugin);
    const compound = COMPOUND_OPS.get(request.op);
    return compound ? await compound(plugin, request) : defaultReply(plugin, request);
  } catch (error) {
    return refuse("INTERNAL", `fake handler threw: ${error instanceof Error ? error.message : String(error)}`);
  }
}
