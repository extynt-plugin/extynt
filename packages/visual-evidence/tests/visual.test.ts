// Tests the capture contract and the frame analysis against buffers whose contents are known exactly, the only way to assert a measurement rather than a shape.
import test from "node:test";
import { decodeOrThrow, wireJson } from "@extynt/decode";
import assert from "node:assert/strict";
import { compareFrameSummaries, compileCaptureCommand, summarizeFrame, validateCaptureRequest, validateFrameSummary, type CaptureCommand, type CaptureRequest, type FrameSummary, type FrameSummaryOptions } from "../src/index.js";
import type { Refusal } from "../src/refusal.js";

type Pixel = [number, number, number, number];

const BLACK: Pixel = [0, 0, 0, 255];
const WHITE: Pixel = [255, 255, 255, 255];
const CLEAR: Pixel = [0, 0, 0, 0];
const VALID_CAPTURE = { compositionId: "c", time: 1, width: 1920, height: 1080, format: "png", shareWithProvider: false };

function round(numerator: number, denominator: number): number {
  return Math.round((numerator / denominator) * 1000) / 1000;
}

function frame(width: number, height: number, paint: (x: number, y: number) => Pixel): number[] {
  const out: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) out.push(...paint(x, y));
  }
  return out;
}

function measure(pixels: number[], size: number, options?: FrameSummaryOptions): FrameSummary {
  const summary = summarizeFrame(pixels, size, size, options);
  if ("ok" in summary) assert.fail(summary.message);
  return summary;
}

function codeOf(result: Refusal | FrameSummary | CaptureRequest | CaptureCommand): string | undefined {
  return "ok" in result ? result.code : undefined;
}

function cell(summary: FrameSummary, index: number): number {
  return summary.regionContent[index] ?? Number.NaN;
}

test("a capture request is bounded and local-first", () => {
  assert.equal(codeOf(validateCaptureRequest(VALID_CAPTURE)), undefined);
  assert.equal(codeOf(validateCaptureRequest({ ...VALID_CAPTURE, width: 99999 })), "INVALID_CAPTURE");
  assert.equal(codeOf(validateCaptureRequest({ ...VALID_CAPTURE, shareWithProvider: true })), "INVALID_CAPTURE");
  assert.equal(codeOf(validateCaptureRequest("a string")), "INVALID_CAPTURE");
});

test("the capture compiler refuses upload-oriented and unsafe commands", () => {
  const command = compileCaptureCommand(VALID_CAPTURE, "evidence-1");
  assert.equal("operation" in command && command.operation, "capture_frame");
  assert.equal(codeOf(compileCaptureCommand({ ...VALID_CAPTURE, format: "jpeg" }, "evidence-1")), "UNSUPPORTED_CAPTURE_FORMAT");
  assert.equal(codeOf(compileCaptureCommand(VALID_CAPTURE, "../escape")), "INVALID_CAPTURE_ID");
});

test("an empty frame measures as empty rather than as an error", () => {
  const summary = measure(frame(60, 60, () => BLACK), 60);
  assert.equal(summary.contentFraction, 0);
  assert.equal(summary.contentBox, null, "nothing differs, so there is nowhere the content is");
  assert.deepEqual(summary.regionContent, [0, 0, 0, 0, 0, 0, 0, 0, 0], "the default grid is 3x3 whatever the frame size");
  assert.deepEqual(summary.background, [0, 0, 0], "the background is the frame's own colour");
});

test("content is measured where it actually is, and a wipe reads as a direction", () => {
  const topBand = measure(frame(60, 60, (_x, y) => (y < 20 ? WHITE : BLACK)), 60);
  const bottomBand = measure(frame(60, 60, (_x, y) => (y >= 40 ? WHITE : BLACK)), 60);
  assert.equal(topBand.contentFraction, round(20 * 60, 60 * 60), "a third of the frame is covered");
  assert.deepEqual(topBand.regionContent.slice(0, 3), [1, 1, 1], "the top row of cells is full");
  assert.deepEqual(topBand.regionContent.slice(6, 9), [0, 0, 0], "and the bottom row is empty");
  assert.equal(topBand.contentBox?.y, 0, "content starts at the top edge");
  assert.equal(topBand.contentBox?.height, round(20, 60), "and is a third of the frame tall");
  assert.deepEqual(bottomBand.regionContent.slice(0, 3), [0, 0, 0]);
  assert.deepEqual(bottomBand.regionContent.slice(6, 9), [1, 1, 1]);
  assert.equal(bottomBand.contentBox?.y, round(40, 60));
  assert.notDeepEqual(topBand.regionContent, bottomBand.regionContent, "up and down are told apart");
});

