// Keyframe assistants computed here, so the keys they produce are ordinary animate_property and set_layer_timing values: sequence layers, wiggle and smooth.
import { firstProblem, round3, solverFailure } from "./types.js";
import type { SolverFailure } from "./types.js";

type KeyValue = number | ReadonlyArray<number>;

interface AssistantKeyframe {
  readonly time: number;
  readonly value: KeyValue;
}

interface SequenceLayerInput {
  readonly layerId: string;
  readonly inPoint: number;
  readonly outPoint: number;
  readonly startTime: number;
}

/**
 * Layers in the order they should play, each keeping its own duration. `overlap` is the seconds each layer starts before the previous one ends
 * (negative leaves a gap, default 0); `startTime` is the in point of the first layer played (default the first layer's current in point);
 * `reverse` plays the listed layers back to front.
 */
export interface SequenceInput {
  readonly layers: ReadonlyArray<SequenceLayerInput>;
  readonly overlap?: number;
  readonly startTime?: number;
  readonly reverse?: boolean;
}

interface SequenceItem {
  readonly layerId: string;
  readonly shift: number;
  readonly inPoint: number;
  readonly outPoint: number;
  readonly startTime: number;
}

interface SequenceResult {
  readonly ok: true;
  readonly items: ReadonlyArray<SequenceItem>;
  readonly end: number;
}

/**
 * A wiggle request. `frequency` is keys per second (0.01..60); `amplitude` is the largest offset from `base`, per component (one number applies to every component);
 * `seed` is an integer so the same seed gives the same keys (default 1); `settle` pins the first and last key exactly to `base`.
 */
export interface WiggleInput {
  readonly base: KeyValue;
  readonly frequency: number;
  readonly amplitude: KeyValue;
  readonly startTime: number;
  readonly duration: number;
  readonly seed?: number;
  readonly settle?: boolean;
}

/** Keys to thin out; `tolerance` is the largest allowed distance, in property units, between the original curve and the kept keys. */
export interface SmoothInput {
  readonly keyframes: ReadonlyArray<AssistantKeyframe>;
  readonly tolerance: number;
}

interface KeyframeResult {
  readonly ok: true;
  readonly keyframes: ReadonlyArray<AssistantKeyframe>;
  readonly removed?: number;
}

const MAX_SECONDS = 86_400;
const MAX_KEYS = 2_000;
const MAX_COMPONENTS = 3;
const MAX_SEQUENCE_LAYERS = 1_000;
const MAX_SEED = 2_147_483_647;

function inRange(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}

function componentsOf(value: KeyValue): ReadonlyArray<number> | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? [value] : undefined;
  return value.length >= 1 && value.length <= MAX_COMPONENTS && value.every(Number.isFinite) ? value : undefined;
}

function shaped(values: ReadonlyArray<number>, like: KeyValue): KeyValue {
  return typeof like === "number" ? round3(values[0] ?? 0) : values.map(round3);
}

function sequenceLayerProblem(layer: SequenceLayerInput, index: number): string | undefined {
  if (layer.layerId.length === 0) return `layers[${index}] needs a layerId.`;
  const timings = [layer.inPoint, layer.outPoint, layer.startTime];
  if (!timings.every((timing) => inRange(timing, -MAX_SECONDS, MAX_SECONDS))) return `layers[${index}] needs numeric inPoint, outPoint and startTime (read them from ae_inspect_layer).`;
  return layer.outPoint > layer.inPoint ? undefined : `layers[${index}] outPoint must be after inPoint.`;
}

function sequenceOptionProblem(input: SequenceInput): string | undefined {
  if (input.overlap !== undefined && !inRange(input.overlap, -MAX_SECONDS, MAX_SECONDS)) return "overlap must be a number of seconds.";
  return input.startTime === undefined || inRange(input.startTime, 0, MAX_SECONDS) ? undefined : "startTime must be 0 to 86400 seconds.";
}

function sequenceProblem(input: SequenceInput): string | undefined {
  if (input.layers.length < 2 || input.layers.length > MAX_SEQUENCE_LAYERS) return "layers must list 2 to 1000 layers.";
  const early = input.layers.map(sequenceLayerProblem).find((message) => message !== undefined) ?? sequenceOptionProblem(input);
  if (early) return early;
  const shortest = Math.min(...input.layers.map((layer) => layer.outPoint - layer.inPoint));
  return (input.overlap ?? 0) < shortest ? undefined : "overlap must be shorter than the shortest layer.";
}

function firstInPoint(startTime: number | undefined, ordered: ReadonlyArray<SequenceLayerInput>): number {
  return startTime ?? ordered[0]?.inPoint ?? 0;
}

function placeLayers(layers: ReadonlyArray<SequenceLayerInput>, firstInPoint: number, overlap: number): ReadonlyArray<SequenceItem> {
  let cursor = firstInPoint;
  return layers.map((layer): SequenceItem => {
    const shift = cursor - layer.inPoint;
    const outPoint = cursor + (layer.outPoint - layer.inPoint);
    const item = { layerId: layer.layerId, shift: round3(shift), inPoint: round3(cursor), outPoint: round3(outPoint), startTime: round3(layer.startTime + shift) };
    cursor = outPoint - overlap;
    return item;
  });
}

