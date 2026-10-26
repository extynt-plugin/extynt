// The graph database of one file: opens it lazily, records accepted pages, censuses and readbacks, and answers queries over what it retains.
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { decodeOrThrow, fallback, object, string, type JsonValue } from "@extynt/decode";
import type { Infer, JsonObject } from "@extynt/decode";
import type { DatabaseSync } from "node:sqlite";
import type { EffectProbeEvidence, PresetInventory } from "@extynt/capability-catalogue";
import type { HostCensus } from "./server-types.js";
import { openGraphFile } from "./graph-file.js";
import { GRAPH_SCHEMA_VERSION } from "./graph-schema.js";
import { graphScope, isDetailKind } from "./graph-record.js";
import type { GraphDetailKind } from "./graph-record.js";
import { readGraphRows } from "./graph-read.js";
import { findScope, saveGraphProject, writeGraphObservation } from "./graph-observe.js";
import { readRelationalQuery } from "./graph-relational-query.js";
import { resolveCurrentControl } from "./graph-control-read.js";
import type { ControlResolve } from "./graph-control-read.js";
import { bindDesiredParameter, invalidateDesiredParameter, writeDesiredParameter } from "./graph-desired-write.js";
import { desiredFields } from "./graph-desired-row.js";
import { readbackProof, readbackStamp, writeVerifiedReadback } from "./graph-readback.js";
import type { ReadbackProof } from "./graph-readback.js";
import { readDesiredParameterPlan } from "./graph-desired-read.js";
import { censusDefinitionsCurrent, censusFingerprint, censusHostKey, saveCensusFingerprint, savePresetInventory, writeCensusDefinitions, writeInstalledEffects } from "./graph-census-definitions.js";
import { catalogueProbedKeys, readCatalogueEvidence, writeCatalogueEffect } from "./catalogue-definitions.js";
import type { CatalogueProbeWrite } from "./catalogue-definitions.js";
import { writeCatalogueInstance } from "./catalogue-instance-definitions.js";
import type { CatalogueInstanceWrite } from "./catalogue-instance-definitions.js";
import { EffectNotesStore } from "./effect-notes-store.js";
import type { EffectNotesPersistence } from "./effect-notes-store.js";
import type { NoteFailure } from "./effect-notes-types.js";
import { execute, selectOne, takeInvalidRows } from "./graph-sql.js";
import { graphFailure, graphErrorCode, isLockContention, persistentGraphError } from "./graph-failure.js";
import type { GraphFailure } from "./graph-failure.js";
import { countOrNull, indicesOrEmpty, observedPage, pageFactsOf, pageHostKey, pageProject, textOr } from "./native-page.js";
import type { ObservedPage } from "./native-page.js";
import { observedTarget } from "./collection-request.js";
import type { CollectionTarget } from "./collection-request.js";
import type { DesiredApplyInput, DesiredParameterInput, DesiredParameterPlan, GraphContext } from "./graph-control-types.js";
import type { VerifiedReadbackInput } from "./graph-control-types.js";

const MAX_BYTES = 268435456;
const PAGE_LIMIT = 25;
const cacheTarget = object({ kind: textOr(""), compositionId: textOr(""), layerId: textOr(""), propertyIndices: indicesOrEmpty });
const NO_TARGET = decodeOrThrow(cacheTarget, {});
const cacheQuery = object({ target: fallback(cacheTarget, NO_TARGET), cursor: countOrNull, limit: countOrNull });
const requestRow = object({ ...desiredFields, project_id: string() });
const BOUND_REQUEST = `SELECT d.*,e.project_id FROM desired_control_requests d JOIN control_instances c ON c.id=d.control_id
  JOIN effect_instances e ON e.id=c.effect_instance_id WHERE d.plan_id=?`;
const countRow = object({ total: countOrNull });

type CacheTarget = Infer<typeof cacheTarget>;
type Outcome<T> = { ok: true; value: T } | { ok: false; code: string };

interface CacheRequest { target: CacheTarget; kind: GraphDetailKind; cursor: number | null; limit: number | null }

