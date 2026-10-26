/**
 * Loads the SHA-pinned out-of-tree baseline of the collection service and tool, when it is present.  The baseline is
 * compiled code this repository does not type, so each module is imported at run time, its exports are checked to be
 * functions, and every answer it gives is decoded into the shape the current code declares.  The service is exposed as a
 * subclass of the current `CollectionService` whose members the gate calls forward to the baseline instance.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import {
  absentAs, boolean, importFunctions, jsonObject, jsonValue, literal, nullValue, nullable, optional, string, strictObject, union,
} from '../packages/decode/dist/src/index.js';
import type { Foreign, JsonObject, JsonValue } from '../packages/decode/dist/src/index.js';
import { CollectionService } from '../apps/sidecar/dist/src/collection-service.js';
import type { runCollectionTool } from '../apps/sidecar/dist/src/collection-tools.js';
import type { GraphStore } from '../apps/sidecar/dist/src/graph-store.js';

export type ServiceClass = new (now: () => number, graph: GraphStore) => CollectionService;
export type ToolOutcome = Awaited<ReturnType<typeof runCollectionTool>>;
type LegacyToolRunner = (...call: [Parameters<typeof runCollectionTool>[0], string, JsonObject, number, AbortSignal | undefined]) => Promise<ToolOutcome>;

/** The baseline's service class and tool runner. */
export interface Baseline { readonly service: ServiceClass; readonly tool: LegacyToolRunner }

const SERVICE_URL = new URL('../../final-sql-node24/apps/sidecar/dist/src/collection-service.js', import.meta.url);
const TOOL_URL = new URL('../../final-sql-node24/apps/sidecar/dist/src/collection-tools.js', import.meta.url);
const SERVICE_SHA256 = '52a6629f11f95f749f1dfbe49adf79de1dbce40cbcf202b90df3897b4a53ecef';
const TOOL_SHA256 = '7ab113308b218e6e03019d4d3d18bbb6f7deec7e57dd944c3cd084f682456418';

const nothing = absentAs(nullValue, undefined);
const toolResult = union(
  strictObject({
    ok: literal(true), tool: string(), snapshotFingerprint: nullable(string()), data: jsonValue, truncated: optional(boolean()), undoPlanId: optional(string()),
  }),
  strictObject({ ok: literal(false), error: strictObject({ code: string(), message: string() }) }),
);

function pinned(url: URL, hash: string): void {
  assert.equal(createHash('sha256').update(readFileSync(url)).digest('hex'), hash, 'immutable compiled baseline changed');
}

function serviceClassOf(constructorOf: Foreign): ServiceClass {
  return class BaselineCollectionService extends CollectionService {
    private readonly baseline: Foreign;
    constructor(now: () => number, graph: GraphStore) { super(now); this.baseline = constructorOf.construct([now, graph]); }
    override close(): void { this.baseline.invoke('close', []).into(nothing); }
    override queryCache(input: JsonValue): JsonObject { return this.baseline.invoke('queryCache', [input]).into(jsonObject); }
    override pair(panel: string): void { this.baseline.invoke('pair', [panel]).into(nothing); }
    override nativeAccessQuarantine(): JsonObject | null {
      return this.baseline.invoke('nativeAccessQuarantine', []).into(nullable(jsonObject));
    }
    override admittedNativeTicket(): string | null { return this.baseline.invoke('admittedNativeTicket', []).into(nullable(string())); }
    override settleNativeAfterBridge(id: string): void { this.baseline.invoke('settleNativeAfterBridge', [id]).into(nothing); }
    override hasUnsettled(id: string): boolean { return this.baseline.invoke('hasUnsettled', [id]).into(boolean()); }
    override authorizeDispatch(input: JsonValue): JsonObject { return this.baseline.invoke('authorizeDispatch', [input]).into(jsonObject); }
    override demand(input: JsonValue, busy: boolean): JsonObject { return this.baseline.invoke('demand', [input, busy]).into(jsonObject); }
    override cancelDemand(id: string): void { this.baseline.invoke('cancelDemand', [id]).into(nothing); }
    override demandResult(id: string): JsonObject { return this.baseline.invoke('demandResult', [id]).into(jsonObject); }
    override lookup(key: string): JsonObject { return this.baseline.invoke('lookup', [key]).into(jsonObject); }
    override cancel(input?: JsonValue): void { this.baseline.invoke('cancel', [input]).into(nothing); }
    override complete(input: JsonValue): JsonObject { return this.baseline.invoke('complete', [input]).into(jsonObject); }
    override reconcileSnapshot(snapshot: JsonValue): void { this.baseline.invoke('reconcileSnapshot', [snapshot]).into(nothing); }
  };
}

/** The baseline, or null when its compiled files are not next to this repository. */
export async function loadBaseline(): Promise<Baseline | null> {
  if (!existsSync(SERVICE_URL) || !existsSync(TOOL_URL)) return null;
  pinned(SERVICE_URL, SERVICE_SHA256);
  pinned(TOOL_URL, TOOL_SHA256);
  const service = await importFunctions(SERVICE_URL.href, ['CollectionService']);
  const tools = await importFunctions(TOOL_URL.href, ['runCollectionTool']);
  const run = tools.read('runCollectionTool');
  return {
    service: serviceClassOf(service.read('CollectionService')),
    tool: (...call) => run.apply(call).intoAwaited(toolResult),
  };
}
