// The graph stores of a session: one file per project, chosen by the native identity of the first accepted page, plus the host catalogue file.
import type { JsonObject, JsonValue } from "@extynt/decode";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { boolean, decodeOrThrow, fallback, object } from "@extynt/decode";
import type { EffectProbeEvidence, PresetInventory } from "@extynt/capability-catalogue";
import type { CatalogueProbeWrite } from "./catalogue-definitions.js";
import type { CatalogueInstanceWrite } from "./catalogue-instance-definitions.js";
import { GraphStore, cacheRequest } from "./graph-store.js";
import type { GraphPersistence } from "./graph-store.js";
import type { EffectNotesPersistence } from "./effect-notes-store.js";
import { observedPage, pageProject, textOr } from "./native-page.js";
import type { ObservedPage } from "./native-page.js";
import { projectFileLink } from "./project-file-names.js";
import type { ProjectFileLink } from "./project-file-names.js";
import { GRAPH_SCHEMA_VERSION } from "./graph-schema.js";
import { pruneUnsavedGraphs } from "./graph-prune.js";
import type { HostCensus } from "./server-types.js";
import type { ControlResolve } from "./graph-control-read.js";
import { observedTarget } from "./collection-request.js";
import type { CollectionTarget } from "./collection-request.js";
import type { DesiredApplyInput, DesiredParameterInput, DesiredParameterPlan, VerifiedReadbackInput } from "./graph-control-types.js";

const MAX_BYTES = 268435456;
const DEFINITION_KINDS: ReadonlySet<string> = new Set(["effect-definitions", "parameter-definitions", "parameter-facts"]);
const kindOf = fallback(object({ kind: textOr("") }), { kind: "" });
const succeededFlag = fallback(object({ ok: fallback(boolean(), false) }), { ok: false });
const UNKNOWN_ROWS: JsonObject = { state: "unknown", rows: [], writeAuthorizing: false };
const UNKNOWN: JsonObject = { state: "unknown", writeAuthorizing: false };
const FAILED: JsonObject = { ok: false, state: "unknown", writeAuthorizing: false };

interface ProjectFile { identity: string; path: string; link: ProjectFileLink; store: GraphStore }

function hasRows(result: JsonObject): boolean {
  const rows = result.rows;
  return Array.isArray(rows) && rows.length > 0;
}
function succeeded(result: JsonObject): boolean { return decodeOrThrow(succeededFlag, result).ok; }
function isDefinitionQuery(input: JsonValue): boolean { return DEFINITION_KINDS.has(decodeOrThrow(kindOf, input).kind); }

