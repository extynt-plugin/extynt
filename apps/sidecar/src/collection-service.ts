// The sidecar's owner of native collection reads: one job and one outstanding ticket at a time, the demands agents wait on and the observations retained from accepted pages.
import type { JsonObject, JsonValue } from "@extynt/decode";
import { randomUUID } from "node:crypto";
import { boolean, decode, presentFields, decodeOrCode, fallback, jsonObject, object, string, wireJson } from "@extynt/decode";
import type { EffectProbeEvidence, PresetInventory } from "@extynt/capability-catalogue";
import type { CatalogueProbeWrite } from "./catalogue-definitions.js";
import type { CatalogueInstanceWrite } from "./catalogue-instance-definitions.js";
import { collectionDemandObservation, failedDemand, observedDemandResult } from "./collection-demand-result.js";
import type { DemandResult } from "./collection-demand-result.js";
import type { CollectionJob, CollectionPage, CollectionTicket, LayerAssembly, RetainedCollectionRow } from "./collection-job.js";
import { collectionTransportFailure, validateCollectionOutcome, validateCollectionPage } from "./collection-page.js";
import { assembleCollectionLayers } from "./collection-layers.js";
import { collectionHostFunction, collectionStart } from "./collection-request.js";
import { RetainedObservations } from "./collection-retention.js";
import { stageCollectionRows } from "./collection-rows.js";
import { collectionSnapshot } from "./collection-snapshot.js";
import { EffectNotesService } from "./effect-notes-service.js";
import type { ControlResolve } from "./graph-control-read.js";
import type { DesiredApplyInput, DesiredParameterInput, DesiredParameterPlan, VerifiedReadbackInput } from "./graph-control-types.js";
import { readbackStamp } from "./graph-readback.js";
import type { GraphPersistence } from "./graph-store.js";
import { ordinal } from "./native-field-decoders.js";
import type { HostCensus } from "./server-types.js";

const DEMAND_LIMIT = 16;
const DEMAND_LIFETIME_MS = 60000;
const MAX_LIVE_AGE_MS = 10000;
const MAX_PAGE_ROWS = 25;
const NO_RESULT: JsonObject = {};
const prepareFacts = object({
  begin: fallback(boolean(), false), jobId: fallback(string(), undefined), target: fallback(wireJson, undefined),
  startCursor: fallback(wireJson, undefined), maxRows: fallback(ordinal, undefined),
});
const completeFacts = object({ ticket: fallback(string(), undefined), outcome: fallback(wireJson, undefined), page: fallback(wireJson, undefined) });
const ticketFacts = object({ ticket: fallback(string(), undefined) });
const cancelFacts = object({ undispatched: fallback(boolean(), false), ticket: fallback(string(), undefined) });
const snapshotFacts = object({ result: fallback(jsonObject, NO_RESULT) });
const hostStampFacts = object({ hostStamp: fallback(jsonObject, undefined) });

interface DemandEntry { created: number; result?: DemandResult }

function liveStampValid(epoch: number, revision: number, ageMs: number): boolean {
  return Number.isSafeInteger(epoch) && Number.isSafeInteger(revision) && Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= MAX_LIVE_AGE_MS;
}

function unknownWrite(): JsonObject { return { state: "unknown", writeAuthorizing: false }; }

function unknownRows(): JsonObject { return { state: "unknown", rows: [], writeAuthorizing: false }; }

/** Bounded observational retention only. Production demand calls still acquire native pages; lookup provides no production query fast path and no write authorization. A replaced panel's unfinished read is retired before invalidation, so its demand can still be named. Replacing a cursor or job never establishes that the project changed; invalidation forgets what was retained, never that the project has moved on. */
export class CollectionService {
  private readonly demands = new Map<string, DemandEntry>();
  private readonly retained = new RetainedObservations();
  private generation = 0;
  private panel: string | undefined;
  private job: CollectionJob | undefined;
  private outstanding: CollectionTicket | undefined;
  private quarantined = false;
  readonly effectNotes: EffectNotesService;

  constructor(private readonly now: () => number = Date.now, private readonly graph?: GraphPersistence, effectNotes?: EffectNotesService) {
    this.effectNotes = effectNotes ?? new EffectNotesService({ graph, settings: undefined, now });
  }

  close(): void { this.graph?.close(); }

  queryCache(input: JsonValue): JsonObject { return this.graph?.query(input, this.now()) ?? unknownRows(); }

  queryRelational(query: JsonValue): JsonObject { return this.graph?.queryRelational(query, this.now()) ?? unknownRows(); }

