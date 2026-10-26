/** The frame pipeline's pixel work: shrink before flatten, one scanline filter for previews, and the worker thread that runs it. */
import assert from "node:assert/strict";
import test from "node:test";
import { decodePng } from "../src/capture/png-decode.js";
import { encodePng } from "../src/capture/png-encode.js";
import { flattenOver, fitImage } from "../src/capture/png-fit.js";
import type { RawImage } from "../src/capture/png-types.js";
import { derive } from "../src/host/frame-pipeline.js";
import { runFrameJob, type CaptureProduct, type FrameResult } from "../src/host/frame-job.js";
import { processFrame } from "../src/host/frame-worker-client.js";

function translucent(width: number, height: number): RawImage {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) rgba.set([(x * 13) % 256, (y * 29) % 256, (x * y) % 256, (x * 7 + y * 5) % 256], (y * width + x) * 4);
  return { width, height, rgba };
}

const BACKGROUND = [0.12, 0.5, 0.9] as const;

test("shrinking before flattening gives the picture flattening first would give, to within rounding", () => {
  const image = translucent(120, 70), bounds = { maxWidth: 40, maxHeight: 40 };
  const before = fitImage(flattenOver(image, BACKGROUND), bounds.maxWidth, bounds.maxHeight), after = derive(image, bounds, BACKGROUND).image;
  assert.deepEqual([after.width, after.height], [before.width, before.height]);
  let widest = 0;
  for (let at = 0; at < after.rgba.length; at += 1) widest = Math.max(widest, Math.abs((after.rgba[at] ?? 0) - (before.rgba[at] ?? 0)));
  assert.ok(widest <= 2, `largest channel difference ${widest}`);
  assert.ok(after.rgba.every((value, at) => at % 4 !== 3 || value === 255), "every alpha is opaque after the flatten");
});

test("one scanline filter for every row still decodes to the same pixels", () => {
  const image = translucent(33, 21);
  for (const filter of [0, 1, 2, 3, 4]) {
    const decoded = decodePng(encodePng(image, { filter }));
    assert.ok(decoded.ok && Buffer.compare(Buffer.from(decoded.image.rgba), Buffer.from(image.rgba)) === 0, `filter ${filter}`);
  }
  assert.throws(() => encodePng(image, { filter: 9 }), RangeError);
});

function captureOf(result: FrameResult): CaptureProduct | null {
  return result.ok && "capture" in result ? result.capture : null;
}

function thumbWidthOf(result: FrameResult | undefined): number | null {
  return result?.ok && "thumb" in result ? result.thumb.width : null;
}

function failureCodeOf(result: FrameResult | undefined): string | null {
  return result && !result.ok ? result.code : null;
}

test("a capture job shrinks, flattens and reports the sizes", () => {
  const bytes = encodePng(translucent(64, 36));
  const shrunk = captureOf(runFrameJob({ kind: "capture", bytes, preview: { maxWidth: 32, maxHeight: 18 }, background: BACKGROUND }));
  assert.deepEqual([shrunk?.previewWidth, shrunk?.previewHeight, shrunk?.resized, shrunk?.flattened, shrunk?.png !== null], [32, 18, true, true, true]);
});

test("a frame that needs no change comes back as no PNG, and an undecodable one as a failure", () => {
  const bytes = encodePng(translucent(64, 36));
  assert.equal(captureOf(runFrameJob({ kind: "capture", bytes, preview: { maxWidth: 1280, maxHeight: 720 }, background: null }))?.png, null);
  assert.equal(failureCodeOf(runFrameJob({ kind: "capture", bytes: new Uint8Array(40), preview: { maxWidth: 32, maxHeight: 18 }, background: null })), "CAPTURE_READ_FAILED");
});

test("the worker thread answers the same job, answers several at once in order, and does not block the event loop", async () => {
  const bytes = encodePng(translucent(640, 360)), job = { kind: "capture" as const, bytes, preview: { maxWidth: 320, maxHeight: 180 }, background: BACKGROUND };
  let ticks = 0;
  const timer = setInterval(() => { ticks += 1; }, 1);
  const results = await Promise.all([processFrame(job), processFrame({ kind: "thumb", bytes, background: null }), processFrame({ ...job, bytes: new Uint8Array(40) })]);
  clearInterval(timer);
  const direct = runFrameJob(job);
  const [first, second] = [captureOf(results[0]), captureOf(direct)];
  assert.ok(first && second);
  assert.equal(Buffer.compare(Buffer.from(first?.png ?? []), Buffer.from(second?.png ?? [])), 0, "the same derivative bytes");
  assert.deepEqual({ ...first, png: null }, { ...second, png: null });
  assert.equal(thumbWidthOf(results[1]), 240);
  assert.equal(failureCodeOf(results[2]), "CAPTURE_READ_FAILED");
  assert.ok(ticks > 0, "timers kept running while the worker worked");
});
