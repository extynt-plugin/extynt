// Reads a frame summary that crossed a process boundary onto the summary contract: bounded, projected to known fields, first failure wins.
import type { ContentBox, DominantColor, FrameSummary } from "./frame-types.js";
import type { Rgb } from "./color.js";
import { MAX_ANALYSIS_PIXELS } from "./limits.js";
import { refusal, type Refusal } from "./refusal.js";
import { isChannel, isHexColor, isInteger, isListOfSize, isLuma, isUnit, isWireList, isWireObject, type WireObject, type WireValue } from "./wire.js";

const MAX_SUMMARY_REGIONS = 64;
const MAX_SUMMARY_COLORS = 8;
const BOX_EDGE_SLACK = 1.001;

type Reading<Value> = { readonly value: Value } | { readonly message: string };

function refused(message: string): Reading<never> {
  return { message };
}

function accepted<Value>(value: Value): Reading<Value> {
  return { value };
}

function readFrameSize(source: WireObject): Reading<{ readonly width: number; readonly height: number }> {
  const { width, height } = source;
  if (!isInteger(width) || !isInteger(height) || width < 1 || height < 1 || width * height > MAX_ANALYSIS_PIXELS) return refused("A frame summary needs the bounded frame size it measured.");
  return accepted({ width, height });
}

function readBackground(raw: WireValue): Reading<Rgb> {
  const [red, green, blue] = isWireList(raw) ? raw : [];
  if (!isChannel(red) || !isChannel(green) || !isChannel(blue)) return refused("background must be three 0-255 channels.");
  return accepted([red, green, blue]);
}

function readFractions(source: WireObject): Reading<{ readonly contentFraction: number; readonly transparentFraction: number }> {
  const { contentFraction, transparentFraction } = source;
  if (!isUnit(contentFraction) || !isUnit(transparentFraction)) return refused("contentFraction and transparentFraction must be numbers from 0 to 1.");
  return accepted({ contentFraction, transparentFraction });
}

function readRegionContent(raw: WireValue): Reading<number[]> {
  if (!isListOfSize(raw, { min: 1, max: MAX_SUMMARY_REGIONS })) return refused(`regionContent must be 1-${MAX_SUMMARY_REGIONS} fractions.`);
  const fractions = raw.filter(isUnit);
  return fractions.length === raw.length ? accepted(fractions) : refused("Every region fraction must be a number from 0 to 1.");
}

function readBoxEdges(box: WireObject): Reading<ContentBox> {
  const { x, y, width, height } = box;
  if (!isUnit(x) || !isUnit(y) || !isUnit(width) || !isUnit(height)) return refused("Every contentBox edge must be a number from 0 to 1.");
  if (x + width > BOX_EDGE_SLACK || y + height > BOX_EDGE_SLACK) return refused("contentBox must lie inside the frame.");
  return accepted({ x, y, width, height });
}

function readContentBox(raw: WireValue): Reading<ContentBox | null> {
  if (raw === null || raw === undefined) return accepted(null);
  return isWireObject(raw) ? readBoxEdges(raw) : refused("contentBox must be null or a box of four fractions.");
}

function readColorEntry(entry: WireValue): Reading<DominantColor> {
  if (!isWireObject(entry)) return refused("Every dominant colour must be an object with a hex and a fraction.");
  const { hex, fraction } = entry;
  if (!isHexColor(hex)) return refused("A dominant colour's hex must be #rrggbb.");
  if (!isUnit(fraction)) return refused("A dominant colour's fraction must be a number from 0 to 1.");
  return accepted({ hex: hex.toLowerCase(), fraction });
}

function readDominantColors(raw: WireValue): Reading<DominantColor[]> {
  if (!isListOfSize(raw, { min: 0, max: MAX_SUMMARY_COLORS })) return refused(`dominantColors must be at most ${MAX_SUMMARY_COLORS} entries.`);
  const colors: DominantColor[] = [];
  for (const entry of raw) {
    const reading = readColorEntry(entry);
    if ("message" in reading) return reading;
    colors.push(reading.value);
  }
  return accepted(colors);
}

function readCellLuma(raw: WireValue): number[] | undefined {
  if (!isListOfSize(raw, { min: 1, max: MAX_SUMMARY_REGIONS })) return undefined;
  const luma = raw.filter(isLuma);
  return luma.length === raw.length ? luma : undefined;
}

function readCellColors(raw: WireValue): string[] | undefined {
  if (!isListOfSize(raw, { min: 1, max: MAX_SUMMARY_REGIONS })) return undefined;
  const colors = raw.filter(isHexColor);
  return colors.length === raw.length ? colors.map((color) => color.toLowerCase()) : undefined;
}

function optionalCellFields(source: WireObject, cells: number): Pick<FrameSummary, "cellLuma" | "cellColors"> {
  const cellLuma = readCellLuma(source.cellLuma);
  const cellColors = readCellColors(source.cellColors);
  return { ...(cellLuma?.length === cells ? { cellLuma } : {}), ...(cellColors?.length === cells ? { cellColors } : {}) };
}

type Geometry = { readonly width: number; readonly height: number; readonly background: Rgb; readonly contentFraction: number; readonly transparentFraction: number };
type Shape = { readonly regionContent: number[]; readonly contentBox: ContentBox | null; readonly dominantColors: DominantColor[] };

function readGeometry(source: WireObject): Reading<Geometry> {
  const size = readFrameSize(source);
  if ("message" in size) return size;
  const background = readBackground(source.background);
  if ("message" in background) return background;
  const fractions = readFractions(source);
  if ("message" in fractions) return fractions;
  return accepted({ ...size.value, background: background.value, ...fractions.value });
}

function readShape(source: WireObject): Reading<Shape> {
  const regionContent = readRegionContent(source.regionContent);
  if ("message" in regionContent) return regionContent;
  const contentBox = readContentBox(source.contentBox);
  if ("message" in contentBox) return contentBox;
  const dominantColors = readDominantColors(source.dominantColors);
  if ("message" in dominantColors) return dominantColors;
  return accepted({ regionContent: regionContent.value, contentBox: contentBox.value, dominantColors: dominantColors.value });
}

/** Narrows a summary that arrived as untyped JSON: unknown fields are dropped and anything that would make the numbers meaningless is refused. */
export function validateFrameSummary(value: WireValue): FrameSummary | Refusal {
  if (!isWireObject(value)) return refusal("INVALID_FRAME_SUMMARY", "A frame summary must be an object.");
  const geometry = readGeometry(value);
  if ("message" in geometry) return refusal("INVALID_FRAME_SUMMARY", geometry.message);
  const shape = readShape(value);
  if ("message" in shape) return refusal("INVALID_FRAME_SUMMARY", shape.message);
  return { ...geometry.value, ...shape.value, ...optionalCellFields(value, shape.value.regionContent.length) };
}
