// The finished-film gate: a job that built a master composition is not complete while the master draws nothing for a stretch, a shot holds only a background, built content is unplaced, or a host failure was never fixed.
import type { ProjectSnapshot } from "@extynt/project-graph";
import type { WorkflowId } from "@extynt/workflow";
import { requestScale } from "./server-workflow-checklist.js";

/** The code completion is refused with while the finished film does not hold up. */
export const FILM_INCOMPLETE = "FILM_INCOMPLETE";

type Snapshot = Pick<ProjectSnapshot, "compositions">;
type Comp = Snapshot["compositions"][number];
type Layer = Comp["layers"][number];
type Property = Layer["properties"][number];

/** The fields of an admitted operation the film gate reads. */
export interface FilmPayload {
  readonly type?: string;
  readonly name?: string;
  readonly newCompositionName?: string;
  readonly newCompositionId?: string;
  readonly compositionId?: string;
  readonly inPoint?: number;
  readonly outPoint?: number;
  readonly startTime?: number;
  readonly target?: { readonly layerId?: string; readonly compositionId?: string; readonly itemId?: string };
}
interface FilmOutcome {
  readonly operationId: string;
  readonly type: string;
  readonly outcome: string;
  readonly basis?: string;
  readonly readback?: { readonly targetLayerId?: string };
}
interface FilmBatch {
  readonly operationIds: readonly string[];
  readonly recovery: { readonly state: string };
  readonly execution: { readonly receipt: { readonly outcomes: readonly FilmOutcome[]; readonly createdBindings?: ReadonlyArray<{ readonly placeholder: string; readonly createdId: string }> } | null };
}

/** The part of the workflow state the film gate reads: the job's goal and batches, and the operation payloads they ran. */
export interface FilmState {
  readonly jobs: Readonly<Record<string, { readonly goalSummary: string; readonly batchIds: readonly string[] } | undefined>>;
  readonly batches: Readonly<Record<string, FilmBatch | undefined>>;
  readonly operations: Readonly<Record<string, { readonly payload: FilmPayload } | undefined>>;
}

/** What the film gate reads: the workflow store and the latest project snapshot. */
export interface FilmGateDeps {
  readonly state: { readonly workflowCoordinator: { readonly workflowStore: { getState(): FilmState } } };
  readonly planState: { normalizedLatest(): Snapshot | undefined | null };
}

interface CreatedComp { readonly id: string; readonly name: string }
interface Failure { readonly type: string; readonly basis: string; readonly key: string; readonly order: number; readonly layerId: string | undefined; readonly compositionId: string | undefined }
interface Success { readonly type: string; readonly key: string; readonly order: number }
interface Reached { readonly comp: Comp; readonly layer: Layer }

const FILM_SAMPLE_SECONDS = 2;
const FILM_EMPTY_SHARE = 0.15;
const MAX_SAMPLES = 60;
const MAX_NAMED = 6;
const MAX_DEPTH = 4;
const HALF_FRAME_FALLBACK = 0.02;
const BACKGROUND_NAME = /^(bg|background|backdrop|solid|bg[_ -])/i;
const NON_DRAWING: ReadonlySet<string> = new Set(["null", "adjustment", "camera", "light"]);
const CREATING: ReadonlySet<string> = new Set(["create_composition", "precompose_layers"]);
const FAILING: ReadonlySet<string> = new Set(["readback_mismatch", "failed_during_apply"]);
const SUCCEEDED: ReadonlySet<string> = new Set(["confirmed", "host_confirmed", "coerced_equivalent"]);
const FAILURE_HINTS: ReadonlyMap<string, string> = new Map([
  ["layer-timing-mismatch", "move a clip with startTime (its in and out follow it), and note a precomp layer cannot show more than its source comp's length unless that comp is lengthened"],
  ["precomp-missing", "the precomposition is not in the project, so build the shot comp directly or redo precompose_layers on layers that exist"],
]);

function standingBatches(state: FilmState, jobId: WorkflowId): FilmBatch[] {
  const batches = (state.jobs[jobId]?.batchIds ?? []).map((batchId) => state.batches[batchId]);
  return batches.filter((batch): batch is FilmBatch => !!batch && batch.recovery.state !== "undone" && batch.recovery.state !== "undo_unverified");
}

function findProperty(properties: readonly Property[], matchName: string): Property | undefined {
  for (const property of properties) {
    if (property.matchName === matchName) return property;
    const nested = property.children ? findProperty(property.children, matchName) : undefined;
    if (nested) return nested;
  }
  return undefined;
}

function hasKeyframes(property: Property): boolean {
  return (property.keyframes?.length ?? property.keyframeCount ?? 0) > 0;
}

