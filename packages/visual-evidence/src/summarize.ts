// Reduces an RGBA frame to a bounded summary: how much of it is content, where, in which cells, and in what colours.
import { rampBaselineOf } from "./baseline.js";
import { backgroundOf, censusColors, dominantColorsOf, isAlphaBackdrop, isRampBackdrop, type ColorCensus } from "./census.js";
import { round3 } from "./color.js";
import type { FrameSummary, FrameSummaryOptions } from "./frame-types.js";
import { MAX_ANALYSIS_PIXELS } from "./limits.js";
import type { PixelGrid } from "./pixel-grid.js";
import { refusal, type Refusal } from "./refusal.js";
import { cellColorsOf, cellLumaOf, contentBoxOf, regionContentOf, scanRegions, type ScanSettings } from "./region-scan.js";

const DEFAULT_CONTENT_TOLERANCE = 16;
const DEFAULT_DOMINANT_COLORS = 5;
const MAX_DOMINANT_COLORS = 8;
const DEFAULT_REGIONS = 3;

interface ResolvedOptions {
  readonly tolerance: number;
  readonly regions: number;
  readonly wanted: number;
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function finiteOr(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value !== undefined ? value : fallback;
}

function resolveFrameOptions(options: FrameSummaryOptions): ResolvedOptions {
  return {
    tolerance: clamp(finiteOr(options.tolerance, DEFAULT_CONTENT_TOLERANCE), 0, 255),
    regions: options.regions === 1 || options.regions === 2 ? options.regions : DEFAULT_REGIONS,
    wanted: clamp(Math.floor(finiteOr(options.dominantColors, DEFAULT_DOMINANT_COLORS)), 1, MAX_DOMINANT_COLORS),
  };
}

function frameRefusal({ pixels, width, height }: PixelGrid): Refusal | undefined {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) return refusal("INVALID_FRAME", "Frame width and height must be positive integers.");
  if (width * height > MAX_ANALYSIS_PIXELS) return refusal("FRAME_TOO_LARGE", `Frame exceeds the ${MAX_ANALYSIS_PIXELS}-pixel analysis bound.`);
  if (!pixels || pixels.length < width * height * 4) return refusal("SHORT_PIXEL_BUFFER", `A ${width}×${height} frame needs ${width * height * 4} RGBA values.`);
  return undefined;
}

function scanSettingsOf(grid: PixelGrid, options: FrameSummaryOptions, census: ColorCensus, tolerance: number): ScanSettings {
  const total = grid.width * grid.height;
  const alphaIsContent = isAlphaBackdrop(census, options, total);
  const ramp = !alphaIsContent && isRampBackdrop(census, options, total) ? rampBaselineOf(grid) : undefined;
  const background = ramp ? ramp.center : backgroundOf(options.background, census);
  return { background, tolerance, alphaIsContent, ramp };
}

/** Everything returned is a number or a short string, so the payload cannot carry the frame or grow with it. */
export function summarizeFrame(pixels: ArrayLike<number>, width: number, height: number, options: FrameSummaryOptions = {}): FrameSummary | Refusal {
  const grid = { pixels, width, height };
  const refused = frameRefusal(grid);
  if (refused) return refused;
  const { tolerance, regions, wanted } = resolveFrameOptions(options);
  const total = width * height;
  const census = censusColors(grid);
  const settings = scanSettingsOf(grid, options, census, tolerance);
  const scan = scanRegions(grid, regions, settings);
  return {
    width, height,
    background: settings.background,
    contentFraction: round3(scan.totals.content / total),
    transparentFraction: round3(scan.totals.transparent / total),
    regionContent: regionContentOf(scan),
    contentBox: contentBoxOf(scan),
    dominantColors: dominantColorsOf(census, wanted, total),
    cellLuma: cellLumaOf(scan),
    cellColors: cellColorsOf(scan),
  };
}
