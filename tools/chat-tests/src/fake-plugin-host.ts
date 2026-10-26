/**
 * The fixture project served through the fake plugin (`@extynt/fake-plugin`): what the sidecar's native lane sees in place of
 * After Effects. `read_project` and `read_comp` answer from the fixture with hashes, `host_call` runs the apply, undo, details,
 * capture, census and catalogue entries against it, and every change to the project moves the stamp and emits a `change` event.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodedValue, hangUp, isWireArray, isWireObject, late, ok, refuse, startFakePlugin, wireObjectOfDocument } from "@extynt/fake-plugin";
import type { FakePlugin, FakeRequest, FixtureProject, Reply } from "@extynt/fake-plugin";
import type { ProjectSnapshot } from "@extynt/project-graph";
import { appliedAnswer, batchOf, batchSizeOf, partialAnswer, refusedBatch, rejectedAnswer } from "./fake-plugin-apply.js";
import type { AppliedBatch, ReceiptMode } from "./fake-plugin-apply.js";
import { cataloguePageOf } from "./fake-plugin-catalogue.js";
import { censusOf, censusPartOf } from "./fake-plugin-census.js";
import { scenePng, solidPng } from "./fake-plugin-frame.js";
import { sceneOf } from "./fake-plugin-scene.js";
import { pick } from "./wire-reads.js";
import { nativeModelOf } from "./fake-plugin-rows.js";
import type { LayerDetails, NativeModel } from "./fake-plugin-rows.js";
import { applyOperationsToFixture, type FixtureApplyResult } from "./fake-host.js";
import { planOperationsFromHostCommand } from "./fake-host-translate.js";
import { watchOf } from "./fake-plugin-stamp.js";
import type { WireObject, WireValue } from "./wire-types.js";

export type { AppliedBatch, ReceiptMode } from "./fake-plugin-apply.js";

export interface FakePluginHostOptions {
  stateDirectory: string;
  censusDirectory?: string;
  snapshot: ProjectSnapshot;
  receiptMode?: ReceiptMode;
  onBatch?: (batch: AppliedBatch) => void;
  beforeMutation?: (planId: string) => void | Promise<void>;
  beforeRead?: () => void | Promise<void>;
  censusDelayMs?: number;
  afterMutation?: (planId: string) => void | Promise<void>;
}

export interface FakePluginHost {
  readonly plugin: FakePlugin;
  readonly snapshot: ProjectSnapshot;
  readonly batches: readonly AppliedBatch[];
  load(snapshot: ProjectSnapshot): void;
  editExternally(edit: (snapshot: ProjectSnapshot) => void): void;
  stop(): Promise<void>;
}

const CHANGE_DELAY_MS = 40;
const UNREADABLE = { code: "HOST_ERROR", message: "The fixture host cannot read the project back." };
const STALE_MESSAGE = "The project changed in After Effects after the sidecar last read it, so nothing was applied. The sidecar will read it again; propose the plan again.";
const UNMODELLED_ENTRIES = ["aeCollectIndexPage", "aeCollectDetailPage", "aeCollectValuePage", "aeCollectBlurControl", "aeCollectEffectCreation", "aePreviewControlValues"] as const;
const UNSUPPORTED = { ok: false, error: { code: "FIXTURE_UNSUPPORTED", message: "The fixture host does not model this entry." } };

const objectOf = (value: WireValue | undefined): WireObject => (isWireObject(value) ? value : {});
const rowsOf = (value: WireValue | undefined): WireObject[] => (isWireArray(value) ? value.map(objectOf) : []);

function aeVersionOf(snapshot: ProjectSnapshot): string {
  const { version, buildNumber } = snapshot.host;
  return buildNumber ? `${version} (build ${buildNumber})` : version;
}

function withoutHash(row: WireObject): WireObject { return Object.fromEntries(Object.entries(row).filter(([key]) => key !== "hash")); }

function shaped(project: FixtureProject, body: { readonly hashes?: boolean | undefined }, options: { rows: WireObject[]; items: boolean }): WireObject {
  const hashes = body.hashes === true;
  const kept = Object.entries(decodedValue(wireObjectOfDocument(project))).filter(([key]) => key !== "compositions" && (options.items || (key !== "items" && key !== "sources")) && (hashes || (key !== "itemsHash" && key !== "projectHash")));
  return { ...Object.fromEntries(kept), compositions: hashes ? options.rows : options.rows.map(withoutHash) };
}

class FixtureHost implements FakePluginHost {
  private current: ProjectSnapshot;
  private model: NativeModel;
  private readonly done: AppliedBatch[] = [];
  private readonly undoStack: Array<{ planId: string; before: ProjectSnapshot }> = [];
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly framesDirectory: string;
  private unreadableReads = 0;

  constructor(readonly plugin: FakePlugin, private readonly options: FakePluginHostOptions) {
    this.current = options.snapshot;
    this.model = nativeModelOf(this.current);
    this.framesDirectory = join(options.stateDirectory, "frames");
  }

  get snapshot(): ProjectSnapshot { return this.current; }
  get batches(): readonly AppliedBatch[] { return this.done; }

  bind(): void {
    const { plugin } = this;
    this.sync({ epoch: 1, revision: 100 });
    plugin.handlers.set("read_project", async (request) => { await this.options.beforeRead?.(); return this.readProject(request); });
    plugin.handlers.set("read_comp", async (request) => { await this.options.beforeRead?.(); return this.readComp(request); });
    plugin.hostCalls.set("aeApplyPlan", (args, request) => this.applyPlan(args, request));
    plugin.hostCalls.set("aeUndoPlan", (args) => this.undoPlan(args));
    plugin.hostCalls.set("aeReadPropertyDetails", (args) => this.readDetails(args));
    plugin.hostCalls.set("aeCaptureFrame", (args) => this.captureFrame(args));
    plugin.hostCalls.set("aeDiscardCaptureFrame", () => ok({ ok: true }));
    plugin.hostCalls.set("aeHostCensus", (args) => late(this.options.censusDelayMs ?? 0, this.census(args)));
    plugin.hostCalls.set("aeCatalogueProbePage", (args) => ok(cataloguePageOf({ args, host: this.current.host, profileDirectory: this.profileDirectory() })));
    plugin.hostCalls.set("aeCatalogueReadInstance", (args) => ok({ schemaVersion: "0.1", ok: false, requestId: String(args.requestId ?? ""), error: { code: "NO_INSTANCE", message: "The fixture project has no such effect." } }));
    for (const entry of UNMODELLED_ENTRIES) plugin.hostCalls.set(entry, () => ok(UNSUPPORTED));
  }

  private profileDirectory(): string { return this.options.censusDirectory ?? this.options.stateDirectory; }

  private sync(next: { epoch: number; revision: number }): void {
    this.model = nativeModelOf(this.current);
    const { state } = this.plugin;
    state.project = this.model.project;
    state.aeVersion = aeVersionOf(this.current);
    state.watch = watchOf(this.current, next);
  }

  private announce(): void {
    const timer = setTimeout(() => { this.timers.delete(timer); this.plugin.change({}, ["revision"]); }, CHANGE_DELAY_MS);
    this.timers.add(timer);
  }

  private publish(next: ProjectSnapshot): void {
    this.current = next;
    this.sync({ epoch: this.plugin.state.watch.epoch, revision: (this.plugin.state.watch.revision ?? 0) + 1 });
    this.announce();
  }

  load(snapshot: ProjectSnapshot): void {
    this.current = snapshot;
    this.undoStack.length = 0;
    this.sync({ epoch: this.plugin.state.watch.epoch + 1, revision: (this.plugin.state.watch.revision ?? 0) + 1 });
    this.plugin.change({}, ["project", "revision", "active", "selection"]);
  }

  editExternally(edit: (snapshot: ProjectSnapshot) => void): void {
    const copy = structuredClone(this.current);
    edit(copy);
    this.publish(copy);
  }

  private takeUnreadable(): boolean {
    if (this.unreadableReads <= 0) return false;
    this.unreadableReads -= 1;
    return true;
  }

  private readProject(request: FakeRequest): Reply {
    const { project } = this.model, body = request.body;
    if (this.takeUnreadable()) return refuse(UNREADABLE.code, UNREADABLE.message);
    const rows = project.compositions.map((composition) => (body.detail === "structure" ? this.model.structure.get(composition.id) ?? {} : { ...composition }));
    return ok(shaped(project, body, { rows, items: true }));
  }

  private readComp(request: FakeRequest): Reply {
    const { project } = this.model, body = request.body, id = String(body.compId);
    if (this.takeUnreadable()) return refuse(UNREADABLE.code, UNREADABLE.message);
    const composition = project.compositions.find((candidate) => candidate.id === id);
    if (!composition) return refuse("COMP_NOT_FOUND", `No composition ${id}.`);
    const row = body.detail === "structure" ? this.model.structure.get(id) ?? {} : { ...composition };
    return ok(shaped({ ...project, itemCount: 0 }, body, { rows: [row], items: false }));
  }

  private detailsOf(scope: WireObject): LayerDetails[] {
    const ids = scope.layerIds, wanted = isWireArray(ids) ? new Set(ids.map(String)) : undefined;
    return (this.model.details.get(String(scope.compId)) ?? []).filter((layer) => !wanted || wanted.has(layer.layerId));
  }

  private readDetails(args: WireObject): Reply {
    const maxLayers = args.maxLayers, cap = typeof maxLayers === "number" ? maxLayers : 256;
    const layers = rowsOf(args.scopes).flatMap((scope) => this.detailsOf(scope));
    return ok({ ok: true, layers: layers.slice(0, cap) });
  }

  private captureFrame(args: WireObject): Reply {
    const captureId = String(args.captureId), width = Number(args.width), height = Number(args.height);
    mkdirSync(this.framesDirectory, { recursive: true });
    const localPath = join(this.framesDirectory, `${captureId}.png`);
    const scene = sceneOf({ project: this.current, compositionId: String(args.compositionId), time: Number(args.time) || 0, width, height });
    writeFileSync(localPath, scene ? scenePng(width, height, scene.background, scene.rects) : solidPng(width, height));
    return ok({ ok: true, operation: "capture_frame", captureId, ...pick(args, ["compositionId", "time"]), width, height, format: "png", storage: "userData", fileExists: true, localPath, providerShared: false });
  }

  private census(args: WireObject): Reply {
    const fingerprint = args.fontFingerprint;
    const census = censusOf({ requestId: String(args.requestId ?? "census"), host: this.current.host, profileDirectory: this.profileDirectory(), part: censusPartOf(args), ...(typeof fingerprint === "string" ? { known: fingerprint } : {}) });
    return ok(census ?? { ok: false, error: { code: "CENSUS_EMPTY", message: "The fixture host has no installed effects to report." } });
  }

  private isStale(args: WireObject): boolean {
    const expected = args.expectedStamp;
    if (expected === undefined) return false;
    const stamp = objectOf(expected), { watch } = this.plugin.state;
    return stamp.epoch !== watch.epoch || stamp.revision !== watch.revision;
  }

  private refusedBeforeApply(input: { args: WireObject; planId: string; operations: WireObject[]; mode: ReceiptMode }): Reply | undefined {
    const { args, planId, operations, mode } = input;
    if (this.isStale(args)) return this.refuseApply(planId, operations, { code: "STALE_STAMP", message: STALE_MESSAGE });
    if (mode === "rejected") return this.refuseApply(planId, operations, { code: "FIXTURE_REJECTED", message: "The headless host rejected the precondition before mutation." });
    return undefined;
  }

  private async applyPlan(args: WireObject, request: FakeRequest): Promise<Reply> {
    const planId = String(args.planId ?? ""), operations = rowsOf(args.operations), mode = this.options.receiptMode ?? "verified";
    await this.options.beforeMutation?.(planId);
    const refused = this.refusedBeforeApply({ args, planId, operations, mode });
    if (refused) return refused;
    const result = applyOperationsToFixture({ snapshot: this.current, operations: planOperationsFromHostCommand(operations) });
    this.record(batchOf(planId, operations.length, result));
    if (result.mutated) { this.undoStack.push({ planId, before: this.current }); this.publish(result.snapshot); }
    await this.options.afterMutation?.(planId);
    return this.answerApply({ mode, operations, result, request, args });
  }

  private answerApply(input: { mode: ReceiptMode; operations: WireObject[]; result: FixtureApplyResult; request: FakeRequest; args: WireObject }): Reply {
    const { mode, operations, result } = input;
    if (mode === "lost") return hangUp();
    if (mode === "unknown") return ok("The fixture host answered with something that is not JSON.");
    if (mode === "partial") return ok(partialAnswer(operations, result));
    if (mode === "unreadable") this.failReadsAfter(input.request);
    return ok(appliedAnswer(operations, result, batchSizeOf(input.args)));
  }

  private failReadsAfter(request: FakeRequest): void {
    const ops = this.plugin.requestsFor("batch").at(-1)?.body.ops ?? [];
    const at = ops.findIndex((op) => op?.id === request.body.id);
    this.unreadableReads = 2 * ops.slice(at + 1).filter((op) => op?.op === "read_project" || op?.op === "read_comp").length;
  }

  private refuseApply(planId: string, operations: WireObject[], refusal: { code: string; message: string }): Reply {
    this.record(refusedBatch(planId, operations, refusal));
    return ok(rejectedAnswer(refusal.code, refusal.message));
  }

  private record(batch: AppliedBatch): void {
    this.done.push(batch);
    this.options.onBatch?.(batch);
  }

  private undoPlan(args: WireObject): Reply {
    const planId = String(args.planId ?? ""), top = this.undoStack.at(-1);
    const refused = (code: string, message: string): Reply => ok({ ok: false, mayHaveMutated: false, mutationState: "not-applied", error: { code, message } });
    if (this.isStale(args)) return refused("UNDO_PROJECT_CHANGED", "The project changed after this plan was applied.");
    if (!top || top.planId !== planId) return refused("NOTHING_TO_UNDO", "This plan is not the latest change in the fixture project.");
    this.undoStack.pop();
    this.publish(top.before);
    return ok({ ok: true, method: "edit-undo", times: 1 });
  }

  async stop(): Promise<void> {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    await this.plugin.close();
  }
}

/**
 * Starts the fake plugin with the fixture project behind it. native.json is written once every handler is installed, so the sidecar never
 * meets a half-built host.
 */
export async function startFakePluginHost(options: FakePluginHostOptions): Promise<FakePluginHost> {
  const plugin = await startFakePlugin({
    stateDirectory: options.stateDirectory,
    project: nativeModelOf(options.snapshot).project,
    writeDiscovery: false,
    aeVersion: aeVersionOf(options.snapshot),
  });
  const host = new FixtureHost(plugin, options);
  host.bind();
  plugin.writeDiscovery();
  return host;
}
