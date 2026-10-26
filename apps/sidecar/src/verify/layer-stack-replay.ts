/**
 * Layer-stack operations later in the same batch move the layers an earlier reorder placed: After Effects puts every new
 * layer on top, so a reorder to the beginning followed by two creates leaves the reordered layer third. The final snapshot
 * is therefore compared with the order the batch's own stack operations add up to, not with the moment of the reorder.
 */
import type { HostStep } from "./host-step.js";
import type { Request } from "./plan-request.js";
import { findById } from "./snapshot-index.js";
import { realLayerId } from "./verify-context.js";
import type { LayerState } from "./verify-context.js";

type StackReplayVerdict = { verdict: "match" | "mismatch" | "unknown"; expected?: number; observed?: number };

interface Replay {
  order: string[];
  uncertain: Set<string>;
  tainted: boolean;
}

interface StackStep {
  operation: Request;
  step: HostStep;
  resolve: (id: string | undefined) => string | undefined;
}

interface IndexedLayer {
  readonly id: string;
  readonly index?: number | undefined;
}

function orderedIds(layers: ReadonlyArray<IndexedLayer>): string[] | null {
  const indexed = layers.flatMap((layer) => (layer.index === undefined ? [] : [{ id: layer.id, index: layer.index }]));
  if (indexed.length !== layers.length) return null;
  return indexed.sort((a, b) => a.index - b.index).map((layer) => layer.id);
}

function preBatchOrder(state: LayerState): string[] | null {
  const comp = findById(state.ctx.before.result?.compositions, state.comp.id);
  return comp && comp.truncated !== true && comp.layers ? orderedIds(comp.layers) : null;
}

function insertRelative(replay: Replay, id: string, referenceId: string | undefined, below: boolean): boolean {
  const at = referenceId ? replay.order.indexOf(referenceId) : -1;
  if (at < 0) return false;
  replay.order.splice(at + (below ? 1 : 0), 0, id);
  return true;
}

function applyReorder(replay: Replay, operation: Request, id: string, referenceId: string | undefined): boolean {
  const from = replay.order.indexOf(id);
  if (from < 0) return false;
  replay.order.splice(from, 1);
  if (replay.uncertain.has(id) || (referenceId && replay.uncertain.has(referenceId))) replay.tainted = true;
  if (operation.placement === "beginning") replay.order.unshift(id);
  else if (operation.placement === "end") replay.order.push(id);
  else if (!insertRelative(replay, id, referenceId, operation.placement === "after")) return false;
  return true;
}

function applyCreate(replay: Replay, created: string | undefined): boolean {
  if (created) replay.order.unshift(created);
  return !!created;
}

function applyCopy(replay: Replay, stack: StackStep, created: string | undefined): boolean {
  if (!created || !insertRelative(replay, created, stack.resolve(stack.operation.layerId), false)) return false;
  replay.uncertain.add(created);
  return true;
}

function applyStackStep(replay: Replay, stack: StackStep): boolean {
  const created = typeof stack.step.layerId === "string" ? stack.step.layerId : undefined;
  const target = stack.resolve(stack.operation.layerId);
  switch (stack.operation.operation) {
    case "create_layer":
      return applyCreate(replay, created);
    case "duplicate_layer":
    case "derive_layer":
      return applyCopy(replay, stack, created);
    case "remove_layer":
      replay.order = replay.order.filter((id) => id !== target);
      return true;
    case "reorder_layer":
      return !!target && applyReorder(replay, stack.operation, target, stack.resolve(stack.operation.referenceLayerId));
    default:
      return true;
  }
}

function batchComp(state: LayerState, operation: Request, step: HostStep | undefined): string | undefined {
  const compId = step?.compositionId || operation.compositionId;
  return compId !== undefined && (state.ctx.ids.comps.get(compId) ?? compId) === state.comp.id ? compId : undefined;
}

function replayBatch(state: LayerState, start: string[]): Replay | null {
  const { ctx } = state;
  const replay: Replay = { order: start, uncertain: new Set(), tainted: false };
  for (const [index, operation] of ctx.requests.entries()) {
    const step = ctx.steps[index];
    const compId = batchComp(state, operation, step);
    if (!step || compId === undefined) continue;
    if (!applyStackStep(replay, { operation, step, resolve: (id) => realLayerId(ctx, compId, id) })) return null;
  }
  return replay;
}

function judgePosition(replay: Replay, final: string[], target: string): StackReplayVerdict | null {
  const settled = (ids: string[]): string[] => ids.filter((id) => !replay.uncertain.has(id));
  const expectedOrder = settled(replay.order);
  const observedOrder = settled(final);
  if (expectedOrder.length !== observedOrder.length || expectedOrder.some((id) => !observedOrder.includes(id))) return null;
  const expected = expectedOrder.indexOf(target);
  const observed = observedOrder.indexOf(target);
  if (expected < 0 || observed < 0) return null;
  if (replay.tainted) return { verdict: "unknown" };
  return { verdict: expected === observed ? "match" : "mismatch", expected: expected + 1, observed: observed + 1 };
}

/**
 * Replays the batch's stack operations over the pre-batch order and judges where `state.layer` must end up; null when no
 * replay applies. Where a copy lands is not asserted: it is left out of both orders and taints any reorder that touches it.
 */
export function replayedLayerPosition(state: LayerState): StackReplayVerdict | null {
  const { comp } = state;
  const start = preBatchOrder(state);
  const final = comp.truncated === true || !comp.layers ? null : orderedIds(comp.layers);
  const replay = start && final ? replayBatch(state, start) : null;
  if (!replay || !final) return null;
  return replay.uncertain.has(state.layer.id) ? { verdict: "unknown" } : judgePosition(replay, final, state.layer.id);
}