function visible(layer: Layer): boolean {
  const opacity = findProperty(layer.properties, "ADBE Opacity");
  if (!opacity) return true;
  const animated = hasKeyframes(opacity) || (opacity.expressionEnabled === true && !!opacity.expression);
  return animated || typeof opacity.value !== "number" || opacity.value > 0;
}

function compOf(snapshot: Snapshot, id: string | null | undefined): Comp | undefined {
  return id ? snapshot.compositions.find((comp) => comp.id === id) : undefined;
}

function timeRemapped(layer: Layer): boolean {
  const remap = findProperty(layer.properties, "ADBE Time Remapping");
  return !!remap && remap.enabled !== false && (hasKeyframes(remap) || remap.expressionEnabled === true);
}

function spans(layer: Layer, time: number): boolean {
  return layer.enabled !== false && !NON_DRAWING.has(layer.type) && visible(layer) && time >= layer.inPoint - HALF_FRAME_FALLBACK && time < layer.outPoint;
}

function showsSource(snapshot: Snapshot, layer: Layer, at: { readonly time: number; readonly depth: number }): boolean {
  const source = compOf(snapshot, layer.compositionSourceId);
  if (!source || at.depth >= MAX_DEPTH) return true;
  if (timeRemapped(layer)) return source.layers.some((inner) => inner.enabled !== false && !NON_DRAWING.has(inner.type));
  const local = (at.time - layer.startTime) / ((layer.stretch || 100) / 100);
  return drawsAt(snapshot, source, { time: Math.max(0, local), depth: at.depth + 1 });
}

function drawsAt(snapshot: Snapshot, comp: Comp, at: { readonly time: number; readonly depth: number }): boolean {
  return comp.layers.some((layer) => spans(layer, at.time) && showsSource(snapshot, layer, at));
}

const second = (value: number): string => `${Math.round(value * 10) / 10}`;

function sampleStep(duration: number): number {
  return duration <= 8 ? duration / 4 : Math.max(FILM_SAMPLE_SECONDS, duration / MAX_SAMPLES);
}

function appendRange(ranges: Array<[number, number]>, from: number, to: number): void {
  const last = ranges.at(-1);
  if (last && Math.abs(last[1] - from) < 1e-6) last[1] = to;
  else ranges.push([from, to]);
}

function emptyRanges(snapshot: Snapshot, master: Comp): { readonly ranges: ReadonlyArray<readonly [number, number]>; readonly empty: number; readonly total: number } {
  const step = sampleStep(master.duration);
  const total = Math.max(1, Math.ceil(master.duration / step - 1e-9));
  const ranges: Array<[number, number]> = [];
  let empty = 0;
  for (let index = 0; index < total; index += 1) {
    const from = index * step, to = Math.min(master.duration, from + step);
    if (drawsAt(snapshot, master, { time: (from + to) / 2, depth: 0 })) continue;
    empty += 1;
    appendRange(ranges, from, to);
  }
  return { ranges, empty, total };
}

function backgroundOnly(comp: Comp): boolean {
  const [only, ...rest] = comp.layers;
  if (!only) return true;
  if (rest.length > 0 || only.compositionSourceId || only.type === "text") return false;
  return only.type === "av" || BACKGROUND_NAME.test(only.name);
}

function boundId(bindings: ReadonlyMap<string, string>, placeholder: string | undefined): string | undefined {
  return placeholder ? bindings.get(placeholder) ?? bindings.get(`__new__:${placeholder.replace(/^__new__:/, "")}`) : undefined;
}

function creationOf(payload: FilmPayload | undefined, bindings: ReadonlyMap<string, string>, snapshot: Snapshot): CreatedComp | undefined {
  if (!payload?.type || !CREATING.has(payload.type)) return undefined;
  const name = payload.name ?? payload.newCompositionName;
  const comp = compOf(snapshot, boundId(bindings, payload.newCompositionId)) ?? (name ? snapshot.compositions.find((candidate) => candidate.name === name) : undefined);
  return comp ? { id: comp.id, name: comp.name } : undefined;
}

function jobCreatedComps(state: FilmState, jobId: WorkflowId, snapshot: Snapshot): CreatedComp[] {
  const found = new Map<string, CreatedComp>();
  for (const batch of standingBatches(state, jobId)) {
    const bindings = new Map((batch.execution.receipt?.createdBindings ?? []).map((binding) => [binding.placeholder, binding.createdId]));
    for (const operationId of batch.operationIds) {
      const made = creationOf(state.operations[operationId]?.payload, bindings, snapshot);
      if (made) found.set(made.id, made);
    }
  }
  return [...found.values()];
}