/** Reads a cache request; a target whose kind is not a stored page kind throws INVALID_CACHE_TARGET. */
export function cacheRequest(input: JsonValue): CacheRequest {
  const request = decodeOrThrow(cacheQuery, input), kind = request.target.kind;
  if (!isDetailKind(kind)) throw Error("INVALID_CACHE_TARGET");
  return { target: request.target, kind, cursor: request.cursor, limit: request.limit };
}

/** What the sidecar needs of a graph store: record accepted pages, censuses and readbacks, and answer queries over what is retained. */
export interface GraphPersistence {
  observe(target: JsonValue, page: JsonValue, panel: string, at: number): JsonObject;
  observePage(target: CollectionTarget, page: ObservedPage, panel: string, at: number): JsonObject;
  query(input: JsonValue, now: number): JsonObject;
  status(): JsonObject;
  invalidate(): void;
  reconcile(page: JsonObject): boolean;
  confirmLive?(epoch: number, revision: number, at: number): boolean;
  close(): void;
  observeCensus(census: HostCensus, at: number, presets?: PresetInventory): JsonObject;
  catalogueProbedKeys(hostKey: string): Set<string> | undefined;
  catalogueEvidence(hostKey: string, only?: readonly string[]): EffectProbeEvidence;
  writeCatalogueProbe(inputs: readonly CatalogueProbeWrite[]): { written: string[]; failed: Array<{ matchName: string; code: string }> };
  writeCatalogueInstance(input: CatalogueInstanceWrite): { written: boolean; code: string | null };
  queryRelational(input: JsonValue, now: number): JsonObject;
  resolveParameter(input: ControlResolve, now: number): JsonObject;
  recordDesiredParameter(input: DesiredParameterInput, at: number): JsonObject;
  bindDesiredApply(input: DesiredApplyInput, at: number): JsonObject;
  observeVerifiedReadback(input: VerifiedReadbackInput, at: number): JsonObject;
  invalidateDesired(planId: string, at: number): JsonObject;
  desiredParameterPlan(planId: string): DesiredParameterPlan;
  readonly effectNotes?: EffectNotesPersistence;
}

function pageSourceKind(target: CollectionTarget): "blur-page" | "value-page" | "descriptor-page" {
  return target.kind === "blur" ? "blur-page" : target.kind === "values" ? "value-page" : "descriptor-page";
}

function unknownRows(storage: JsonObject): JsonObject { return { state: "unknown", rows: [], writeAuthorizing: false, storage }; }

