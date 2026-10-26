// The reads that ride in one batch with an apply or an undo: the ops to send for a read the sidecar named, and the parse of
// what came back into the native read set the snapshot adapter takes.
import { decode, object, string } from "@extynt/decode";
import { MAX_BATCH_OPS, parseWatchState } from "@extynt/host-native";
import type { BatchEntry, BatchItem, BatchResult, CallOutcome, PingDirectResult, WatchState } from "@extynt/host-native";
import { DETAILS_MAX_LAYERS, DETAIL_KINDS, parsePropertyDetails } from "../native-snapshot/index.js";
import type { DetailScope, NativeCompResult, NativeProjectResult, NativeReadScope, NativeReadSet, PropertyDetailsRequest } from "../native-snapshot/index.js";
import type { ReadScope } from "../read-queue.js";
import type { HostSnapshot } from "../verify/host-types.js";
import { hostBatch } from "./call.js";
import type { BatchLane } from "./call.js";
import { nativeReadResult } from "./read-parse.js";

export const STAMP_BEFORE_ID = "stamp-before";
export const STAMP_ID = "stamp";
const PROJECT_ID = "project";
const DETAILS_ID = "details";
export const COMP_ID_PREFIX = "comp:";

const detailsAnswer = object({ result: string() });

/** The adapter's read scope for a scope the sidecar named. */
export function nativeScopeOf(read: ReadScope): NativeReadScope {
  return read.scope === "full" ? { kind: "full" } : { kind: "compositions", ids: [...read.compositionIds], includeItems: read.includeItems };
}

/** The read ops for a scope: the whole project, or each named composition (and the item list when asked), full detail and hashes. */
export function readOpsFor(read: ReadScope): BatchEntry[] {
  if (read.scope === "full") return [{ op: "read_project", id: PROJECT_ID, detail: "full", hashes: true }];
  const comps: BatchEntry[] = read.compositionIds.map((compId) => ({ op: "read_comp", id: `${COMP_ID_PREFIX}${compId}`, compId, detail: "full", hashes: true }));
  return read.includeItems ? [...comps, { op: "read_project", id: PROJECT_ID, detail: "structure" }] : comps;
}

/**
 * The batches an apply or an undo sends: `head` (the stamp guard and the write) leads the first, then `reads` and `tail` (the details call) in
 * order, split so no batch exceeds the plugin's cap. The answers come back in that order, so the reads still follow the write.
 */
export function packBatches(head: readonly BatchEntry[], reads: readonly BatchEntry[], tail: readonly BatchEntry[] = []): BatchEntry[][] {
  const rest = [...reads, ...tail];
  const batches: BatchEntry[][] = [];
  let at = 0, room = MAX_BATCH_OPS - head.length;
  do {
    batches.push(rest.slice(at, at + room));
    at += room;
    room = MAX_BATCH_OPS;
  } while (at < rest.length);
  batches[0] = [...head, ...(batches[0] ?? [])];
  return batches;
}

/**
 * Sends the batches in order and merges their answers. The first batch's outcome is the one that matters: when it failed, nothing after it was
 * sent. A later batch that fails leaves its ops unanswered, which the read parse reports as a failed read.
 */
export async function hostBatches(ctx: BatchLane, batches: readonly BatchEntry[][]): Promise<CallOutcome<BatchResult>> {
  const first = await hostBatch(ctx, batches[0] ?? []);
  if (first.kind !== "ok") return first;
  const merged: BatchResult = { ...first.result, results: [...first.result.results] };
  for (const ops of batches.slice(1)) {
    const next = await hostBatch(ctx, ops);
    if (next.kind !== "ok") break;
    merged.results.push(...next.result.results);
    merged.ran += next.result.ran;
    merged.failed += next.result.failed;
    merged.requested += next.result.requested;
    merged.totalMainThreadMs += next.result.totalMainThreadMs;
  }
  return { ...first, result: merged };
}

export function stampOp(id: string = STAMP_ID): BatchEntry {
  return { op: "watch_state", id };
}

/** A layer, by composition and layer id. */
export interface LayerRef { compId: string; layerId: string }

/** The ids the jsx details call accepts (one malformed id refuses the whole call): After Effects ids are digit strings, a placeholder for a layer the plan creates is not one. */
export const HOST_ID = /^[0-9]{1,15}$/;
const MAX_SCOPES = 256;

function scopesOf(touched: readonly LayerRef[]): DetailScope[] {
  const byComposition = new Map<string, string[]>();
  for (const { compId, layerId } of touched) {
    if (!HOST_ID.test(compId) || !HOST_ID.test(layerId)) continue;
    const held = byComposition.get(compId) ?? [];
    if (!held.includes(layerId)) byComposition.set(compId, [...held, layerId]);
  }
  const scopes: DetailScope[] = [];
  let budget = DETAILS_MAX_LAYERS;
  for (const [compId, layerIds] of [...byComposition].slice(0, MAX_SCOPES)) {
    if (budget <= 0) break;
    scopes.push({ compId, layerIds: layerIds.slice(0, budget) });
    budget -= Math.min(layerIds.length, budget);
  }
  return scopes;
}

