// Compares two summaries of the same grid cell by cell, so a change inside one cell is named rather than averaged away.
import type { FrameSummary } from "./frame-types.js";
import { round3 } from "./color.js";

const CELL_CONTENT_DELTA = 0.05;
const CELL_LUMA_DELTA = 3;
const CELL_COLOR_DELTA = 24;

/** Which row-major cells differ between two frames, and the mean absolute luminance change over all cells, 0-1. */
export interface FrameChange {
  readonly cells: number[];
  readonly meanDelta: number;
}

function channelsOf(hex: string): number[] {
  return [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));
}

function colorMoved(left: string | undefined, right: string | undefined): boolean {
  if (left === undefined || right === undefined) return false;
  const after = channelsOf(right);
  return channelsOf(left).some((value, index) => Math.abs(value - (after[index] ?? 0)) > CELL_COLOR_DELTA);
}

function lumaChange(before: FrameSummary, after: FrameSummary, cell: number): number | undefined {
  const was = before.cellLuma?.[cell];
  const now = after.cellLuma?.[cell];
  return was === undefined || now === undefined ? undefined : Math.abs(was - now);
}

function cellChanged(before: FrameSummary, after: FrameSummary, cell: number): boolean {
  const content = Math.abs((before.regionContent[cell] ?? 0) - (after.regionContent[cell] ?? 0));
  const luma = lumaChange(before, after, cell);
  return content >= CELL_CONTENT_DELTA || (luma !== undefined && luma >= CELL_LUMA_DELTA) || colorMoved(before.cellColors?.[cell], after.cellColors?.[cell]);
}

/** What moved between two summaries of the same grid; null when the grids differ and no cell-wise reading exists. */
export function compareFrameSummaries(before: FrameSummary, after: FrameSummary): FrameChange | null {
  if (before.regionContent.length !== after.regionContent.length) return null;
  const cells: number[] = [];
  const lumaChanges: number[] = [];
  for (let cell = 0; cell < after.regionContent.length; cell += 1) {
    if (cellChanged(before, after, cell)) cells.push(cell);
    const luma = lumaChange(before, after, cell);
    if (luma !== undefined) lumaChanges.push(luma);
  }
  const total = lumaChanges.reduce((sum, change) => sum + change, 0);
  return { cells, meanDelta: lumaChanges.length ? round3(total / lumaChanges.length / 255) : 0 };
}
