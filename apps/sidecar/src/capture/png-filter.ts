/** PNG scanline filters (spec section 9), applied in place or into a caller-owned buffer so a frame is filtered without allocating per row or per byte. */

/** Filter type 0: the byte is stored as it is. */
export const FILTER_NONE = 0;
/** Filter type 1: the byte minus the byte one pixel to the left. */
export const FILTER_SUB = 1;
/** Filter type 2: the byte minus the byte above it. */
export const FILTER_UP = 2;
/** Filter type 3: the byte minus the average of the left and upper bytes. */
export const FILTER_AVERAGE = 3;
/** Filter type 4: the byte minus the Paeth predictor of the left, upper and upper-left bytes. */
export const FILTER_PAETH = 4;

/** One scanline of raw bytes, the reconstructed row above it (all zero for the first row), and the bytes per pixel the predictors step back by. */
export interface RowPair {
  row: Uint8Array;
  previous: Uint8Array;
  bytesPerPixel: number;
}

type Predictor = (left: number, up: number, upLeft: number) => number;

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const distanceLeft = Math.abs(estimate - left), distanceUp = Math.abs(estimate - up), distanceUpLeft = Math.abs(estimate - upLeft);
  if (distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft) return left;
  return distanceUp <= distanceUpLeft ? up : upLeft;
}

const PREDICTORS: readonly Predictor[] = [() => 0, (left) => left, (_left, up) => up, (left, up) => (left + up) >> 1, paeth];

function predictor(filter: number, pair: RowPair, index: number): number {
  const back = index - pair.bytesPerPixel;
  return PREDICTORS[filter]?.(pair.row[back] ?? 0, pair.previous[index] ?? 0, pair.previous[back] ?? 0) ?? 0;
}

/** Reconstructs `pair.row` in place from its filtered bytes; `pair.previous` is the reconstructed row above. */
export function unfilterRow(filter: number, pair: RowPair): void {
  const { row } = pair;
  if (filter === FILTER_NONE) return;
  for (let index = 0; index < row.length; index += 1) row[index] = ((row[index] ?? 0) + predictor(filter, pair, index)) & 0xff;
}

/** Writes the filtered form of the raw `pair.row` into `out` from `offset`; the predictor reads the raw row, which is what the decoder will have reconstructed. */
export function filterInto(filter: number, pair: RowPair, out: Uint8Array, offset: number): void {
  const { row } = pair;
  if (filter === FILTER_NONE) {
    out.set(row, offset);
    return;
  }
  for (let index = 0; index < row.length; index += 1) out[offset + index] = ((row[index] ?? 0) - predictor(filter, pair, index)) & 0xff;
}

/** The sum of absolute signed values the filter would produce for the row: the standard cheap predictor of what deflate will like. */
export function filterCost(filter: number, pair: RowPair): number {
  const { row } = pair;
  let cost = 0;
  for (let index = 0; index < row.length; index += 1) {
    const value = ((row[index] ?? 0) - predictor(filter, pair, index)) & 0xff;
    cost += value < 128 ? value : 256 - value;
  }
  return cost;
}