test("a full-frame flash needs a named background to be measured against", () => {
  const flash = measure(frame(40, 40, () => WHITE), 40, { background: [0, 0, 0] });
  const unnamed = measure(frame(40, 40, () => WHITE), 40);
  assert.equal(flash.contentFraction, 1, "the whole frame differs from the background it was measured against");
  assert.deepEqual(flash.contentBox, { x: 0, y: 0, width: 1, height: 1 });
  assert.equal(flash.dominantColors[0]?.hex, "#ffffff");
  assert.equal(unnamed.contentFraction, 0, "without a background to differ from, a uniform frame has no content to report");
});

test("a corner marker is findable and sits in the cell that holds it", () => {
  const corner = measure(frame(40, 40, (x, y) => (x < 8 && y < 8 ? [255, 0, 0, 255] : BLACK)), 40);
  assert.equal(corner.contentFraction, round(64, 1600));
  assert.deepEqual(corner.contentBox, { x: 0, y: 0, width: round(8, 40), height: round(8, 40) });
  assert.ok(cell(corner, 0) > 0.3 && cell(corner, 0) < 0.4, `the first cell holds it: ${cell(corner, 0)}`);
  assert.equal(cell(corner, 4), 0, "and the centre cell does not");
  assert.equal(corner.dominantColors[0]?.hex, "#000000", "most of the frame is still the backdrop");
  assert.equal(corner.dominantColors[1]?.hex, "#ff0000");
});

test("a summary cannot carry a frame, and cannot be talked into one", () => {
  const big = measure(frame(400, 400, (x, y) => [x % 256, y % 256, (x + y) % 256, 255]), 400);
  const serialized = JSON.stringify(big);
  assert.ok(serialized.length < 600, `a 400x400 summary is ${serialized.length} bytes, not a frame`);
  assert.ok(big.dominantColors.length <= 5, "the colour list is capped");
  assert.deepEqual(Object.keys(big).sort(), ["background", "cellColors", "cellLuma", "contentBox", "contentFraction", "dominantColors", "height", "regionContent", "transparentFraction", "width"]);
});

test("a truncated, empty or oversized buffer is refused rather than read past", () => {
  assert.equal(codeOf(summarizeFrame([0, 0, 0, 255], 2, 2)), "SHORT_PIXEL_BUFFER");
  assert.equal(codeOf(summarizeFrame([], 0, 10)), "INVALID_FRAME");
  assert.equal(codeOf(summarizeFrame([], 5000, 5000)), "FRAME_TOO_LARGE");
});

test("an explicit background is honoured, and a tolerance decides what counts as content", () => {
  const nearBlack = frame(30, 30, () => [8, 8, 8, 255]);
  const strict = measure(nearBlack, 30, { background: [0, 0, 0], tolerance: 4 });
  const forgiving = measure(nearBlack, 30, { background: [0, 0, 0], tolerance: 16 });
  assert.equal(strict.contentFraction, 1, "at tolerance 4 a near-black frame is all content");
  assert.equal(forgiving.contentFraction, 0, "at tolerance 16 it is all backdrop");
  assert.deepEqual(forgiving.background, [0, 0, 0], "and the background is the one the caller named");
});

test("transparency is reported separately from content", () => {
  const half = measure(frame(40, 40, (_x, y) => (y < 20 ? BLACK : CLEAR)), 40);
  assert.equal(half.transparentFraction, round(800, 1600));
  assert.equal(half.contentFraction, 0, "an empty backdrop over nothing is still nothing");
  assert.deepEqual(half.regionContent.slice(6, 9), [0, 0, 0]);
});

const WIRE_SUMMARY = {
  width: 1920,
  height: 1080,
  background: [10, 10, 12],
  contentFraction: 0.25,
  transparentFraction: 0,
  regionContent: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9],
  contentBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
  dominantColors: [{ hex: "#AABBCC", fraction: 0.5 }],
  somethingNew: "dropped",
};

test("a summary that crossed a process boundary is projected onto the contract's own fields", () => {
  const summary = validateFrameSummary(WIRE_SUMMARY);
  if ("ok" in summary) assert.fail(summary.message);
  assert.deepEqual(Object.keys(summary).sort(), ["background", "contentBox", "contentFraction", "dominantColors", "height", "regionContent", "transparentFraction", "width"]);
  assert.equal(summary.dominantColors[0]?.hex, "#aabbcc", "hex is normalised");
  assert.equal(summary.width, 1920);
});

