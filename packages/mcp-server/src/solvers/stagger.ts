// The stagger solver: start (and end) times for a row of items whose starts are spread by a step or a total span.
import { firstProblem, round3, solverFailure } from "./types.js";
import type { SolverFailure } from "./types.js";

type StaggerOrder = "forward" | "reverse" | "center-out" | "edges-in" | "random";

type StaggerCurve = "linear" | "ease-in" | "ease-out" | "ease-in-out";

/**
 * The stagger request. `count` is the number of items (integer 1..1000; item k is the k-th layer listed), `startTime` when the first item starts (seconds, >= 0).
 * Give exactly one of `step` (seconds between consecutive start ranks) or `total` (seconds from the first start to the last). `seed` is an integer for order "random" (default 1; the same seed gives the same result).
 * `curve` spreads the start ranks non-uniformly across the span (default "linear"); a positive `itemDuration` adds ends[k] = starts[k] + itemDuration.
 */
export interface StaggerInput {
  readonly count: number;
  readonly startTime: number;
  readonly step?: number;
  readonly total?: number;
  readonly order?: StaggerOrder;
  readonly seed?: number;
  readonly curve?: StaggerCurve;
  readonly itemDuration?: number;
}

interface StaggerResult {
  readonly ok: true;
  readonly starts: ReadonlyArray<number>;
  readonly ends?: ReadonlyArray<number>;
  readonly ranks: ReadonlyArray<number>;
  readonly span: number;
  readonly end?: number;
}

const MAX_COUNT = 1000;
const MAX_SPAN_SECONDS = 3600;
const MAX_SEED = 4294967295;
const EXACTLY_ONE_OF_STEP_OR_TOTAL = "must provide exactly one of step or total";

const RANKERS: Readonly<Record<StaggerOrder, (count: number, seed: number) => ReadonlyArray<number>>> = {
  forward: (count) => Array.from({ length: count }, (_, index) => index),
  reverse: (count) => Array.from({ length: count }, (_, index) => count - 1 - index),
  "center-out": (count) => centerOutRanks(count),
  "edges-in": (count) => edgesInRanks(count),
  random: (count, seed) => randomRanks(count, seed),
};

const EASINGS: Readonly<Record<StaggerCurve, (fraction: number) => number>> = {
  linear: (fraction) => fraction,
  "ease-in": (fraction) => fraction * fraction,
  "ease-out": (fraction) => 1 - (1 - fraction) * (1 - fraction),
  "ease-in-out": (fraction) => (fraction < 0.5 ? 2 * fraction * fraction : 1 - 2 * (1 - fraction) * (1 - fraction)),
};

function countProblem(count: number): string | undefined {
  if (!Number.isInteger(count)) return "count: must be an integer";
  return count < 1 || count > MAX_COUNT ? "count: must be between 1 and 1000" : undefined;
}

function nonNegativeProblem(amount: number, name: string): string | undefined {
  if (!Number.isFinite(amount)) return `${name}: must be finite`;
  return amount < 0 ? `${name}: must be non-negative` : undefined;
}

function stepTotalProblem(step: number | undefined, total: number | undefined): string | undefined {
  if (step !== undefined && total !== undefined) return EXACTLY_ONE_OF_STEP_OR_TOTAL;
  if (step !== undefined) return nonNegativeProblem(step, "step");
  return total === undefined ? EXACTLY_ONE_OF_STEP_OR_TOTAL : nonNegativeProblem(total, "total");
}

function seedProblem(seed: number | undefined): string | undefined {
  if (seed === undefined) return undefined;
  if (!Number.isInteger(seed)) return "seed: must be an integer";
  return seed < 0 || seed > MAX_SEED ? "seed: must be between 0 and 4294967295" : undefined;
}

function itemDurationProblem(duration: number | undefined): string | undefined {
  if (duration === undefined) return undefined;
  if (!Number.isFinite(duration)) return "itemDuration: must be finite";
  return duration <= 0 ? "itemDuration: must be positive" : undefined;
}

function inputProblem(input: StaggerInput): string | undefined {
  return firstProblem([
    () => countProblem(input.count),
    () => nonNegativeProblem(input.startTime, "startTime"),
    () => stepTotalProblem(input.step, input.total),
    () => seedProblem(input.seed),
    () => itemDurationProblem(input.itemDuration),
  ]);
}

function centerOutRanks(count: number): ReadonlyArray<number> {
  const middle = (count - 1) / 2;
  const distances = Array.from({ length: count }, (_, index) => Math.round(Math.abs(index - middle) * 1e9) / 1e9);
  const rankOfDistance = new Map([...new Set(distances)].sort((left, right) => left - right).map((distance, rank) => [distance, rank]));
  return distances.map((distance) => rankOfDistance.get(distance) ?? 0);
}

function edgesInRanks(count: number): ReadonlyArray<number> {
  const ranks = centerOutRanks(count);
  const outermost = Math.max(...ranks);
  return ranks.map((rank) => outermost - rank);
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function randomRanks(count: number, seed: number): ReadonlyArray<number> {
  const random = mulberry32(seed);
  const shuffled = Array.from({ length: count }, (_, index) => index);
  for (let index = count - 1; index >= 1; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[other]] = [shuffled[other] ?? index, shuffled[index] ?? other];
  }
  const ranks = Array.from({ length: count }, () => 0);
  shuffled.forEach((item, position) => {
    ranks[item] = position;
  });
  return ranks;
}

function composeResult(input: StaggerInput, ranks: ReadonlyArray<number>, span: number): StaggerResult {
  const maxRank = Math.max(...ranks);
  const ease = EASINGS[input.curve ?? "linear"];
  const exactStarts = ranks.map((rank) => input.startTime + span * ease(maxRank === 0 ? 0 : rank / maxRank));
  const base = { ok: true, starts: exactStarts.map(round3), ranks, span: round3(span) } as const;
  if (input.itemDuration === undefined) return base;
  const itemDuration = input.itemDuration;
  const ends = exactStarts.map((start) => round3(start + itemDuration));
  return { ...base, ends, end: round3(Math.max(...ends)) };
}

/** Start times for each item in the caller's order, or the reason the request cannot be solved. */
export function solveStagger(input: StaggerInput): StaggerResult | SolverFailure {
  const problem = inputProblem(input);
  if (problem) return solverFailure(problem);
  const ranks = RANKERS[input.order ?? "forward"](input.count, input.seed ?? 1);
  const maxRank = Math.max(...ranks);
  const requestedSpan = input.total !== undefined ? input.total : (input.step ?? 0) * maxRank;
  const span = maxRank === 0 ? 0 : requestedSpan;
  if (span > MAX_SPAN_SECONDS) return solverFailure("span exceeds 3600 seconds");
  return composeResult(input, ranks, span);
}
