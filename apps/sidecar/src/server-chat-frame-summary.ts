// The measured summary of a rendered frame as the sidecar reads it back from a capture receipt, and the comparison that says whether two frames differ materially.
import { array, fallback, number, object, string, type Infer } from "@extynt/decode";

const CONTENT_SHIFT = 0.08;
const BOX_SHIFT = 0.03;
const COLOR_SHIFT = 0.08;

const NO_REGIONS: ReadonlyArray<number | undefined> = [];
const NO_COLORS: ReadonlyArray<{ readonly hex: string; readonly fraction: number } | undefined> = [];

const contentBox = object({ x: fallback(number(), undefined), y: fallback(number(), undefined), width: fallback(number(), undefined), height: fallback(number(), undefined) });
const dominantColor = object({ hex: string(), fraction: number() });

const measurements = object({
  contentFraction: fallback(number(), undefined),
  transparentFraction: fallback(number(), undefined),
  contentBox: fallback(contentBox, undefined),
  regionContent: fallback(array(fallback(number(), undefined)), NO_REGIONS),
  dominantColors: fallback(array(fallback(dominantColor, undefined)), NO_COLORS),
});

/** The frame measurements two frames are compared by; a field of the wrong type reads as absent, so a malformed receipt never shows a change. */
export const frameSummary = fallback(measurements, undefined);

/** A measured frame, or undefined when the receipt held none. */
export type MeasuredFrame = Infer<typeof frameSummary>;

type FrameSummary = NonNullable<MeasuredFrame>;
type ContentBox = NonNullable<FrameSummary["contentBox"]>;

function gap(left: number | undefined, right: number | undefined): number {
  return left === undefined || right === undefined ? 0 : Math.abs(left - right);
}

function boxMoved(left: ContentBox | undefined, right: ContentBox | undefined): boolean {
  if (!left || !right) return false;
  return [gap(left.x, right.x), gap(left.y, right.y), gap(left.width, right.width), gap(left.height, right.height)].some((moved) => moved >= BOX_SHIFT);
}

function regionsChanged(left: FrameSummary["regionContent"], right: FrameSummary["regionContent"]): boolean {
  return left.length === right.length && left.length > 0 && left.some((region, index) => gap(region, right[index]) >= CONTENT_SHIFT);
}

function colorShares(colors: FrameSummary["dominantColors"]): Map<string, number> {
  return new Map(colors.flatMap((color) => (color ? [[color.hex.toLowerCase(), color.fraction] as const] : [])));
}

function dominantColorShift(left: FrameSummary["dominantColors"], right: FrameSummary["dominantColors"]): number {
  const leftShares = colorShares(left);
  const rightShares = colorShares(right);
  if (!leftShares.size || !rightShares.size) return 0;
  const hexes = new Set([...leftShares.keys(), ...rightShares.keys()]);
  return [...hexes].reduce((sum, hex) => sum + Math.abs((leftShares.get(hex) ?? 0) - (rightShares.get(hex) ?? 0)), 0) / 2;
}

function contentChanged(left: FrameSummary, right: FrameSummary): boolean {
  return gap(left.contentFraction, right.contentFraction) >= CONTENT_SHIFT || gap(left.transparentFraction, right.transparentFraction) >= CONTENT_SHIFT;
}

/** Whether two measured frames differ materially: the content or transparent share, the content box, a region or the dominant colours moved. The colours are measured as the share of the frame whose colour moved, half the summed difference of the dominant-colour shares, since a full-frame backdrop fills every region and the content box at every time and motion over it shows only there. A frame that was not measured never differs. */
export function framesDiffer(left: MeasuredFrame, right: MeasuredFrame): boolean {
  if (!left || !right) return false;
  return contentChanged(left, right) || boxMoved(left.contentBox, right.contentBox) || regionsChanged(left.regionContent, right.regionContent) || dominantColorShift(left.dominantColors, right.dominantColors) >= COLOR_SHIFT;
}
