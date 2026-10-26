// What one verification reads through: the decoded plan, the host's step evidence, the two snapshots, and the ids the plan's own creations were given.
import type { JsonObject } from "@extynt/decode";
import { findById, findByPath } from "./snapshot-index.js";
import type { SnapshotComposition, SnapshotItem, SnapshotLayer, SnapshotProperty, SnapshotReply } from "./snapshot-reply.js";
import { hostStepOf, NO_STEP } from "./host-step.js";
import type { HostStep } from "./host-step.js";
import { requestOf } from "./plan-request.js";
import type { Request } from "./plan-request.js";

interface PlanIds {
  readonly comps: ReadonlyMap<string, string>;
  readonly layers: ReadonlyMap<string, string>;
  readonly items: ReadonlyMap<string, string>;
  readonly masks: ReadonlySet<string>;
  readonly groups: ReadonlySet<string>;
}

/** Everything a verifier resolves ids and rows through; built once per verification. */
export interface VerifyContext {
  readonly requests: ReadonlyArray<Request>;
  readonly steps: ReadonlyArray<HostStep>;
  readonly comps: ReadonlyArray<SnapshotComposition>;
  readonly items: ReadonlyArray<SnapshotItem>;
  readonly before: SnapshotReply;
  readonly ids: PlanIds;
  readonly snapshotTruncated: boolean;
}

/** One operation and the evidence for it, with the layer it addresses as far as the fresh read finds it. */
export interface LayerLookup {
  readonly request: Request;
  readonly step: HostStep;
  readonly index: number;
  readonly ctx: VerifyContext;
  readonly compId: string | undefined;
  readonly layerId: string | undefined;
  readonly comp: SnapshotComposition | null;
  readonly layer: SnapshotLayer | null;
}

/** A layer operation whose composition and layer are both in the fresh read. */
export interface LayerState extends LayerLookup {
  readonly comp: SnapshotComposition;
  readonly layer: SnapshotLayer;
}

/** The key a layer id is remembered under: the composition it was created in and the id the plan used. */
export function layerKey(compId: string | undefined, layerId: string | undefined): string {
  return `${compId ?? ""}:${layerId ?? ""}`;
}

function remember(map: Map<string, string>, key: string | undefined, value: string | undefined): void {
  if (key && value) map.set(key, value);
}

function rememberLayers(layers: Map<string, string>, step: HostStep): void {
  const kinds = ["create_layer", "duplicate_layer", "derive_layer", "precompose_layers"];
  if (step.operation && kinds.includes(step.operation) && step.requestedLayerId && step.layerId && step.compositionId) layers.set(layerKey(step.compositionId, step.requestedLayerId), step.layerId);
}

function rememberItems(items: Map<string, string>, step: HostStep): void {
  if (step.operation === "create_folder") remember(items, step.requestedFolderId, step.folderId);
  if (step.operation === "import_file" || step.operation === "create_vector_artwork") remember(items, step.requestedItemId, step.itemId);
}

function rememberComps(comps: Map<string, string>, step: HostStep): void {
  if (step.operation === "create_composition" || step.operation === "duplicate_composition") remember(comps, step.requestedCompositionId, step.compositionId);
  if (step.operation === "precompose_layers") remember(comps, step.requestedNewCompositionId, step.newCompositionId);
}

function rememberStructures(ids: { masks: Set<string>; groups: Set<string> }, step: HostStep): void {
  if (!step.compositionId || !step.layerId) return;
  const where = layerKey(step.compositionId, step.layerId);
  if (step.operation === "add_mask" && step.requestedMaskId) ids.masks.add(`${where}:${step.requestedMaskId}`);
  if (step.operation === "create_shape_group" && step.requestedGroupId) ids.groups.add(`${where}:${step.requestedGroupId}`);
}

function planIdsOf(steps: ReadonlyArray<HostStep>): PlanIds {
  const ids = { comps: new Map<string, string>(), layers: new Map<string, string>(), items: new Map<string, string>(), masks: new Set<string>(), groups: new Set<string>() };
  for (const step of steps) {
    rememberComps(ids.comps, step);
    rememberLayers(ids.layers, step);
    rememberItems(ids.items, step);
    rememberStructures(ids, step);
  }
  return ids;
}

function stepRows(hostSteps: ReadonlyArray<JsonObject | undefined>, count: number): HostStep[] {
  return Array.from({ length: Math.max(count, hostSteps.length) }, (_, index) => {
    const row = hostSteps[index];
    return row ? hostStepOf(row) : NO_STEP;
  });
}

