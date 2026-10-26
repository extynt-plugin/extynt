// The native reads behind one snapshot: a stamp, then the project or the named compositions, all hashed so the adapter can
// tell which layers changed. Reads never write and never wait: every call is one batch, one idle turn in After Effects.
import { decode } from "@extynt/decode";
import { parseWatchState } from "@extynt/host-native";
import type { BatchEntry, BatchItem, CallOutcome, PingDirectResult, PluginClient, WatchState, WireError } from "@extynt/host-native";
import type { NativeCompResult, NativeProjectResult, NativeReadScope } from "../native-snapshot/index.js";
import { nativeReadResult } from "./read-parse.js";

/** A failed host call as the lane reports it: a code the receipts and the UI already use, and a bounded message. */
export interface HostFailure { code: string; message: string; unknown: boolean }
type Fetched<T> = { ok: true; value: T } | { ok: false; failure: HostFailure };

export interface ReadParts { stamp: WatchState; project?: NativeProjectResult; comps: NativeCompResult[] }

const COMPS_PER_BATCH = 60;

type FailedCall = Exclude<CallOutcome<never>, { kind: "ok" }>;

export function failureOf(outcome: FailedCall): HostFailure {
  if (outcome.kind === "refused") return { code: outcome.error.code, message: outcome.error.message.slice(0, 256), unknown: false };
  const code = outcome.reason === "timeout" ? "HOST_TIMEOUT" : "HOST_CONNECTION_LOST";
  return { code, message: `After Effects did not answer (${outcome.reason}).`, unknown: outcome.sent };
}

const NOT_ANSWERED = { code: "INVALID_HOST_RESPONSE", message: "The plugin's answer was not in the expected shape.", unknown: false } as const;

function batchOps(scope: NativeReadScope): BatchEntry[][] {
  if (scope.kind === "full") return [[{ op: "watch_state", id: "stamp" }, { op: "read_project", detail: "full", hashes: true, id: "project" }]];
  const comps = scope.ids.map((compId): BatchEntry => ({ op: "read_comp", compId, detail: "full", hashes: true, id: `comp:${compId}` }));
  const batches: BatchEntry[][] = [];
  for (let at = 0; at < comps.length || batches.length === 0; at += COMPS_PER_BATCH) batches.push(comps.slice(at, at + COMPS_PER_BATCH));
  const head: BatchEntry[] = [{ op: "watch_state", id: "stamp" }, ...(scope.includeItems ? [{ op: "read_project" as const, detail: "structure" as const, id: "project" }] : [])];
  batches[0] = [...head, ...(batches[0] ?? [])];
  return batches;
}

const gone = (item: BatchItem): boolean => !item.ok && item.error?.code === "COMP_NOT_FOUND";

function itemFailure(error: WireError | undefined): HostFailure {
  return { code: error?.code ?? "HOST_ERROR", message: (error?.message ?? "A read failed.").slice(0, 256), unknown: false };
}

interface Collected { stamp: WatchState | null; project?: NativeProjectResult; comps: NativeCompResult[] }

function collect(items: readonly BatchItem[], into: Collected): HostFailure | null {
  for (const item of items) {
    if (gone(item)) continue;
    if (!item.ok) return itemFailure(item.error);
    if (item.op === "watch_state") { into.stamp = parseWatchState(item.result); if (!into.stamp) return NOT_ANSWERED; continue; }
    const read = decode(nativeReadResult, item.result);
    if (!read.ok) return NOT_ANSWERED;
    if (item.op === "read_project") into.project = read.value; else into.comps.push(read.value);
  }
  return null;
}

/** Reads what `scope` names. The first batch is also the stamp: it was taken in the same idle turn as the reads that follow it. */
export async function readNative(client: PluginClient, scope: NativeReadScope): Promise<Fetched<ReadParts>> {
  const collected: Collected = { stamp: null, comps: [] };
  for (const ops of batchOps(scope)) {
    const outcome = await client.batch(ops);
    if (outcome.kind !== "ok") return { ok: false, failure: failureOf(outcome) };
    const failure = collect(outcome.result.results, collected);
    if (failure) return { ok: false, failure };
  }
  if (!collected.stamp) return { ok: false, failure: NOT_ANSWERED };
  return { ok: true, value: { stamp: collected.stamp, comps: collected.comps, ...(collected.project ? { project: collected.project } : {}) } };
}

const pings = new WeakMap<PluginClient, PingDirectResult>();

/** The plugin's identity (AE version, architecture) never changes within a connection, so one `ping_direct` serves every read. */
export async function pingOf(client: PluginClient): Promise<Fetched<PingDirectResult>> {
  const known = pings.get(client);
  if (known) return { ok: true, value: known };
  const outcome = await client.pingDirect();
  if (outcome.kind !== "ok") return { ok: false, failure: failureOf(outcome) };
  pings.set(client, outcome.result);
  return { ok: true, value: outcome.result };
}
