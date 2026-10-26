// Measures a frame cell by cell, row-major over a `regions` x `regions` grid, against its background: how much of each cell is content, how bright it is, and which colour dominates it.
import { rampExpected, type RampBaseline } from "./baseline.js";
import { COLOR_BIN_COUNT, addAt, addToTally, binOf, createTally, fullestBin, hexOf, meanColor, round3, valueAt, type ColorTally, type Rgb } from "./color.js";
import type { ContentBox } from "./frame-types.js";
import { alphaAt, isTransparent, rgbAt, type PixelGrid } from "./pixel-grid.js";

/** What counts as content: a colour distance from the background, from the modelled ramp, or any drawn pixel at all. */
export interface ScanSettings {
  readonly background: Rgb;
  readonly tolerance: number;
  readonly alphaIsContent: boolean;
  readonly ramp: RampBaseline | undefined;
}

interface ScanTotals {
  content: number;
  transparent: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface RegionScan {
  readonly grid: PixelGrid;
  readonly regions: number;
  readonly settings: ScanSettings;
  readonly cells: Uint32Array;
  readonly contentCells: Uint32Array;
  readonly lumaSums: Float64Array;
  readonly opaqueCells: Uint32Array;
  readonly cellColors: ColorTally;
  readonly totals: ScanTotals;
}

function createScan(grid: PixelGrid, regions: number, settings: ScanSettings): RegionScan {
  const cells = regions * regions;
  const totals = { content: 0, transparent: 0, minX: grid.width, minY: grid.height, maxX: -1, maxY: -1 };
  return {
    grid, regions, settings, totals,
    cells: new Uint32Array(cells),
    contentCells: new Uint32Array(cells),
    lumaSums: new Float64Array(cells),
    opaqueCells: new Uint32Array(cells),
    cellColors: createTally(cells * COLOR_BIN_COUNT),
  };
}

function cellIndexOf(position: number, extent: number, regions: number): number {
  return Math.min(regions - 1, Math.floor((position * regions) / extent));
}

function expectedChannel(settings: ScanSettings, x: number, y: number, channel: number): number {
  return settings.ramp ? rampExpected(settings.ramp, x, y, channel) : (settings.background[channel] ?? 0);
}

function differsFromBackground(settings: ScanSettings, x: number, y: number, color: Rgb): boolean {
  return color.some((level, channel) => Math.abs(level - expectedChannel(settings, x, y, channel)) > settings.tolerance);
}

function growContentBox(totals: ScanTotals, x: number, y: number): void {
  totals.minX = Math.min(totals.minX, x);
  totals.minY = Math.min(totals.minY, y);
  totals.maxX = Math.max(totals.maxX, x);
  totals.maxY = Math.max(totals.maxY, y);
}

function tallyCellColor(scan: RegionScan, cell: number, color: Rgb): void {
  addAt(scan.lumaSums, cell, 0.299 * color[0] + 0.587 * color[1] + 0.114 * color[2]);
  addAt(scan.opaqueCells, cell, 1);
  addToTally(scan.cellColors, cell * COLOR_BIN_COUNT + binOf(color), color);
}

function accumulatePixel(scan: RegionScan, x: number, y: number, cell: number): void {
  const index = y * scan.grid.width + x;
  addAt(scan.cells, cell, 1);
  if (isTransparent(alphaAt(scan.grid.pixels, index))) {
    scan.totals.transparent += 1;
    return;
  }
  const color = rgbAt(scan.grid.pixels, index);
  tallyCellColor(scan, cell, color);
  if (!scan.settings.alphaIsContent && !differsFromBackground(scan.settings, x, y, color)) return;
  scan.totals.content += 1;
  addAt(scan.contentCells, cell, 1);
  growContentBox(scan.totals, x, y);
}

/** Visits every pixel once, filling the per-cell and whole-frame tallies. */
export function scanRegions(grid: PixelGrid, regions: number, settings: ScanSettings): RegionScan {
  const scan = createScan(grid, regions, settings);
  for (let y = 0; y < grid.height; y += 1) {
    const row = cellIndexOf(y, grid.height, regions) * regions;
    for (let x = 0; x < grid.width; x += 1) accumulatePixel(scan, x, y, row + cellIndexOf(x, grid.width, regions));
  }
  return scan;
}

function perCell<Value>(scan: RegionScan, read: (cell: number) => Value): Value[] {
  return Array.from({ length: scan.regions * scan.regions }, (_, cell) => read(cell));
}

/** Content share per cell; a cell with no pixels reports 0 rather than NaN, because no samples still reads as no content. */
export function regionContentOf(scan: RegionScan): number[] {
  return perCell(scan, (cell) => (valueAt(scan.cells, cell) ? round3(valueAt(scan.contentCells, cell) / valueAt(scan.cells, cell)) : 0));
}

/** Mean Rec. 601 luminance per cell, so a shift inside one cell reads as a number even where content share stays put. */
export function cellLumaOf(scan: RegionScan): number[] {
  return perCell(scan, (cell) => (valueAt(scan.opaqueCells, cell) ? Math.round((valueAt(scan.lumaSums, cell) / valueAt(scan.opaqueCells, cell)) * 10) / 10 : 0));
}

/** The commonest colour in each cell, named by the mean of the pixels that fell in its bin. */
export function cellColorsOf(scan: RegionScan): string[] {
  return perCell(scan, (cell) => {
    const best = fullestBin(scan.cellColors.counts.subarray(cell * COLOR_BIN_COUNT, (cell + 1) * COLOR_BIN_COUNT));
    return best.bin < 0 ? "#000000" : hexOf(meanColor(scan.cellColors, cell * COLOR_BIN_COUNT + best.bin));
  });
}

/** The box around all content in 0-1 frame coordinates, or null when nothing differs. */
export function contentBoxOf({ totals, grid }: RegionScan): ContentBox | null {
  if (totals.maxX < 0) return null;
  return {
    x: round3(totals.minX / grid.width),
    y: round3(totals.minY / grid.height),
    width: round3((totals.maxX - totals.minX + 1) / grid.width),
    height: round3((totals.maxY - totals.minY + 1) / grid.height),
  };
}