function referencedComps(snapshot: Snapshot, root: Comp): Map<string, Reached> {
  const reached = new Map<string, Reached>();
  const walk = (comp: Comp, depth: number): void => {
    if (depth > MAX_DEPTH + 2) return;
    for (const layer of comp.layers) {
      const source = compOf(snapshot, layer.compositionSourceId);
      if (!source || source.id === root.id || reached.has(source.id)) continue;
      reached.set(source.id, { comp: source, layer });
      walk(source, depth + 1);
    }
  };
  walk(root, 0);
  return reached;
}

function jobMaster(snapshot: Snapshot, created: readonly CreatedComp[]): Comp | undefined {
  const comps = created.map((entry) => compOf(snapshot, entry.id)).filter((comp): comp is Comp => !!comp);
  const placed = new Set(comps.flatMap((comp) => comp.layers.map((layer) => layer.compositionSourceId).filter((id): id is string => !!id)));
  const roots = comps.filter((comp) => !placed.has(comp.id));
  return (roots.length ? roots : comps).sort((left, right) => right.duration - left.duration)[0];
}

function targetIds(payload: FilmPayload | undefined, readbackLayer: string | undefined): { layerId: string | undefined; compositionId: string | undefined } {
  const target = payload?.target;
  return { layerId: target?.layerId ?? readbackLayer, compositionId: target?.compositionId ?? payload?.compositionId };
}

function targetKey(payload: FilmPayload | undefined, readbackLayer: string | undefined): { key: string; layerId: string | undefined; compositionId: string | undefined } {
  const { layerId, compositionId } = targetIds(payload, readbackLayer);
  return { key: layerId ? `${compositionId ?? ""}:${layerId}` : payload?.newCompositionId ?? "", layerId, compositionId };
}

function sortedOutcomes(state: FilmState, jobId: WorkflowId): { failures: Failure[]; successes: Success[] } {
  const failures: Failure[] = [];
  const successes: Success[] = [];
  const outcomes = standingBatches(state, jobId).flatMap((batch) => batch.execution.receipt?.outcomes ?? []);
  outcomes.forEach((outcome, index) => {
    const order = index + 1;
    const target = targetKey(state.operations[outcome.operationId]?.payload, outcome.readback?.targetLayerId);
    if (FAILING.has(outcome.outcome)) failures.push({ type: outcome.type, basis: outcome.basis ?? "read-back mismatch", order, ...target });
    else if (SUCCEEDED.has(outcome.outcome)) successes.push({ type: outcome.type, key: target.key, order });
  });
  return { failures, successes };
}

function fixedLater(failure: Failure, successes: readonly Success[]): boolean {
  return successes.some((success) => success.type === failure.type && success.order > failure.order && (!failure.key || !success.key || success.key === failure.key));
}

function firstTimingAsk(state: FilmState, jobId: WorkflowId, layerId: string): FilmPayload | undefined {
  const operationIds = (state.jobs[jobId]?.batchIds ?? []).flatMap((batchId) => state.batches[batchId]?.operationIds ?? []);
  const payloads = operationIds.map((operationId) => state.operations[operationId]?.payload);
  return payloads.find((payload) => payload?.type === "set_layer_timing" && targetKey(payload, undefined).layerId === layerId);
}

function layerOfFailure(snapshot: Snapshot, failure: Failure): { comp: Comp; layer: Layer } | undefined {
  const comp = compOf(snapshot, failure.compositionId) ?? snapshot.compositions.find((candidate) => candidate.layers.some((layer) => layer.id === failure.layerId));
  const layer = comp?.layers.find((candidate) => candidate.id === failure.layerId);
  return comp && layer ? { comp, layer } : undefined;
}

function timingMatches(found: { comp: Comp; layer: Layer }, asked: FilmPayload): boolean {
  const tolerance = 0.5 / (found.comp.frameRate || 25);
  const same = (observed: number, wanted: number | undefined): boolean => wanted === undefined || Math.abs(observed - wanted) <= tolerance;
  return same(found.layer.inPoint, asked.inPoint) && same(found.layer.outPoint, asked.outPoint) && same(found.layer.startTime, asked.startTime);
}

function timingNowHolds(state: FilmState, jobId: WorkflowId, at: { readonly snapshot: Snapshot; readonly failure: Failure }): boolean {
  const { snapshot, failure } = at;
  if (!failure.layerId) return false;
  const found = layerOfFailure(snapshot, failure);
  if (!found) return true;
  const asked = firstTimingAsk(state, jobId, failure.layerId);
  return asked !== undefined && timingMatches(found, asked);
}