  resolveParameter(input: ControlResolve): JsonObject { return this.graph?.resolveParameter(input, this.now()) ?? unknownWrite(); }

  recordDesiredParameter(input: DesiredParameterInput): JsonObject { return this.graph?.recordDesiredParameter(input, this.now()) ?? unknownWrite(); }

  bindDesiredApply(input: DesiredApplyInput): JsonObject { return this.graph?.bindDesiredApply(input, this.now()) ?? unknownWrite(); }

  observeVerifiedReadback(input: VerifiedReadbackInput): JsonObject {
    const result = this.graph?.observeVerifiedReadback(input, this.now()) ?? unknownWrite();
    if (this.retained.provesOlderThanNewest(readbackStamp(input.readback))) this.graph?.invalidate();
    return result;
  }

  desiredParameterPlan(planId: string): DesiredParameterPlan { return this.graph?.desiredParameterPlan(planId) ?? { state: "unknown", code: "GRAPH_STORAGE_UNAVAILABLE" }; }

  invalidateDesired(planId: string): JsonObject { return this.graph?.invalidateDesired(planId, this.now()) ?? unknownWrite(); }

  storageStatus(): JsonObject { return this.graph?.status() ?? { state: "disabled" }; }

  recordCensus(census: HostCensus, presets?: PresetInventory): JsonObject | undefined { return this.graph?.observeCensus(census, this.now(), presets); }

  catalogueProbedKeys(hostKey: string): Set<string> | undefined { return this.graph?.catalogueProbedKeys(hostKey); }

  catalogueEvidence(hostKey: string, only?: readonly string[]): EffectProbeEvidence { return this.graph?.catalogueEvidence(hostKey, only) ?? { effects: {} }; }

  writeCatalogueProbe(inputs: readonly CatalogueProbeWrite[]): { written: string[]; failed: Array<{ matchName: string; code: string }> } | undefined { return this.graph?.writeCatalogueProbe(inputs); }

  writeCatalogueInstance(input: CatalogueInstanceWrite): { written: boolean; code: string | null } | undefined { return this.graph?.writeCatalogueInstance(input); }

  reconcileSnapshot(snapshot: JsonValue): void {
    const parsed = decode(snapshotFacts, snapshot);
    const result = parsed.ok ? parsed.value.result : NO_RESULT;
    const stamp = decodeOrCode(hostStampFacts, result, "INVALID_SNAPSHOT").hostStamp;
    if (stamp === undefined || JSON.stringify(stamp) !== this.retained.boundKey()) { this.invalidate(); return; }
    if (this.graph?.reconcile({ ...result, stamp }) === false) this.invalidate();
  }

  observeLiveStamp(epoch: number, revision: number, ageMs: number, items: number | null = null): boolean {
    if (!liveStampValid(epoch, revision, ageMs)) return false;
    this.retained.noteNewest(epoch, revision);
    const at = this.now() - ageMs;
    if (this.retained.movedSince(epoch, revision, items, at)) { this.invalidate(); return false; }
    this.retained.pulse(epoch, revision, at);
    return this.graph?.confirmLive?.(epoch, revision, at) ?? false;
  }

  pair(panel: string): void {
    if (panel === this.panel) return;
    this.panel = panel;
    if (this.outstanding) this.retireOutstandingRead("COLLECTION_PANEL_REPLACED");
    else this.invalidate();
  }

  private retireOutstandingRead(code: string): void {
    const pending = this.outstanding;
    if (!pending) return;
    this.failDemand(pending.id, code);
    this.outstanding = undefined;
    this.stopJob();
    this.invalidate();
  }

  private stopJob(): void {
    for (const demand of this.demands.values()) demand.result ??= failedDemand("COLLECTION_CANCELLED");
    this.generation++;
    this.job = undefined;
  }

  private clearObservations(): void {
    for (const demand of this.demands.values()) if (demand.result) demand.result.invalidated = true;
    this.retained.forget();
    this.graph?.invalidate();
  }

  invalidate(): void {
    this.stopJob();
    this.clearObservations();
  }

  cancel(input?: JsonValue): void {
    const asked = decode(cancelFacts, input);
    const outstanding = this.outstanding;
    if (outstanding && asked.ok && asked.value.undispatched && asked.value.ticket === outstanding.id && !outstanding.dispatched) this.outstanding = undefined;
    this.stopJob();
  }