/** One graph database file; a live confirmation survives only a page for the same native identity, and effect value notes are written one transaction per call. Only an unusable file disables it for the process; a busy lock, a full file, a constraint conflict or one malformed page rolls back and fails that write alone. */
export class GraphStore {
  private database: DatabaseSync | undefined;
  private error: string | undefined;
  private lastFailure: string | undefined;
  private readonly instance = randomUUID();
  private active: GraphContext | undefined;
  private liveAt: number | undefined;
  readonly effectNotes: EffectNotesPersistence = new EffectNotesStore({ run: (mode, work) => this.notesRun(mode, work) });
  constructor(private readonly path: string, private readonly maxRows = 100000, private readonly projectSession?: string) {}
  status(): JsonObject {
    if (this.database && takeInvalidRows(this.database) > 0) this.lastFailure = "GRAPH_ROW_INVALID";
    const state = this.error ? "unavailable" : this.lastFailure ? "degraded" : this.database ? "ready" : "not-opened";
    return { format: "extynt-sqlite", schemaVersion: GRAPH_SCHEMA_VERSION, state, code: this.error ?? this.lastFailure ?? null, maxRows: this.maxRows, maxBytes: MAX_BYTES };
  }
  private connection(): DatabaseSync {
    if (this.error) throw Error(this.error);
    if (!this.database) {
      try { this.database = openGraphFile(this.path); }
      catch (error) {
        const failure = decodeOrThrow(graphFailure, error);
        if (isLockContention(failure)) throw error;
        this.error = persistentGraphError(failure) ?? graphErrorCode(failure);
        throw error;
      }
    }
    return this.database;
  }
  private recordFailure(failure: GraphFailure): string {
    const persistent = persistentGraphError(failure);
    if (persistent) { this.error = persistent; this.database?.close(); this.database = undefined; return persistent; }
    return (this.lastFailure = graphErrorCode(failure));
  }
  private transaction(write: (database: DatabaseSync) => void): boolean {
    try {
      const database = this.connection();
      database.exec("BEGIN IMMEDIATE");
      try { write(database); database.exec("COMMIT"); }
      catch (error) { database.exec("ROLLBACK"); throw error; }
      this.lastFailure = undefined;
      return true;
    } catch (error) {
      this.recordFailure(decodeOrThrow(graphFailure, error));
      return false;
    }
  }
  private notesRun<T>(mode: "read" | "write", work: (database: DatabaseSync) => T): T | NoteFailure {
    try {
      const database = this.connection();
      database.exec(mode === "write" ? "BEGIN IMMEDIATE" : "BEGIN");
      try { const result = work(database); database.exec("COMMIT"); this.lastFailure = undefined; return result; }
      catch (error) { database.exec("ROLLBACK"); throw error; }
    } catch (error) {
      return { ok: false, code: this.recordFailure(decodeOrThrow(graphFailure, error)), message: "Effect notes storage is unavailable; nothing was changed.", writeAuthorizing: false };
    }
  }
  invalidate(): void { this.active = undefined; this.liveAt = undefined; }
  confirmLive(epoch: number, revision: number, at: number): boolean {
    const active = this.active;
    if (!active || active.revision === null || active.epoch !== epoch || active.revision !== revision) return false;
    this.liveAt = Math.max(this.liveAt ?? 0, at);
    return true;
  }
  private readContext(): GraphContext | undefined { return this.active && { ...this.active, liveAt: this.liveAt }; }
  reconcile(page: JsonObject): boolean {
    if (!this.active) return true;
    const stamp = pageFactsOf(page).stamp, project = pageProject(page, this.projectSession ?? this.active.owner);
    const matches = this.active.project === project.id && this.active.epoch === stamp.epoch && this.active.revision !== null && this.active.revision === stamp.revision;
    if (!matches) this.invalidate();
    return matches;
  }
  close(): void { this.database?.close(); this.database = undefined; this.invalidate(); }
  observe(targetInput: JsonValue, pageInput: JsonValue, panel: string, at: number): JsonObject {
    const target = observedTarget(targetInput), page = observedPage(pageInput);
    return target && page ? this.observePage(target, page, panel, at) : this.status();
  }
  observePage(target: CollectionTarget, page: ObservedPage, panel: string, at: number): JsonObject {
    if (target.kind === "effect-create") return this.status();
    const owner = `${this.instance}:${panel}`, session = this.projectSession ?? owner, project = pageProject(page.raw, session);
    const context: GraphContext = { project: project.id, owner, epoch: page.stamp.epoch, revision: page.stamp.revision, liveAt: undefined };
    const evidence = { context, panel, session: page.sessionId, sourceKind: pageSourceKind(target), at, proofReference: undefined };
    const saved = this.transaction((database) => {
      saveGraphProject(database, page, session);
      writeGraphObservation({ database, target, page, evidence });
      this.prune(database);
    });
    if (saved) this.activate(context); else this.invalidate();
    return this.status();
  }
  private activate(context: GraphContext): void {
    const active = this.active;
    if (!active || active.project !== context.project || active.owner !== context.owner || active.epoch !== context.epoch || active.revision !== context.revision) this.liveAt = undefined;
    this.active = context;
  }
  queryRelational(input: JsonValue, now: number): JsonObject {
    if (this.error) return unknownRows(this.status());
    const context = this.readContext();
    const answer = readRelationalQuery({ database: this.connection(), input, ...(context === undefined ? {} : { context }), now });
    return { ...answer, storage: this.status() };
  }
  resolveParameter(input: ControlResolve, now: number): JsonObject {
    const context = this.readContext();
    if (!context || this.error) return { state: "unknown", writeAuthorizing: false };
    const binding = resolveCurrentControl(this.connection(), input, context, now);
    return binding ? { ...binding } : { state: "unknown", writeAuthorizing: false };
  }
  private mutate<T>(write: (database: DatabaseSync) => T): Outcome<T> {
    try {
      const database = this.connection(); database.exec("BEGIN IMMEDIATE");
      try { const value = write(database); database.exec("COMMIT"); this.lastFailure = undefined; return { ok: true, value }; }
      catch (error) { database.exec("ROLLBACK"); throw error; }
    } catch (error) {
      const failure = decodeOrThrow(graphFailure, error);
      return { ok: false, code: /^GRAPH_(CONTROL|DESIRED|READBACK)_/.test(failure.message) ? failure.message : this.recordFailure(failure) };
    }
  }
  private refusal(code: string): JsonObject { return { ok: false, state: "unknown", code, storage: this.status(), writeAuthorizing: false }; }
  private mutation(write: (database: DatabaseSync) => JsonObject): JsonObject {
    const outcome = this.mutate(write);
    return outcome.ok ? { ...outcome.value, storage: this.status() } : this.refusal(outcome.code);
  }
  recordDesiredParameter(input: DesiredParameterInput, at: number): JsonObject {
    return this.mutation((database) => {
      const active = this.active;
      if (!active) throw Error("GRAPH_CONTROL_STALE");
      const binding = resolveCurrentControl(database, { controlInstanceId: input.controlInstanceId, observationId: input.sourceObservationId }, active, at);
      if (!binding) throw Error("GRAPH_CONTROL_STALE");
      writeDesiredParameter(database, input, binding, at);
      return { ok: true, state: "prepared", planId: input.planId, sourceObservationId: input.sourceObservationId, controlInstanceId: input.controlInstanceId, observedMutation: false, writeAuthorizing: false };
    });
  }
  bindDesiredApply(input: DesiredApplyInput, at: number): JsonObject {
    return this.mutation((database) => {
      const request = selectOne(database, BOUND_REQUEST, requestRow, input.planId);
      if (!request || request.source_owner !== `${this.instance}:${input.panelInstanceId}`) throw Error("GRAPH_CONTROL_STALE");
      const source: GraphContext = { project: request.project_id, owner: request.source_owner, epoch: request.source_epoch, revision: request.source_revision, liveAt: undefined };
      const binding = resolveCurrentControl(database, { controlInstanceId: request.control_id, observationId: request.source_observation_id }, source, at);
      if (!binding) throw Error("GRAPH_CONTROL_STALE");
      return bindDesiredParameter(database, input, binding);
    });
  }
  desiredParameterPlan(planId: string): DesiredParameterPlan {
    if (this.error) return { state: "unknown", code: this.error };
    try { return readDesiredParameterPlan(this.connection(), planId); }
    catch { return { state: "unknown", code: "GRAPH_STORAGE_UNAVAILABLE" }; }
  }
  observeVerifiedReadback(input: VerifiedReadbackInput, at: number): JsonObject {
    const proof = readbackProof(input);
    if (!this.readbackContextMatches(proof)) {
      this.invalidateDesired(input.planId, at);
      return this.refusal("GRAPH_READBACK_CONTEXT_STALE");
    }
    const projectSession = this.projectSession ?? `${this.instance}:${input.panelInstanceId}`;
    const outcome = this.mutate((database) => writeVerifiedReadback({ database, input: proof, at, projectSession, hostKey: pageHostKey(proof.readback) }));
    if (outcome.ok) { this.active = outcome.value.context; this.liveAt = undefined; return { ...outcome.value.result, storage: this.status() }; }
    const result = this.refusal(outcome.code);
    this.invalidate(); this.invalidateDesired(input.planId, at);
    return result;
  }
  private readbackContextMatches(proof: ReadbackProof): boolean {
    const active = this.active;
    if (!active) return true;
    const stamp = readbackStamp(proof.readback), project = pageProject(proof.readback, this.projectSession ?? `${this.instance}:${proof.panelInstanceId}`);
    if (active.project !== project.id || active.owner !== `${this.instance}:${proof.panelInstanceId}` || active.epoch !== stamp.epoch) return false;
    return active.revision !== null && stamp.revision !== null && stamp.revision >= active.revision;
  }
  invalidateDesired(planId: string, at: number): JsonObject {
    return this.mutation((database) => { invalidateDesiredParameter(database, planId, at); return { ok: true, state: "invalidated", planId, observedMutation: false, writeAuthorizing: false }; });
  }
  private prune(database: DatabaseSync): void {
    const count = selectOne(database, "SELECT count(*) AS total FROM nodes", countRow)?.total ?? 0;
    if (count <= this.maxRows) return;
    execute(database, "DELETE FROM nodes WHERE id IN (SELECT id FROM nodes ORDER BY observed_at,id LIMIT ?)", count - this.maxRows);
    database.exec("DELETE FROM scopes WHERE NOT EXISTS(SELECT 1 FROM nodes WHERE scope_id=scopes.id); DELETE FROM projects WHERE NOT EXISTS(SELECT 1 FROM scopes WHERE project_id=projects.id) AND NOT EXISTS(SELECT 1 FROM effect_instances WHERE project_id=projects.id)");
  }
  query(input: JsonValue, now: number): JsonObject {
    const request = cacheRequest(input), active = this.readContext();
    if (!active || this.error) return unknownRows(this.status());
    const database = this.connection(), scope = findScope(database, active.project, graphScope(request.target));
    if (scope === undefined) return unknownRows(this.status());
    const limit = Math.max(1, Math.min(PAGE_LIMIT, request.limit ?? PAGE_LIMIT));
    return { ...readGraphRows({ database, scope, kind: request.kind, after: request.cursor ?? 0, limit, context: active, now }), storage: this.status() };
  }
  observeCensus(census: HostCensus, at: number, presets?: PresetInventory): JsonObject {
    const hostKey = censusHostKey(census), fingerprint = censusFingerprint(census);
    let definitions: "written" | "unchanged" | "failed" = "written";
    const saved = this.transaction((database) => {
      writeInstalledEffects(database, census, at);
      if (censusDefinitionsCurrent(database, census, hostKey, fingerprint)) definitions = "unchanged";
      else { writeCensusDefinitions(database, census, at); saveCensusFingerprint(database, hostKey, fingerprint, at); }
      if (presets) savePresetInventory(database, hostKey, presets);
    });
    if (!saved) definitions = "failed";
    return { ...this.status(), censusDefinitions: definitions, censusFingerprint: fingerprint };
  }
  catalogueProbedKeys(hostKey: string): Set<string> | undefined {
    if (this.error) return undefined;
    try {
      if (!this.database && !existsSync(this.path)) return new Set();
      return catalogueProbedKeys(this.connection(), hostKey);
    } catch (error) { this.recordFailure(decodeOrThrow(graphFailure, error)); return undefined; }
  }
  catalogueEvidence(hostKey: string, only?: readonly string[]): EffectProbeEvidence {
    if (this.error) return { effects: {} };
    try {
      if (!this.database && !existsSync(this.path)) return { effects: {} };
      return readCatalogueEvidence(this.connection(), hostKey, only);
    } catch (error) { this.recordFailure(decodeOrThrow(graphFailure, error)); return { effects: {} }; }
  }
  writeCatalogueProbe(inputs: readonly CatalogueProbeWrite[]): { written: string[]; failed: Array<{ matchName: string; code: string }> } {
    const written: string[] = [], failed: Array<{ matchName: string; code: string }> = [];
    for (const input of inputs) {
      let failure = "GRAPH_STORAGE_UNAVAILABLE";
      const saved = this.transaction((database) => {
        try { writeCatalogueEffect(database, input); }
        catch (error) { failure = graphErrorCode(decodeOrThrow(graphFailure, error)); throw error; }
      });
      if (saved) written.push(input.effect.matchName); else failed.push({ matchName: input.effect.matchName, code: failure });
    }
    return { written, failed };
  }
  writeCatalogueInstance(input: CatalogueInstanceWrite): { written: boolean; code: string | null } {
    let failure = "GRAPH_STORAGE_UNAVAILABLE";
    const saved = this.transaction((database) => {
      try { writeCatalogueInstance(database, input); }
      catch (error) { failure = graphErrorCode(decodeOrThrow(graphFailure, error)); throw error; }
    });
    return saved ? { written: true, code: null } : { written: false, code: failure };
  }
}