/**
 * The details call that rides in the batch of a write: every kind a normal read fetches (`DETAIL_KINDS`, so the rows are those a normal read
 * builds), for the layers the write touches only. Layers the write did not touch keep the details the sidecar holds, and one that moved anyway is
 * fetched afterwards (`foldRead`). Null when no touched layer can be named.
 */
export function detailsRequestFor(touched: readonly LayerRef[], markerCompositions: readonly string[] = []): PropertyDetailsRequest | null {
  const scopes = scopesOf(touched), markers = markerCompositions.filter((id) => HOST_ID.test(id)).slice(0, MAX_SCOPES);
  if (scopes.length === 0 && markers.length === 0) return null;
  return { scopes, include: [...DETAIL_KINDS], maxLayers: DETAILS_MAX_LAYERS, ...(markers.length ? { markerCompositions: markers } : {}) };
}

export function detailsOp(request: PropertyDetailsRequest): BatchEntry {
  return { op: "host_call", id: DETAILS_ID, entry: "aeReadPropertyDetails", args: JSON.stringify(request) };
}

interface ReadFailure { code: string; message: string }
export type ReadSetResult = { ok: true; set: NativeReadSet } | { ok: false; failure: ReadFailure };

function itemOf(batch: BatchResult, id: string): BatchItem | undefined {
  return batch.results.find((item) => item.id === id);
}

export function stampOf(batch: BatchResult, id: string): WatchState | null {
  const item = itemOf(batch, id);
  return item?.ok ? parseWatchState(item.result) : null;
}

function failureOf(item: BatchItem | undefined, what: string): ReadFailure {
  if (!item) return { code: "HOST_READ_FAILED", message: `${what} was not answered.` };
  return { code: item.error?.code ?? "HOST_READ_FAILED", message: item.error?.message ?? `${what} failed.` };
}

function readResult(item: BatchItem | undefined, what: string): Parts<NativeProjectResult> {
  const decoded = item?.ok ? decode(nativeReadResult, item.result) : undefined;
  return decoded?.ok ? { value: decoded.value } : { failure: failureOf(item, what) };
}

function detailsText(batch: BatchResult): string | undefined {
  const item = itemOf(batch, DETAILS_ID);
  const answer = item?.ok ? decode(detailsAnswer, item.result) : undefined;
  return answer?.ok ? answer.value.result : undefined;
}

interface ReadSetInput {
  batch: BatchResult;
  read: ReadScope;
  requestId: string;
  ping: PingDirectResult;
}

type Parts<T> = { value: T } | { failure: ReadFailure };

function compsOf(batch: BatchResult, read: ReadScope): Parts<NativeCompResult[]> {
  const comps: NativeCompResult[] = [];
  for (const compId of read.scope === "full" ? [] : read.compositionIds) {
    const result = readResult(itemOf(batch, `${COMP_ID_PREFIX}${compId}`), `The read of composition ${compId}`);
    if ("failure" in result) return result;
    comps.push(result.value);
  }
  return { value: comps };
}

function projectOf(batch: BatchResult, read: ReadScope): Parts<NativeProjectResult | undefined> {
  if (read.scope !== "full" && !read.includeItems) return { value: undefined };
  return readResult(itemOf(batch, PROJECT_ID), "The project read");
}

/** The read set one batch produced. A failed composition or project read fails the set; a failed details call only costs the set its details. */
export function readSetOf(input: ReadSetInput): ReadSetResult {
  const { batch, read, requestId, ping } = input;
  const stamp = stampOf(batch, STAMP_ID);
  if (!stamp) return { ok: false, failure: failureOf(itemOf(batch, STAMP_ID), "The project stamp") };
  const comps = compsOf(batch, read), project = projectOf(batch, read);
  if ("failure" in comps) return { ok: false, failure: comps.failure };
  if ("failure" in project) return { ok: false, failure: project.failure };
  const text = detailsText(batch);
  const details = text === undefined ? undefined : parsePropertyDetails(text);
  const before = stampOf(batch, STAMP_BEFORE_ID);
  return { ok: true, set: { ...(before ? { stampBefore: before } : {}), stamp, ...(project.value ? { project: project.value } : {}), comps: comps.value, ...(details ? { details } : {}), ping, requestId, scope: nativeScopeOf(read) } };
}

/** The probe-shaped answer a failed read stands for, in the form the verify code and the precheck explanation take. */
export function failedSnapshot(failure: ReadFailure, requestId: string): HostSnapshot {
  return { ok: false, requestId, error: { code: failure.code, message: failure.message } };
}