  nativeAccessQuarantine(): JsonObject | null {
    if (!this.quarantined) return null;
    return {
      state: "unresolved", accessKind: "read", operation: "collection_page", planId: this.outstanding?.id ?? null, code: "COLLECTION_QUARANTINED",
      message: "A native read may still be running. Do not retry, collect, apply or Undo. Wait for exact callback settlement; otherwise quit AE and obtain explicit local journal recovery. Reconnect and sidecar restart do not establish settlement.",
      recovery: "exact-callback-or-explicit-local-journal-recovery",
    };
  }

  admittedNativeTicket(): string | null { return this.outstanding?.dispatched ? this.outstanding.id : null; }

  settleNativeAfterBridge(id: string): void {
    const pending = this.outstanding;
    if (!pending || pending.id !== id || !pending.dispatched || (!this.quarantined && pending.generation === this.generation)) return;
    this.outstanding = undefined;
    this.quarantined = false;
    this.invalidate();
  }

  hasUnsettled(id: string): boolean { return this.outstanding?.id === id; }

  dispatchCurrent(id: string): boolean { return this.outstanding?.id === id && this.outstanding.generation === this.generation && !this.quarantined; }

  authorizeDispatch(input: JsonValue): JsonObject {
    const asked = decode(ticketFacts, input);
    const pending = this.outstanding;
    const ticket = asked.ok ? asked.value.ticket : undefined;
    if (!pending || ticket === undefined || !this.dispatchCurrent(ticket) || pending.dispatched) throw Error("STALE_COLLECTION_TICKET");
    pending.dispatched = true;
    return { ok: true };
  }

  demand(input: JsonValue, busy: boolean): JsonObject {
    this.evictDemands();
    const opened = this.open(input, busy);
    this.demands.set(opened.ticket, { created: this.now() });
    return opened.dispatch;
  }

  private evictDemands(): void {
    for (const [id, item] of this.demands) if (this.now() - item.created > DEMAND_LIFETIME_MS && item.result) this.demands.delete(id);
    while (this.demands.size >= DEMAND_LIMIT) {
      const oldest = [...this.demands].find(([, item]) => item.result !== undefined);
      if (!oldest) throw Error("DEMAND_MEMORY_LIMIT");
      this.demands.delete(oldest[0]);
    }
  }

  cancelDemand(id: string): void {
    if (this.outstanding?.id !== id) return;
    if (!this.outstanding.dispatched) this.outstanding = undefined;
    this.stopJob();
  }

  demandResult(id: string): JsonObject {
    const item = this.demands.get(id);
    if (!item) return { state: "unknown", error: { code: "DEMAND_NOT_FOUND" } };
    if (!item.result && this.now() - item.created >= DEMAND_LIFETIME_MS) return { state: "unknown", demandId: id, error: { code: "DEMAND_TIMEOUT" }, nativeLease: "unresolved" };
    if (!item.result) return { state: "pending", demandId: id };
    return observedDemandResult(item.result, item.created, this.now, this.retained.liveAtFor(item.result.page?.stamp));
  }

  failDemand(id: string, code: string): void {
    const item = this.demands.get(id);
    if (item && !item.result) item.result = failedDemand(code);
  }

  lookup(key: string): JsonObject {
    const found = this.retained.lookupRow(key, this.now());
    if (!found) return unknownWrite();
    const state = found.fresh ? "observed" : "stale";
    return { state, freshness: state, writeAuthorizing: false, dependencyClosure: "unknown", row: found.row };
  }

  private requireAvailable(busy: boolean): void {
    if (this.outstanding && this.now() - this.outstanding.began >= DEMAND_LIFETIME_MS) this.retireOutstandingRead("COLLECTION_TIMED_OUT");
    if (busy || this.outstanding) throw Error("COLLECTION_BUSY");
  }

  prepare(input: JsonValue, busy: boolean): JsonObject { return this.open(input, busy).dispatch; }

  private open(input: JsonValue, busy: boolean): { ticket: string; dispatch: JsonObject } {
    this.requireAvailable(busy);
    const request = decodeOrCode(prepareFacts, input, "INVALID_COLLECTION_REQUEST");
    const job = this.jobFor(request);
    const id = randomUUID();
    const maxRows = Math.min(MAX_PAGE_ROWS, request.maxRows ?? MAX_PAGE_ROWS);
    this.outstanding = { id, generation: this.generation, cursor: job.cursor, maxRows, began: this.now() };
    return { ticket: id, dispatch: this.dispatchOf(job, id, maxRows) };
  }

