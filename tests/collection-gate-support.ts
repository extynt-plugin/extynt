/** Shared builders and transcript helpers for the collection gate tests. */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeOrThrow, isJsonArray, isJsonObject, jsonObject, number, object, string, wireJson } from '../packages/decode/dist/src/index.js';
import type { Infer, JsonObject, JsonValue } from '../packages/decode/dist/src/index.js';
import { CollectionService } from '../apps/sidecar/dist/src/collection-service.js';
import { GraphStore } from '../apps/sidecar/dist/src/graph-store.js';
import { runCollectionTool } from '../apps/sidecar/dist/src/collection-tools.js';
import type { CollectionToolDeps } from '../apps/sidecar/dist/src/collection-tools.js';
import { fieldOf, maybeTextOf } from '../apps/sidecar/dist/tests/http-json.js';
import { loadBaseline } from './collection-gate-baseline.ts';
import type { Baseline, ServiceClass, ToolOutcome } from './collection-gate-baseline.ts';

export type { ServiceClass, ToolOutcome } from './collection-gate-baseline.ts';
export type ToolLimits = { readonly wait: number; readonly signal: AbortSignal | undefined };
export type ToolRunner = (deps: CollectionToolDeps, name: string, args: JsonObject, limits: ToolLimits) => Promise<ToolOutcome>;
export type Stamp = { readonly epoch: number; readonly revision: number | null };
export type Target = {
  readonly kind: string; readonly itemIndex: number; readonly compositionId: string; readonly layerIndex: number;
  readonly layerId: string; readonly propertyIndices: readonly number[]; readonly expectedStamp: Stamp;
};
export type LayerRow = {
  readonly id: string; readonly name: string; readonly index: number; readonly layerIndex: number; readonly locked: boolean;
  readonly selected: boolean; readonly detail: string; readonly properties: string; readonly values: string;
};
export type CompositionMetadata = {
  readonly id: string; readonly itemIndex: number; readonly name: string; readonly width: number; readonly height: number;
  readonly duration: number; readonly frameRate: number;
};
export type PageMetadata = {
  readonly runtime: { readonly application: string; readonly appVersion: string; readonly platform: string };
  readonly project: { readonly name: string; readonly filePath: string | null };
  readonly composition: CompositionMetadata;
  readonly activeCompositionId: string;
  readonly layerCount: number;
};
export type EvidenceScope = { readonly kind: string; readonly compositionId?: string; readonly layerId?: string; readonly propertyIndices?: readonly number[] };
export type Thrown = { readonly thrown: string };
export type TranscriptEntry = { readonly label: string; readonly value: JsonValue };

const dispatchRef = object({ ticket: string(), generation: number() });
const readDispatch = object({ ticket: string(), generation: number(), jobId: string(), hostFunction: string(), hostRequest: jsonObject });
export type Dispatch = Infer<typeof dispatchRef>;
export type ReadDispatch = Infer<typeof readDispatch>;

export interface Harness {
  readonly service: CollectionService;
  readonly transcript: TranscriptEntry[];
  emit<T>(label: string, operation: () => T): T | Thrown;
  demand(input?: JsonValue, busy?: boolean): JsonObject;
  start(input?: JsonValue): ReadDispatch;
  admit(dispatch: Dispatch): JsonObject;
  finish(dispatch: Dispatch, value: JsonValue): JsonObject;
  evidence(dispatch: Dispatch, scope: EvidenceScope, ids?: readonly string[]): void;
  time(value: number): void;
  close(): void;
}

const baseline = await loadBaseline();
const OldCollectionService = baseline?.service ?? null;
const oldCollectionTool = baseline?.tool ?? null;
const baselinePresent = baseline !== null;
export { CollectionService };