/** Lazy, independent project files. Selecting a file establishes no evidence: only the accepted bounded observation can select the current native scope, and a filename never establishes freshness or edit authority. Factory definitions and effect value notes live in the host catalogue; a project file holds only definitions inferred from controls it observed, and a definition chain reads the catalogue first and falls back to the project file. */
export class ProjectGraphStore implements GraphPersistence {
  private readonly session = randomUUID();
  private active: ProjectFile | undefined;
  private linked = false;
  private pruned = false;
  private catalogue: GraphStore | undefined;
  constructor(private readonly directory: string, private readonly maxRows = 100000) {}
  private cataloguePath(): string { return join(this.directory, "graphs", "host-catalogue.extynt"); }
  private select(page: ObservedPage, panel: string): ProjectFile {
    const project = pageProject(page.raw, this.session), kind = project.path === null ? "unsaved" : "saved";
    const key = kind === "saved" ? `${project.platform}\0${project.path}` : `${this.session}\0${panel}\0${String(page.stamp.epoch)}`;
    const identity = createHash("sha256").update(`${kind}\0${key}`).digest("hex");
    if (this.active?.identity !== identity) {
      this.active?.store.close();
      this.linked = false;
      const link = projectFileLink(kind, identity), path = join(this.directory, "graphs", link.databaseFile);
      if (!this.pruned) { this.pruned = true; pruneUnsavedGraphs(join(this.directory, "graphs"), Date.now(), path); }
      this.active = { identity, path, link, store: new GraphStore(path, this.maxRows, `${this.session}:${panel}`) };
    }
    return this.active;
  }
  private currentLink(): JsonObject | null { return this.linked && this.active ? { ...this.active.link } : null; }
  private storageStatus(): JsonObject {
    return this.active?.store.status() ?? { format: "extynt-sqlite", schemaVersion: GRAPH_SCHEMA_VERSION, state: "not-opened", code: null, maxRows: this.maxRows, maxBytes: MAX_BYTES };
  }
  private catalogueStatus(): JsonObject { return { ...(this.catalogue?.status() ?? { state: "not-opened" }), path: this.cataloguePath() }; }
  status(): JsonObject {
    const storage = this.storageStatus(), catalogue = this.catalogueStatus();
    return { ...storage, layout: "per-project", path: this.active?.path ?? null, projectKind: this.active?.link.kind ?? null, projectLink: this.currentLink(), catalogue };
  }
  observe(targetInput: JsonValue, pageInput: JsonValue, panel: string, at: number): JsonObject {
    const target = observedTarget(targetInput), page = observedPage(pageInput);
    return target && page ? this.observePage(target, page, panel, at) : this.status();
  }
  observePage(target: CollectionTarget, page: ObservedPage, panel: string, at: number): JsonObject {
    if (target.kind === "effect-create") return this.status();
    this.select(page, panel).store.observePage(target, page, panel, at);
    this.linked = true;
    return this.status();
  }
  query(input: JsonValue, now: number): JsonObject {
    cacheRequest(input);
    const result = this.active?.store.query(input, now) ?? UNKNOWN_ROWS;
    return { ...result, storage: this.status() };
  }
  queryRelational(input: JsonValue, now: number): JsonObject {
    const stores = isDefinitionQuery(input) ? [this.catalogue, this.active?.store] : [this.active?.store ?? this.catalogue];
    let result: JsonObject = UNKNOWN_ROWS;
    for (const store of stores) {
      if (!store) continue;
      result = store.queryRelational(input, now);
      if (hasRows(result)) break;
    }
    return { ...result, storage: this.status() };
  }
  resolveParameter(input: ControlResolve, now: number): JsonObject { return this.active?.store.resolveParameter(input, now) ?? UNKNOWN; }
  recordDesiredParameter(input: DesiredParameterInput, at: number): JsonObject { return this.active?.store.recordDesiredParameter(input, at) ?? FAILED; }
  bindDesiredApply(input: DesiredApplyInput, at: number): JsonObject { return this.active?.store.bindDesiredApply(input, at) ?? FAILED; }
  observeVerifiedReadback(input: VerifiedReadbackInput, at: number): JsonObject {
    const result = this.active?.store.observeVerifiedReadback(input, at) ?? FAILED;
    if (succeeded(result)) this.linked = true;
    return { ...result, storage: this.status() };
  }
  invalidateDesired(planId: string, at: number): JsonObject { return this.active?.store.invalidateDesired(planId, at) ?? FAILED; }
  desiredParameterPlan(planId: string): DesiredParameterPlan { return this.active?.store.desiredParameterPlan(planId) ?? { state: "unknown", code: "GRAPH_PROJECT_UNKNOWN" }; }
  observeCensus(census: HostCensus, at: number, presets?: PresetInventory): JsonObject {
    return { ...this.catalogueStore().observeCensus(census, at, presets), path: this.cataloguePath(), scope: "host-catalogue" };
  }
  private catalogueStore(): GraphStore { return this.catalogue ??= new GraphStore(this.cataloguePath(), this.maxRows); }
  get effectNotes(): EffectNotesPersistence { return this.catalogueStore().effectNotes; }
  catalogueProbedKeys(hostKey: string): Set<string> | undefined { return this.catalogueStore().catalogueProbedKeys(hostKey); }
  catalogueEvidence(hostKey: string, only?: readonly string[]): EffectProbeEvidence { return this.catalogueStore().catalogueEvidence(hostKey, only); }
  writeCatalogueProbe(inputs: readonly CatalogueProbeWrite[]): { written: string[]; failed: Array<{ matchName: string; code: string }> } { return this.catalogueStore().writeCatalogueProbe(inputs); }
  writeCatalogueInstance(input: CatalogueInstanceWrite): { written: boolean; code: string | null } { return this.catalogueStore().writeCatalogueInstance(input); }
  invalidate(): void { this.active?.store.invalidate(); this.linked = false; }
  confirmLive(epoch: number, revision: number, at: number): boolean { return this.active?.store.confirmLive(epoch, revision, at) ?? false; }
  reconcile(page: JsonObject): boolean {
    const matches = this.active?.store.reconcile(page) ?? true;
    if (!matches) this.linked = false;
    return matches;
  }
  close(): void {
    this.active?.store.close(); this.catalogue?.close();
    this.active = undefined; this.catalogue = undefined; this.linked = false;
  }
}