  private jobFor(request: { begin: boolean; jobId: string | undefined; target: JsonValue | undefined; startCursor: JsonValue | undefined }): CollectionJob {
    if (request.begin) {
      const { target, cursor } = collectionStart(request);
      this.stopJob();
      this.job = { id: randomUUID(), target, cursor, inventoryFromFirst: cursor === 1 };
      return this.job;
    }
    if (!this.job || request.jobId !== this.job.id) throw Error("STALE_COLLECTION");
    return this.job;
  }

  private dispatchOf(job: CollectionJob, ticket: string, pageSize: number): JsonObject {
    const hostRequest = presentFields({
      ...job.target, schemaVersion: "0.1", requestId: ticket, begin: !job.sessionId, sessionId: job.sessionId, cursor: job.cursor, startCursor: job.cursor, pageSize,
    });
    return { ok: true, jobId: job.id, ticket, hostFunction: collectionHostFunction(job.target.kind), hostRequest, generation: this.generation, delayMs: 100 };
  }

  private acknowledgeNotStarted(reply: { outcome: JsonValue | undefined; page: JsonValue | undefined }, pending: CollectionTicket): JsonObject {
    validateCollectionOutcome(presentFields(reply), pending, this.quarantined);
    this.outstanding = undefined;
    this.stopJob();
    return { ok: true, cancelled: true, nativeStarted: false, ticket: pending.id };
  }

  private rejectUnresolvedTransport(page: JsonValue | undefined): void {
    const code = collectionTransportFailure(page);
    if (!code) return;
    this.retireOutstandingRead(code);
    throw Error(code);
  }

  private publishObservations(page: CollectionPage, job: CollectionJob, assembly: LayerAssembly, rows: RetainedCollectionRow[]): void {
    const stamp = page.stamp;
    if (!job.stamp && (stamp.revision === null || this.retained.boundKey() !== stamp.key)) this.clearObservations();
    this.retained.bind(stamp.revision === null ? undefined : stamp, page.totalItems, this.now());
    job.stamp = stamp.key;
    job.sessionId = page.sessionId;
    if (assembly.layers) job.layers = assembly.layers;
    if (assembly.metadata) job.metadata = assembly.metadata;
    this.retained.retain(rows, this.now());
  }

  private publishDemand(pending: CollectionTicket, page: CollectionPage, job: CollectionJob, storage: JsonValue | undefined): void {
    const demand = this.demands.get(pending.id);
    if (demand && !demand.result) demand.result = collectionDemandObservation({ page, job, storage, observedAt: this.now() });
  }

  private acceptPage(input: JsonValue | undefined, pending: CollectionTicket, job: CollectionJob): JsonObject {
    const page = validateCollectionPage(input, pending, job);
    if (job.stamp && job.stamp !== page.stamp.key) throw Error("PROJECT_CHANGED");
    const staged = stageCollectionRows(page, job.target);
    const assembly = assembleCollectionLayers(page, pending, job, staged);
    this.publishObservations(page, job, assembly, staged);
    const snapshot = collectionSnapshot(page, pending, job, assembly);
    const storage = this.graph?.observePage(job.target, { ...page, rows: staged.map((row) => row.source) }, this.panel ?? "unpaired", this.now());
    const result = presentFields({ ok: true, page: page.raw, snapshot, jobId: job.id, delayMs: 100, generation: this.generation, storage });
    this.publishDemand(pending, page, job, storage);
    if (page.nextCursor === null) this.job = undefined; else job.cursor = page.nextCursor;
    return result;
  }

  complete(input: JsonValue): JsonObject {
    const reply = decodeOrCode(completeFacts, input, "STALE_COLLECTION_TICKET");
    const pending = this.outstanding;
    if (!pending || reply.ticket !== pending.id) throw Error("STALE_COLLECTION_TICKET");
    if (!pending.dispatched) throw Error("COLLECTION_NOT_ADMITTED");
    if (reply.outcome !== undefined) return this.acknowledgeNotStarted(reply, pending);
    this.rejectUnresolvedTransport(reply.page);
    this.outstanding = undefined;
    if (pending.generation !== this.generation || !this.job) throw Error("COLLECTION_CANCELLED");
    return this.acceptGuarded(reply.page, pending, this.job);
  }

  private acceptGuarded(page: JsonValue | undefined, pending: CollectionTicket, job: CollectionJob): JsonObject {
    try {
      return this.acceptPage(page, pending, job);
    } catch (error) {
      this.failDemand(pending.id, error instanceof Error ? error.message : "COLLECTION_FAILED");
      this.invalidate();
      throw error;
    }
  }
}