export const stamp: Stamp = { epoch: 1, revision: 2 };
export const target = (kind: string): Target => ({ kind, itemIndex: 1, compositionId: 'comp', layerIndex: 1, layerId: 'layer', propertyIndices: [1], expectedStamp: stamp });
export const layer = (index: number, id = String(index)): LayerRow => ({
  id, name: `Layer ${index}`, index, layerIndex: index, locked: false, selected: index === 1, detail: 'layer-index', properties: 'unknown', values: 'not-read',
});
export const metadata = (count: number): PageMetadata => ({
  runtime: { application: 'After Effects', appVersion: '26.2', platform: 'synthetic-linux' }, project: { name: 'Synthetic', filePath: null },
  composition: { id: 'comp', itemIndex: 1, name: 'Comp', width: 1920, height: 1080, duration: 10, frameRate: 30 }, activeCompositionId: 'comp', layerCount: count,
});
export function page(dispatch: Dispatch, overrides: JsonObject = {}): JsonObject {
  return { ok: true, requestId: dispatch.ticket, sessionId: 'session', rows: [{ id: 'a', name: 'A', itemIndex: 1 }], stamp, deepComplete: false, nextCursor: null, ...overrides };
}
export function outcome(dispatch: Dispatch, overrides: JsonObject = {}): JsonObject {
  const body = { schemaVersion: 'collection-dispatch-outcome/1', kind: 'native-not-started', requestId: dispatch.ticket, generation: dispatch.generation, ...overrides };
  return { ticket: dispatch.ticket, outcome: body };
}
export function dispatchOf(emitted: JsonObject): ReadDispatch { return decodeOrThrow(readDispatch, emitted); }
export function dispatchRefOf(source: JsonValue): Dispatch { return decodeOrThrow(dispatchRef, source); }