test("a summary with no box and no colours is a real answer", () => {
  const empty = validateFrameSummary({ ...WIRE_SUMMARY, contentBox: null, contentFraction: 0, dominantColors: [] });
  if ("ok" in empty) assert.fail(empty.message);
  assert.equal(empty.contentBox, null);
  assert.deepEqual(empty.dominantColors, []);
});

test("a summary that would make the numbers meaningless is refused", () => {
  const refusedCases = [
    ["a frame with no pixels measured nothing", { ...WIRE_SUMMARY, width: 0 }],
    ["a fraction outside 0-1 is not a measurement", { ...WIRE_SUMMARY, contentFraction: 1.4 }],
    ["NaN is not a measurement", { ...WIRE_SUMMARY, contentFraction: Number.NaN }],
    ["a background needs three channels", { ...WIRE_SUMMARY, background: [0, 0] }],
    ["each background value has to be a channel", { ...WIRE_SUMMARY, background: [0, 0, 999] }],
    ["a grid with no cells is not a grid", { ...WIRE_SUMMARY, regionContent: [] }],
    ["an unbounded grid is a payload", { ...WIRE_SUMMARY, regionContent: Array.from({ length: 65 }, () => 0) }],
    ["a cell fraction outside 0-1 is not one", { ...WIRE_SUMMARY, regionContent: [0.5, 1.2] }],
    ["a box that runs off the frame is not this frame's content", { ...WIRE_SUMMARY, contentBox: { x: 0.9, y: 0, width: 0.5, height: 0.1 } }],
    ["a colour that is not a colour", { ...WIRE_SUMMARY, dominantColors: [{ hex: "red", fraction: 0.5 }] }],
    ["a share greater than the whole frame", { ...WIRE_SUMMARY, dominantColors: [{ hex: "#ffffff", fraction: 2 }] }],
    ["an unbounded colour list", { ...WIRE_SUMMARY, dominantColors: Array.from({ length: 9 }, () => ({ hex: "#ffffff", fraction: 0.1 })) }],
    ["the whole thing has to be an object", "not an object"],
  ] as const;
  for (const [why, value] of refusedCases) assert.equal(codeOf(validateFrameSummary(value)), "INVALID_FRAME_SUMMARY", why);
});

test("a ramp backdrop with a small bright title does not saturate regionContent", () => {
  const ramp = (x: number, y: number): Pixel => [Math.round(20 + (x / 95) * 120), Math.round(30 + (y / 95) * 100), 90, 255];
  const withTitle = measure(frame(96, 96, (x, y) => (x >= 36 && x < 60 && y >= 40 && y < 50 ? [250, 250, 250, 255] : ramp(x, y))), 96);
  const without = measure(frame(96, 96, ramp), 96);
  assert.equal(without.contentFraction, 0, "an untouched ramp is all backdrop");
  assert.ok(withTitle.contentFraction > 0.02 && withTitle.contentFraction < 0.05, `title covers ~2.6% of the frame, got ${withTitle.contentFraction}`);
  assert.ok(withTitle.regionContent.every((share) => share < 0.3), "no cell is saturated");
  assert.ok(cell(withTitle, 4) > 0.1, "the title sits in the centre cell");
  assert.equal(withTitle.cellLuma?.length, 9);
  assert.equal(withTitle.cellColors?.length, 9);
});

test("two frames differing in one cell list exactly that cell, and identical frames list none", () => {
  const base = frame(60, 60, () => BLACK);
  const before = measure(base, 60);
  const after = measure(frame(60, 60, (x, y) => (x >= 40 && y < 20 ? [200, 40, 40, 255] : BLACK)), 60);
  const change = compareFrameSummaries(before, after);
  assert.deepEqual(change?.cells, [2], "the top-right cell");
  assert.ok((change?.meanDelta ?? 0) > 0);
  assert.deepEqual(compareFrameSummaries(before, measure(base, 60)), { cells: [], meanDelta: 0 });
  assert.ok(JSON.stringify(after).length <= 600, `summary stays small, got ${JSON.stringify(after).length}`);
});

test("cell detail survives the wire and old summaries without it still validate", () => {
  const summary = measure(frame(30, 30, () => WHITE), 30);
  assert.deepEqual(validateFrameSummary(decodeOrThrow(wireJson, JSON.parse(JSON.stringify(summary)))), summary);
  const { cellLuma: _luma, cellColors: _colors, ...legacy } = summary;
  assert.equal(codeOf(validateFrameSummary(decodeOrThrow(wireJson, legacy))), undefined);
});