/** The host failures of the job that nothing later fixed: a later success of the same operation type on the same target, or a layer timing that now holds, resolves one. */
export function unresolvedFailures(state: FilmState, jobId: WorkflowId, snapshot: Snapshot): Failure[] {
  const { failures, successes } = sortedOutcomes(state, jobId);
  return failures.filter((failure) => !fixedLater(failure, successes) && (failure.type !== "set_layer_timing" || !timingNowHolds(state, jobId, { snapshot, failure })));
}

function listed(names: readonly string[]): string {
  return names.length > MAX_NAMED ? `${names.slice(0, MAX_NAMED).join(", ")} and ${names.length - MAX_NAMED} more` : names.join(", ");
}

function emptyFinding(snapshot: Snapshot, master: Comp): string | undefined {
  const { ranges, empty, total } = emptyRanges(snapshot, master);
  if (empty < 2 || empty / total <= FILM_EMPTY_SHARE) return undefined;
  return `${master.name} draws nothing at ${listed(ranges.map(([from, to]) => `${second(from)}-${second(to)} s`))} (${empty} of ${total} sampled moments are empty). Place a layer or shot there with its in and out points covering it (move a clip with set_layer_timing startTime) or shorten the composition.`;
}

function hollowFinding(reached: ReadonlyMap<string, Reached>): string | undefined {
  const hollow = [...reached.values()].filter((entry) => backgroundOnly(entry.comp));
  return hollow.length ? `${hollow.length === 1 ? "A shot holds" : "Shots hold"} only a background: ${listed(hollow.map((entry) => `${entry.layer.name} (${entry.comp.name})`))}. Build the content of each into its shot comp.` : undefined;
}

function unplacedFinding(snapshot: Snapshot, created: readonly CreatedComp[], placement: { readonly master: Comp; readonly reached: ReadonlyMap<string, Reached> }): string | undefined {
  const { master, reached } = placement;
  const unplaced = created.filter((entry) => entry.id !== master.id && !reached.has(entry.id)).map((entry) => compOf(snapshot, entry.id)).filter((comp): comp is Comp => !!comp && !backgroundOnly(comp));
  if (!unplaced.length) return undefined;
  const one = unplaced.length === 1;
  return `${listed(unplaced.map((comp) => comp.name))} ${one ? "has" : "have"} content but ${one ? "is" : "are"} not placed in ${master.name}. Add ${one ? "it" : "each"} to ${master.name} as a layer timed to its slot.`;
}

function failureSentence([kind, rows]: readonly [string, readonly Failure[]]): string {
  const hint = FAILURE_HINTS.get(rows[0]?.basis ?? "");
  return `${kind} failed ${rows.length} time${rows.length === 1 ? "" : "s"} and nothing later fixed it${hint ? `: ${hint}` : ""}.`;
}

function failureFinding(failed: readonly Failure[]): string | undefined {
  if (!failed.length) return undefined;
  const kinds = new Map<string, Failure[]>();
  for (const failure of failed) kinds.set(`${failure.type} (${failure.basis})`, [...(kinds.get(`${failure.type} (${failure.basis})`) ?? []), failure]);
  return [...kinds.entries()].slice(0, 4).map(failureSentence).join(" ");
}

function filmFindings(state: FilmState, jobId: WorkflowId, snapshot: Snapshot): string[] {
  const created = jobCreatedComps(state, jobId, snapshot);
  const master = jobMaster(snapshot, created);
  if (!master) return [];
  const reached = referencedComps(snapshot, master);
  const standing = master.duration > 0 ? [emptyFinding(snapshot, master), hollowFinding(reached), unplacedFinding(snapshot, created, { master, reached })] : [];
  return [...standing, failureFinding(unresolvedFailures(state, jobId, snapshot))].filter((sentence): sentence is string => sentence !== undefined);
}

/** What completion is refused with while the finished film is empty, hollow, unplaced or carries unresolved host failures; null for a small job, a job with no master of its own, or a film that holds up. */
export function filmRefusal(deps: FilmGateDeps, jobId: WorkflowId): { code: typeof FILM_INCOMPLETE; message: string } | null {
  const state = deps.state.workflowCoordinator.workflowStore.getState();
  const goal = state.jobs[jobId]?.goalSummary;
  if (goal === undefined || requestScale(goal) === "small") return null;
  const snapshot = deps.planState.normalizedLatest();
  if (!snapshot) return null;
  const sentences = filmFindings(state, jobId, snapshot);
  return sentences.length ? { code: FILM_INCOMPLETE, message: `${sentences.join(" ")} Fix this with one bounded batch, then call ae_workflow_complete again.` } : null;
}