function retainTokens(ids: Map<string, string>, tokens: ReadonlyArray<string | undefined>): void {
  for (const token of tokens) if (token !== undefined && !ids.has(token)) ids.set(token, `token-${ids.size + 1}`);
}
function transcriptTokens(transcript: readonly TranscriptEntry[]): Map<string, string> {
  const ids = new Map<string, string>();
  for (const entry of transcript) {
    if (entry.label === 'demand' && fieldOf(entry.value, 'ok') === true) retainTokens(ids, [maybeTextOf(entry.value, 'ticket'), maybeTextOf(entry.value, 'jobId')]);
    if (entry.label !== 'mailbox' || !isJsonArray(entry.value)) continue;
    for (const item of entry.value) {
      if (fieldOf(item, 'approvedData.kind') === 'collection_page') retainTokens(ids, [maybeTextOf(item, 'approvedData.dispatch.ticket'), maybeTextOf(item, 'approvedData.dispatch.jobId')]);
    }
  }
  return ids;
}
const DOMAIN_FIELDS = new Set(['rows', 'row', 'target', 'scope', 'localEffect', 'localCreation', 'metadata', 'compositions', 'propertyPaths']);
function normalizeValue(value: JsonValue, ids: ReadonlyMap<string, string>, domain = false): JsonValue {
  if (typeof value === 'string') return (domain ? undefined : ids.get(value)) ?? value;
  if (isJsonArray(value)) return value.map(item => normalizeValue(item, ids, domain));
  if (!isJsonObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeValue(item, ids, domain || DOMAIN_FIELDS.has(key))]));
}
function objectAt(parent: JsonObject, key: string): JsonObject {
  const child = parent[key];
  if (child === undefined || !isJsonObject(child)) throw new Error(`no object at ${key}`);
  return child;
}
function legacySnapshotEntry(entry: TranscriptEntry): TranscriptEntry {
  const value = entry.value;
  if (entry.label !== 'complete' || !isJsonObject(value) || !value.snapshot || !isJsonObject(value.snapshot)) return entry;
  const snapshot = value.snapshot, result = objectAt(snapshot, 'result'), coverage = objectAt(result, 'coverage');
  const sessionId = objectAt(value, 'page').sessionId;
  assert.equal(typeof sessionId, 'string');
  assert.equal(Object.hasOwn(coverage, 'collectionSessionId'), true, 'candidate snapshot lost its admitted native session');
  assert.equal(coverage.collectionSessionId, sessionId, 'snapshot session must equal the actual accepted native page');
  const { collectionSessionId, ...legacyCoverage } = coverage;
  assert.equal(typeof collectionSessionId, 'string');
  return { ...entry, value: { ...value, snapshot: { ...snapshot, result: { ...result, coverage: legacyCoverage } } } };
}
export function normalizeCollectionTranscript(value: readonly TranscriptEntry[], candidate = false): TranscriptEntry[] {
  const transcript = candidate ? value.map(legacySnapshotEntry) : value;
  const ids = transcriptTokens(transcript);
  return transcript.map(entry => ({ label: entry.label, value: normalizeValue(entry.value, ids) }));
}
function scopeKey(scope: EvidenceScope, id: string): string {
  return JSON.stringify([scope.kind, scope.compositionId ?? null, scope.layerId ?? null, scope.propertyIndices ?? null, id]);
}
function harness(Service: ServiceClass): Harness {
  const folder = mkdtempSync(join(tmpdir(), 'extynt-collection-gate-'));
  let clock = 1000;
  const service = new Service(() => clock, new GraphStore(join(folder, 'synthetic.sqlite'), 100000, 'gate-transcript'));
  const transcript: TranscriptEntry[] = [];
  service.pair('panel');
  function emit<T>(label: string, operation: () => T): T | Thrown {
    let value: T | Thrown;
    try { value = operation(); } catch (error) { value = { thrown: error instanceof Error ? error.message : String(error) }; }
    transcript.push({ label, value: decodeOrThrow(wireJson, value ?? null) });
    return value;
  }
  const demand = (input: JsonValue = { begin: true, target: { kind: 'index' } }, busy = false): JsonObject => emit('demand', () => service.demand(input, busy));
  function evidence(dispatch: Dispatch, scope: EvidenceScope, ids: readonly string[] = ['a']): void {
    emit('demand-result', () => service.demandResult(dispatch.ticket));
    emit('lease', () => ({ unsettled: service.hasUnsettled(dispatch.ticket), admitted: service.admittedNativeTicket(), quarantine: service.nativeAccessQuarantine() }));
    for (const id of ids) emit('hot-cache', () => service.lookup(scopeKey(scope, id)));
    emit('sql-cache', () => service.queryCache({ target: scope }));
  }
  return {
    service, transcript, emit, demand, evidence,
    start: input => dispatchOf(demand(input)),
    admit: dispatch => emit('admit', () => service.authorizeDispatch({ ticket: dispatch.ticket })),
    finish: (dispatch, value) => emit('complete', () => service.complete({ ticket: dispatch.ticket, page: value })),
    time: value => { clock = value; },
    close() { service.close(); rmSync(folder, { recursive: true, force: true }); },
  };
}
export function compareTranscript(scenario: (h: Harness) => void): TranscriptEntry[] {
  const runs = [OldCollectionService ?? CollectionService, CollectionService].map((Service, index) => {
    const h = harness(Service);
    try { scenario(h); return normalizeCollectionTranscript(h.transcript, index === 1 && baselinePresent); } finally { h.close(); }
  });
  assert.deepEqual(runs[1], runs[0]);
  return runs[1] ?? [];
}
const optionedTool: ToolRunner = (deps, name, args, limits) => runCollectionTool(deps, name, args, limits);
const legacyTool = (tool: Baseline['tool']): ToolRunner => (deps, name, args, limits) => tool(deps, name, args, limits.wait, limits.signal);
export type ToolScenario = (h: Harness, tool: ToolRunner) => Promise<void>;
export async function compareToolTranscript(scenario: ToolScenario): Promise<TranscriptEntry[]> {
  const runs: TranscriptEntry[][] = [];
  const pinnedTool = oldCollectionTool ? legacyTool(oldCollectionTool) : optionedTool;
  const pinnedService = OldCollectionService ?? CollectionService;
  const pairs: ReadonlyArray<readonly [ServiceClass, ToolRunner]> = [[pinnedService, pinnedTool], [CollectionService, optionedTool]];
  for (const [Service, tool] of pairs) {
    const h = harness(Service);
    try { await scenario(h, tool); runs.push(normalizeCollectionTranscript(h.transcript, runs.length === 1 && baselinePresent)); } finally { h.close(); }
  }
  assert.deepEqual(runs[1], runs[0]);
  return runs[1] ?? [];
}