/** The pre-apply snapshot, the fresh read and the plan's evidence, decoded once. */
export function makeVerifyContext(input: { readonly operations: ReadonlyArray<JsonObject>; readonly hostSteps: ReadonlyArray<JsonObject | undefined>; readonly before: SnapshotReply }, verification: SnapshotReply): VerifyContext {
  const steps = stepRows(input.hostSteps, input.operations.length);
  const fresh = verification.ok === true ? verification.result : undefined;
  return {
    requests: input.operations.map(requestOf),
    steps,
    comps: fresh?.compositions ?? [],
    items: fresh?.items ?? [],
    before: input.before,
    ids: planIdsOf(steps),
    snapshotTruncated: verification.ok === true && (verification.warnings ?? []).includes("composition-count-limit"),
  };
}

/** The composition the fresh read holds under an id the plan used or the host assigned. */
export function compOf(ctx: VerifyContext, id: string | undefined): SnapshotComposition | null {
  return findById(ctx.comps, id === undefined ? undefined : ctx.ids.comps.get(id) || id);
}

/** The project item the fresh read holds under an id the plan used or the host assigned. */
export function itemOf(ctx: VerifyContext, id: string | undefined): SnapshotItem | null {
  return findById(ctx.items, id === undefined ? undefined : ctx.ids.items.get(id) || id);
}

/** The id the host gave a layer the plan created in `compId` under `id`, else `id` itself. */
export function realLayerId(ctx: VerifyContext, compId: string | undefined, id: string | undefined): string | undefined {
  return id === undefined ? id : ctx.ids.layers.get(layerKey(compId, id)) || id;
}

/** The layer of a composition with this id. */
export function layerIn(comp: SnapshotComposition | null | undefined, id: string | undefined): SnapshotLayer | null {
  return findById(comp?.layers, id);
}

/** The property row of a layer at this path. */
export function propertyOf(layer: SnapshotLayer | null | undefined, path: string | undefined): SnapshotProperty | null {
  return findByPath(layer?.propertyPaths, path);
}

/** The value a property held in the read taken before the plan ran. */
export function preApplyValue(ctx: VerifyContext, compId: string, layerId: string, path: string | undefined): SnapshotProperty["value"] {
  const comp = findById(ctx.before.result?.compositions, compId);
  return propertyOf(layerIn(comp, layerId), path)?.value;
}

interface PlanStep {
  readonly step: HostStep;
  readonly request: Request;
}

function planStepAt(ctx: VerifyContext, index: number): PlanStep | null {
  const step = ctx.steps[index];
  const request = ctx.requests[index];
  return step && request ? { step, request } : null;
}

/** The index of the first step after `index` that `matches`, or -1 when none does. */
export function firstLaterIndex(ctx: VerifyContext, index: number, matches: (later: PlanStep) => boolean): number {
  for (let at = index + 1; at < ctx.steps.length; at += 1) {
    const later = planStepAt(ctx, at);
    if (later && matches(later)) return at;
  }
  return -1;
}

/** The index of the last step after `index` that `matches`, or -1 when none does. */
export function lastLaterIndex(ctx: VerifyContext, index: number, matches: (later: PlanStep) => boolean): number {
  for (let at = ctx.steps.length - 1; at > index; at -= 1) {
    const later = planStepAt(ctx, at);
    if (later && matches(later)) return at;
  }
  return -1;
}

function puppetCarrier(request: Request, step: HostStep): string | undefined {
  return request.operation === "set_puppet_pins" && step.carrierLayerId ? step.carrierLayerId : undefined;
}

/** Resolves the composition and layer an operation addresses against the fresh read. */
export function lookupLayer(ctx: VerifyContext, index: number): LayerLookup {
  const request = ctx.requests[index] ?? requestOf({ operation: "" });
  const step = ctx.steps[index] ?? NO_STEP;
  const compId = step.compositionId || request.compositionId;
  const comp = compOf(ctx, compId);
  const requestedLayerId = step.layerId || request.layerId;
  const layerId = puppetCarrier(request, step) || ctx.ids.layers.get(layerKey(compId, request.layerId || requestedLayerId)) || requestedLayerId;
  return { request, step, index, ctx, compId, layerId, comp, layer: layerIn(comp, layerId) };
}

/** The layer lookup narrowed to the case where both rows were found. */
export function foundLayer(lookup: LayerLookup): LayerState | null {
  const { comp, layer } = lookup;
  return comp && layer ? { ...lookup, comp, layer } : null;
}

/** The composition and layer ids every layer verdict names. */
export function layerWhere(state: LayerState): { readonly compositionId: string; readonly layerId: string } {
  return { compositionId: state.comp.id, layerId: state.layer.id };
}
