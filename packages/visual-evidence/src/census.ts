// One pass over a frame's colours, which decides the background the caller did not name and ranks what is on screen.
import { COLOR_BIN_COUNT, addToTally, binOf, createTally, fullestBin, hexOf, meanColor, round3, valueAt, type ColorTally, type Rgb } from "./color.js";
import type { DominantColor, FrameSummaryOptions } from "./frame-types.js";
import { alphaAt, isTransparent, rgbAt, type PixelGrid } from "./pixel-grid.js";

const ALPHA_BACKDROP_SHARE = 0.75;
const RAMP_BACKDROP_SHARE = 0.5;

/** Colour counts over the opaque pixels of a frame, with the most common bin and the number of transparent pixels. */
export interface ColorCensus {
  readonly tally: ColorTally;
  readonly dominant: { readonly bin: number; readonly count: number };
  readonly transparentCount: number;
}

/** Counts every opaque pixel's colour and every transparent pixel. */
export function censusColors({ pixels, width, height }: PixelGrid): ColorCensus {
  const tally = createTally(COLOR_BIN_COUNT);
  let transparentCount = 0;
  for (let index = 0; index < width * height; index += 1) {
    if (isTransparent(alphaAt(pixels, index))) transparentCount += 1;
    else {
      const color = rgbAt(pixels, index);
      addToTally(tally, binOf(color), color);
    }
  }
  return { tally, dominant: fullestBin(tally.counts), transparentCount };
}

/** The named background, else the mean of the most common colour, else black. */
export function backgroundOf(named: Rgb | undefined, census: ColorCensus): Rgb {
  if (named) return [Math.round(named[0]), Math.round(named[1]), Math.round(named[2])];
  const { bin, count } = census.dominant;
  if (bin < 0 || count <= 0) return [0, 0, 0];
  const [red, green, blue] = meanColor(census.tally, bin);
  return [Math.round(red), Math.round(green), Math.round(blue)];
}

/** True when most of the frame is see-through and no background was named, so any drawn pixel is content. */
export function isAlphaBackdrop(census: ColorCensus, options: FrameSummaryOptions, total: number): boolean {
  return options.background === undefined && census.transparentCount / total >= ALPHA_BACKDROP_SHARE;
}

/** True when no colour dominates the opaque pixels, which is what a gradient backdrop looks like. */
export function isRampBackdrop(census: ColorCensus, options: FrameSummaryOptions, total: number): boolean {
  const opaque = total - census.transparentCount;
  return options.background === undefined && opaque > 0 && census.dominant.count / opaque < RAMP_BACKDROP_SHARE;
}

/** The `wanted` most common colours, each named by the mean of its bin and sized as a share of the frame. */
export function dominantColorsOf(census: ColorCensus, wanted: number, total: number): DominantColor[] {
  return [...census.tally.counts.entries()]
    .filter(([, count]) => count > 0)
    .sort(([left, leftCount], [right, rightCount]) => rightCount - leftCount || left - right)
    .slice(0, wanted)
    .map(([bin]) => ({ hex: hexOf(meanColor(census.tally, bin)), fraction: round3(valueAt(census.tally.counts, bin) / total) }));
}
