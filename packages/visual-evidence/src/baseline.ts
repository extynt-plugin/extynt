// Models a gradient backdrop as f(x) + g(y) + c per channel, because a ramp has no single most common colour to measure against.
// f and g are built from the typical step between neighbouring pixels, so a title or shape only bends them where its edge crosses.
import type { Rgb } from "./color.js";
import { alphaAt, isTransparent, type PixelGrid } from "./pixel-grid.js";

const CHANNELS = 3;
const STEP_OUTLIER = 2;
const RESIDUAL_OFFSET = 512;
const RESIDUAL_LEVELS = 1024;

/** The modelled empty frame: cumulative profiles along each axis, the constant that places them, and the colour at the middle. */
export interface RampBaseline {
  readonly across: Float64Array;
  readonly down: Float64Array;
  readonly offset: Rgb;
  readonly center: Rgb;
}

interface RampProfiles {
  readonly across: Float64Array;
  readonly down: Float64Array;
}

type Sampler = (position: number, line: number) => number;

function middleOf(values: number[]): number {
  const sorted = Float64Array.from(values).sort();
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function typicalStep(sample: Sampler, position: number, lines: number): number {
  const steps: number[] = [];
  for (let line = 0; line < lines; line += 1) {
    const step = sample(position + 1, line) - sample(position, line);
    if (Number.isFinite(step)) steps.push(step);
  }
  if (steps.length === 0) return 0;
  const middle = middleOf(steps);
  const near = steps.filter((step) => Math.abs(step - middle) <= STEP_OUTLIER);
  return near.reduce((sum, step) => sum + step, 0) / near.length;
}

function profileOf(sample: Sampler, length: number, lines: number): number[] {
  const profile = [0];
  for (let position = 0; position + 1 < length; position += 1) profile.push((profile[position] ?? 0) + typicalStep(sample, position, lines));
  return profile;
}

function levelAt(pixels: ArrayLike<number>, index: number, channel: number): number {
  return isTransparent(alphaAt(pixels, index)) ? Number.NaN : (pixels[index * 4 + channel] ?? 0);
}

function interleave(profiles: readonly number[][], length: number): Float64Array {
  const out = new Float64Array(length * CHANNELS);
  for (let position = 0; position < length; position += 1) {
    for (let channel = 0; channel < CHANNELS; channel += 1) out[position * CHANNELS + channel] = profiles[channel]?.[position] ?? 0;
  }
  return out;
}

function acrossOf({ pixels, width, height }: PixelGrid): Float64Array {
  const profiles = [0, 1, 2].map((channel) => profileOf((x, y) => levelAt(pixels, y * width + x, channel), width, height));
  return interleave(profiles, width);
}

function downOf({ pixels, width, height }: PixelGrid): Float64Array {
  const profiles = [0, 1, 2].map((channel) => profileOf((y, x) => levelAt(pixels, y * width + x, channel), height, width));
  return interleave(profiles, height);
}

function residualBin(residual: number): number {
  return Math.max(0, Math.min(RESIDUAL_LEVELS - 1, Math.round(residual) + RESIDUAL_OFFSET));
}

function histogramMedian(histogram: Uint32Array, count: number): number {
  let seen = 0;
  for (const [bin, tally] of histogram.entries()) {
    seen += tally;
    if (count > 0 && seen * 2 >= count) return bin;
  }
  return RESIDUAL_OFFSET;
}

function channelOffset(grid: PixelGrid, profiles: RampProfiles, channel: number): number {
  const histogram = new Uint32Array(RESIDUAL_LEVELS);
  let count = 0;
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      const level = levelAt(grid.pixels, y * grid.width + x, channel);
      if (Number.isNaN(level)) continue;
      const bin = residualBin(level - (profiles.across[x * CHANNELS + channel] ?? 0) - (profiles.down[y * CHANNELS + channel] ?? 0));
      histogram[bin] = (histogram[bin] ?? 0) + 1;
      count += 1;
    }
  }
  return histogramMedian(histogram, count) - RESIDUAL_OFFSET;
}

function centerOf(grid: PixelGrid, profiles: RampProfiles, offset: Rgb): Rgb {
  const middle = (channel: number): number => {
    const across = profiles.across[Math.floor(grid.width / 2) * CHANNELS + channel] ?? 0;
    const down = profiles.down[Math.floor(grid.height / 2) * CHANNELS + channel] ?? 0;
    return Math.max(0, Math.min(255, Math.round(across + down + (offset[channel] ?? 0))));
  };
  return [middle(0), middle(1), middle(2)];
}

/** Fits the ramp model to a frame; the offset is the median residual of its pixels against f(x) + g(y). */
export function rampBaselineOf(grid: PixelGrid): RampBaseline {
  const profiles = { across: acrossOf(grid), down: downOf(grid) };
  const offset: Rgb = [channelOffset(grid, profiles, 0), channelOffset(grid, profiles, 1), channelOffset(grid, profiles, 2)];
  return { ...profiles, offset, center: centerOf(grid, profiles, offset) };
}

/** The expected empty colour of one channel at a pixel. */
export function rampExpected(baseline: RampBaseline, x: number, y: number, channel: number): number {
  return (baseline.across[x * CHANNELS + channel] ?? 0) + (baseline.down[y * CHANNELS + channel] ?? 0) + (baseline.offset[channel] ?? 0);
}
