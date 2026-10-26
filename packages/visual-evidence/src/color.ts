// Colour arithmetic for the frame analysis: channel triples, the coarse bins colours are counted in, and their hex form.

/** Red, green and blue, each 0-255. */
export type Rgb = readonly [number, number, number];

const COLOR_BITS = 4;
const COLOR_SHIFT = 8 - COLOR_BITS;

/** How many bins a colour can fall in: 16 levels per channel. */
export const COLOR_BIN_COUNT = 1 << (COLOR_BITS * 3);

/** The bin a colour is counted in. */
export function binOf([red, green, blue]: Rgb): number {
  return ((red >> COLOR_SHIFT) << (COLOR_BITS * 2)) | ((green >> COLOR_SHIFT) << COLOR_BITS) | (blue >> COLOR_SHIFT);
}

/** A typed-array read whose index is in range by construction; the fallback only serves the type. */
export function valueAt(values: Uint32Array | Float64Array, index: number): number {
  return values[index] ?? 0;
}

/** Adds `amount` to the entry at `index`. */
export function addAt(values: Uint32Array | Float64Array, index: number, amount: number): void {
  values[index] = valueAt(values, index) + amount;
}

/** Rounds to three decimal places. */
export function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function hex2(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
}

/** The `#rrggbb` text of a colour whose channels may be fractional. */
export function hexOf(color: Rgb): string {
  return `#${hex2(color[0])}${hex2(color[1])}${hex2(color[2])}`;
}

/** Counts of colours per bin, with the channel sums that give each bin its mean colour. */
export interface ColorTally {
  readonly counts: Uint32Array;
  readonly sums: Float64Array;
}

/** An empty tally with room for `slots` bins. */
export function createTally(slots: number): ColorTally {
  return { counts: new Uint32Array(slots), sums: new Float64Array(slots * 3) };
}

/** Counts one colour into the bin at `slot`. */
export function addToTally(tally: ColorTally, slot: number, color: Rgb): void {
  addAt(tally.counts, slot, 1);
  color.forEach((level, channel) => addAt(tally.sums, slot * 3 + channel, level));
}

/** The mean colour of the pixels counted into `slot`. */
export function meanColor(tally: ColorTally, slot: number): Rgb {
  const count = valueAt(tally.counts, slot);
  return [valueAt(tally.sums, slot * 3) / count, valueAt(tally.sums, slot * 3 + 1) / count, valueAt(tally.sums, slot * 3 + 2) / count];
}

/** The fullest bin; ties keep the lowest, so the same frame always reports the same colour. */
export function fullestBin(counts: Uint32Array): { readonly bin: number; readonly count: number } {
  let bin = -1;
  let count = 0;
  for (const [candidate, candidateCount] of counts.entries()) {
    if (candidateCount > count) {
      count = candidateCount;
      bin = candidate;
    }
  }
  return { bin, count };
}