/** Each layer starts where the previous one ends, less the overlap; the layer's own duration and start offset are kept. */
export function solveSequenceLayers(input: SequenceInput): SequenceResult | SolverFailure {
  const problem = sequenceProblem(input);
  if (problem) return solverFailure(problem);
  const ordered = input.reverse ? [...input.layers].reverse() : input.layers;
  const items = placeLayers(ordered, firstInPoint(input.startTime, ordered), input.overlap ?? 0);
  return { ok: true, items, end: items[items.length - 1]?.outPoint ?? 0 };
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function wiggleShapeProblem(input: WiggleInput): string | undefined {
  const base = componentsOf(input.base);
  if (!base) return "base must be a number or an array of 1 to 3 numbers.";
  const amplitude = componentsOf(input.amplitude);
  return amplitude && (amplitude.length === 1 || amplitude.length === base.length) ? undefined : "amplitude must be one number or match base's length.";
}

function wiggleTimingProblem(input: WiggleInput): string | undefined {
  if (!inRange(input.frequency, 0.01, 60)) return "frequency must be 0.01 to 60 keys per second.";
  if (!inRange(input.startTime, 0, MAX_SECONDS) || !inRange(input.duration, 0.01, MAX_SECONDS)) return "startTime must be 0 to 86400 and duration 0.01 to 86400 seconds.";
  if (input.seed !== undefined && !(Number.isInteger(input.seed) && inRange(input.seed, 0, MAX_SEED))) return "seed must be a non-negative integer.";
  return Math.round(input.duration * input.frequency) + 1 <= MAX_KEYS ? undefined : `frequency and duration would write more than ${MAX_KEYS} keys.`;
}

/** Keys at an even rhythm, each a seeded random offset from base; settle pins the first and last key to base. */
export function solveWiggle(input: WiggleInput): KeyframeResult | SolverFailure {
  const problem = firstProblem([() => wiggleShapeProblem(input), () => wiggleTimingProblem(input)]);
  if (problem) return solverFailure(problem);
  const base = componentsOf(input.base) ?? [];
  const amplitude = componentsOf(input.amplitude) ?? [];
  const random = seededRandom(input.seed ?? 1);
  const count = Math.max(2, Math.round(input.duration * input.frequency) + 1);
  const keyframes = Array.from({ length: count }, (_, index): AssistantKeyframe => {
    const rest = input.settle === true && (index === 0 || index === count - 1);
    const values = base.map((component, axis) => component + (rest ? 0 : (random() * 2 - 1) * (amplitude[amplitude.length === 1 ? 0 : axis] ?? 0)));
    return { time: round3(input.startTime + (input.duration * index) / (count - 1)), value: shaped(values, input.base) };
  });
  return { ok: true, keyframes };
}

function smoothKeyProblem(keys: ReadonlyArray<AssistantKeyframe>, index: number, size: number | undefined): string | undefined {
  const key = keys[index];
  const previous = keys[index - 1];
  if (!key || !Number.isFinite(key.time) || componentsOf(key.value)?.length !== size) return `keyframes[${index}] needs a finite time and a value of the same size as the first.`;
  return previous && key.time <= previous.time ? "keyframe times must be strictly increasing." : undefined;
}

function smoothProblem(input: SmoothInput): string | undefined {
  if (input.keyframes.length < 3 || input.keyframes.length > MAX_KEYS) return `keyframes must list 3 to ${MAX_KEYS} keys.`;
  if (!inRange(input.tolerance, 1e-9, 1e9)) return "tolerance must be a positive number in the property's units.";
  const first = input.keyframes[0];
  const size = first ? componentsOf(first.value)?.length : undefined;
  return input.keyframes.map((_, index) => smoothKeyProblem(input.keyframes, index, size)).find((message) => message !== undefined);
}

function distanceFromLine(keys: ReadonlyArray<AssistantKeyframe>, span: readonly [number, number], index: number): number {
  const first = keys[span[0]];
  const last = keys[span[1]];
  const key = keys[index];
  if (!first || !last || !key) return 0;
  const along = (key.time - first.time) / (last.time - first.time);
  const start = componentsOf(first.value) ?? [];
  const end = componentsOf(last.value) ?? [];
  const at = componentsOf(key.value) ?? [];
  return Math.max(...at.map((component, axis) => Math.abs(component - ((start[axis] ?? 0) + ((end[axis] ?? 0) - (start[axis] ?? 0)) * along))));
}

function strayingKey(keys: ReadonlyArray<AssistantKeyframe>, span: readonly [number, number], tolerance: number): number | undefined {
  let worst: number | undefined;
  let worstDistance = tolerance;
  for (let index = span[0] + 1; index < span[1]; index += 1) {
    const distance = distanceFromLine(keys, span, index);
    if (distance > worstDistance) {
      worst = index;
      worstDistance = distance;
    }
  }
  return worst;
}

function keptIndexes(keys: ReadonlyArray<AssistantKeyframe>, tolerance: number): ReadonlyArray<number> {
  const kept = new Set<number>([0, keys.length - 1]);
  const pending: Array<readonly [number, number]> = [[0, keys.length - 1]];
  for (let span = pending.pop(); span; span = pending.pop()) {
    const worst = strayingKey(keys, span, tolerance);
    if (worst === undefined) continue;
    kept.add(worst);
    pending.push([span[0], worst], [worst, span[1]]);
  }
  return [...kept].sort((left, right) => left - right);
}

/** Fewer keys that follow the original curve within the tolerance, like After Effects' Smoother but with a stated bound (Ramer-Douglas-Peucker over time). */
export function solveSmooth(input: SmoothInput): KeyframeResult | SolverFailure {
  const problem = smoothProblem(input);
  if (problem) return solverFailure(problem);
  const keyframes = keptIndexes(input.keyframes, input.tolerance)
    .map((index) => input.keyframes[index])
    .filter((key): key is AssistantKeyframe => key !== undefined)
    .map((key) => ({ time: round3(key.time), value: shaped(componentsOf(key.value) ?? [], key.value) }));
  return { ok: true, keyframes, removed: input.keyframes.length - keyframes.length };
}
