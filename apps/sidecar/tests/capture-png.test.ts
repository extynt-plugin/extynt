/** The PNG codecs and raster operations behind frame capture: round trips, every filter, 16-bit samples, refusals, area-average fit, flatten and sample. */
import assert from "node:assert/strict";
import { crc32, deflateSync } from "node:zlib";
import test from "node:test";
import { decodePng, pngIsComplete } from "../src/capture/png-decode.js";
import { encodePng } from "../src/capture/png-encode.js";
import { FILTER_PAETH, filterInto } from "../src/capture/png-filter.js";
import { fitImage, fitSize, flattenOver, samplePixels } from "../src/capture/png-fit.js";
import { PNG_SIGNATURE, type RawImage } from "../src/capture/png-types.js";

function pattern(width: number, height: number, alpha = true): RawImage {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) rgba.set([(x * 19) % 256, (y * 37) % 256, (x * y * 5) % 256, alpha ? 255 - ((x * 11 + y * 3) % 256) : 255], (y * width + x) * 4);
  }
  return { width, height, rgba };
}

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "latin1");
  out.set(data, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

interface Craft { width: number; height: number; bitDepth: number; colorType: number; interlace?: number; filter?: (row: number) => number; samples: (x: number, y: number) => number[] }

function craft(spec: Craft): Buffer {
  const channels = spec.colorType === 6 ? 4 : spec.colorType === 2 ? 3 : 1, sampleBytes = spec.bitDepth / 8, bytesPerPixel = channels * sampleBytes;
  const raw: number[] = [];
  let previous: Uint8Array = new Uint8Array(spec.width * bytesPerPixel);
  for (let y = 0; y < spec.height; y += 1) {
    const row = new Uint8Array(spec.width * bytesPerPixel);
    for (let x = 0; x < spec.width; x += 1) spec.samples(x, y).forEach((value, channel) => { for (let part = 0; part < sampleBytes; part += 1) row[(x * channels + channel) * sampleBytes + part] = (value >> (8 * (sampleBytes - 1 - part))) & 0xff; });
    const type = spec.filter ? spec.filter(y) : 0;
    const filtered = new Uint8Array(row.length);
    filterInto(type, { row, previous, bytesPerPixel }, filtered, 0);
    raw.push(type, ...filtered);
    previous = row;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(spec.width, 0); header.writeUInt32BE(spec.height, 4);
  header[8] = spec.bitDepth; header[9] = spec.colorType; header[12] = spec.interlace ?? 0;
  return Buffer.concat([Buffer.from(PNG_SIGNATURE), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.from(raw))), chunk("IEND", new Uint8Array(0))]);
}

function decoded(bytes: Uint8Array): RawImage {
  const result = decodePng(bytes);
  assert.ok(result.ok, result.ok ? "" : result.message);
  return result.ok ? result.image : { width: 0, height: 0, rgba: new Uint8Array(0) };
}

test("an RGBA image survives the encoder and decoder bit for bit, including alpha", () => {
  const image = pattern(37, 23);
  const bytes = encodePng(image);
  assert.equal(pngIsComplete(bytes), true);
  assert.deepEqual(decoded(bytes), image);
  assert.deepEqual(decoded(encodePng(pattern(1, 1))), pattern(1, 1), "a single pixel");
  assert.deepEqual(decoded(encodePng(pattern(300, 2))), pattern(300, 2), "a wide, short image");
});

test("an opaque image encodes as colour type 2 and decodes with full alpha", () => {
  const image = pattern(16, 9, false), bytes = encodePng(image, { opaque: true });
  assert.equal(bytes[25], 2, "IHDR colour type");
  assert.deepEqual(decoded(bytes), image);
  assert.ok(bytes.length < encodePng(image).length);
});

function assertFiltersDecode(colorType: number, bitDepth: number): void {
  const max = bitDepth === 8 ? 255 : 65535, channels = colorType === 6 ? 4 : 3;
  const samples = (x: number, y: number) => [(x * 4099 + y * 7) % (max + 1), (y * 2053 + x) % (max + 1), (x * y * 31) % (max + 1), (x + y * 977) % (max + 1)].slice(0, channels);
  const image = decoded(craft({ width: 9, height: 10, bitDepth, colorType, filter: (row) => row % (FILTER_PAETH + 1), samples }));
  for (let at = 0; at < 90; at += 1) {
    const x = at % 9, y = Math.floor(at / 9), expected = samples(x, y).map((value) => (bitDepth === 8 ? value : Math.round(value / 257)));
    assert.deepEqual([...image.rgba.subarray(at * 4, at * 4 + 4)], [...expected, ...(colorType === 6 ? [] : [255])], `type ${colorType}, ${bitDepth} bit, (${x},${y})`);
  }
}

test("every scanline filter decodes, at 8 and 16 bits and for colour types 2 and 6", () => {
  for (const colorType of [2, 6]) for (const bitDepth of [8, 16]) assertFiltersDecode(colorType, bitDepth);
});

test("PNGs written by another encoder decode to the pixels it was given", () => {
  const rgba = "iVBORw0KGgoAAAANSUhEUgAAAA0AAAAHCAYAAADTcMcaAAAAPElEQVR42mNkYGD4L8zA8JUUzMKgyvCXgYGVJIykiYtojKaJnyiMRZMIQYxDkyRejEeTHBZs/peBQe4vAPkHX8P1VfdyAAAAAElFTkSuQmCC";
  const rgb = "iVBORw0KGgoAAAANSUhEUgAAAAsAAAAJCAIAAABrBkF6AAAAQElEQVR42mNkYGAQxotYGFQZGBhY8SC4Ci5cCFkFP1aEpkIEE2GqkERDWFXIISNcKpQZGJQZGHQZGJTxqNCAIAC1bgd27v/mfgAAAABJRU5ErkJggg==";
  assert.deepEqual(decoded(Buffer.from(rgba, "base64")), pattern(13, 7));
  assert.deepEqual(decoded(Buffer.from(rgb, "base64")), pattern(11, 9, false));
});

function refusal(bytes: Uint8Array, limits?: { maxPixels: number }): string {
  const result = decodePng(bytes, limits);
  return result.ok ? "decoded" : result.code;
}

test("what is not a supported PNG is refused with a code and never guessed at", () => {
  const good = Buffer.from(encodePng(pattern(8, 8)));
  assert.equal(refusal(Buffer.from("not a png at all")), "PNG_SIGNATURE");
  assert.equal(refusal(good.subarray(0, good.length - 20)), "PNG_TRUNCATED");
  const corrupt = Buffer.from(good);
  corrupt[40] = (corrupt[40] ?? 0) ^ 0xff;
  assert.equal(refusal(corrupt), "PNG_CORRUPT", "a chunk whose checksum fails");
  assert.equal(refusal(craft({ width: 4, height: 4, bitDepth: 8, colorType: 6, interlace: 1, samples: () => [0, 0, 0, 255] })), "PNG_UNSUPPORTED", "interlaced");
  assert.equal(refusal(craft({ width: 4, height: 4, bitDepth: 8, colorType: 0, samples: () => [0] })), "PNG_UNSUPPORTED", "grayscale");
  assert.equal(refusal(craft({ width: 4, height: 4, bitDepth: 8, colorType: 3, samples: () => [0] })), "PNG_UNSUPPORTED", "palette");
  assert.equal(refusal(craft({ width: 4, height: 4, bitDepth: 4, colorType: 2, samples: () => [0, 0, 0] })), "PNG_UNSUPPORTED", "4-bit samples");
  assert.equal(refusal(good, { maxPixels: 10 }), "PNG_TOO_LARGE");
  assert.equal(refusal(Buffer.concat([Buffer.from(PNG_SIGNATURE), chunk("IEND", new Uint8Array(0))])), "PNG_CORRUPT", "no header and no data");
});

test("a bad filter byte or a short image stream is corrupt, not decoded", () => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(4, 0); header.writeUInt32BE(3, 4); header[8] = 8; header[9] = 6;
  const stream = (raw: Buffer) => Buffer.concat([Buffer.from(PNG_SIGNATURE), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array(0))]);
  assert.equal(refusal(stream(Buffer.alloc(3 * 17, 9))), "PNG_CORRUPT", "filter type 9");
  assert.equal(refusal(stream(Buffer.alloc(2 * 17))), "PNG_CORRUPT", "a row short");
  assert.equal(refusal(stream(Buffer.alloc(4 * 17))), "PNG_CORRUPT", "a row too many");
});

test("a half-written PNG is not complete", () => {
  const bytes = encodePng(pattern(20, 20));
  assert.equal(pngIsComplete(bytes), true);
  assert.equal(pngIsComplete(bytes.subarray(0, bytes.length - 1)), false);
  assert.equal(pngIsComplete(bytes.subarray(0, 40)), false);
  assert.equal(pngIsComplete(new Uint8Array(0)), false);
  assert.equal(pngIsComplete(new Uint8Array(40)), false);
});

test("a fit keeps the aspect, never enlarges and never reaches zero", () => {
  assert.deepEqual(fitSize(1920, 1080, 1280, 720), { width: 1280, height: 720 });
  assert.deepEqual(fitSize(1000, 4000, 240, 240), { width: 60, height: 240 });
  assert.deepEqual(fitSize(100, 50, 1280, 720), { width: 100, height: 50 }, "smaller than the bounds stays as it is");
  assert.deepEqual(fitSize(4000, 2, 100, 100), { width: 100, height: 1 });
  const small = pattern(8, 6);
  assert.equal(fitImage(small, 1280, 720), small, "nothing to do returns the image itself");
});

test("an area-average shrink averages every source pixel in each footprint", () => {
  const rgba = new Uint8Array(4 * 4 * 4);
  for (let y = 0; y < 4; y += 1) for (let x = 0; x < 4; x += 1) rgba.set([x < 2 ? 0 : 200, y < 2 ? 0 : 100, 40, 255], (y * 4 + x) * 4);
  const half = fitImage({ width: 4, height: 4, rgba }, 2, 2);
  assert.deepEqual([...half.rgba], [0, 0, 40, 255, 200, 0, 40, 255, 0, 100, 40, 255, 200, 100, 40, 255]);
  const mixed = fitImage({ width: 2, height: 1, rgba: Uint8Array.from([100, 0, 0, 255, 0, 100, 0, 255]) }, 1, 1);
  assert.deepEqual([...mixed.rgba], [50, 50, 0, 255]);
  const uniform = fitImage({ width: 100, height: 60, rgba: new Uint8Array(100 * 60 * 4).fill(77) }, 33, 20);
  assert.deepEqual([uniform.width, uniform.height, new Set(uniform.rgba).size, uniform.rgba[0]], [33, 19, 1, 77], "a uniform image stays uniform at a fractional ratio");
});

test("a fractional footprint weights the pixels by overlap and transparent pixels do not darken their neighbours", () => {
  const three = fitImage({ width: 3, height: 1, rgba: Uint8Array.from([0, 0, 0, 255, 90, 90, 90, 255, 180, 180, 180, 255]) }, 2, 1);
  assert.deepEqual([...three.rgba], [30, 30, 30, 255, 150, 150, 150, 255], "1.5 source pixels per destination pixel");
  const withHole = fitImage({ width: 2, height: 1, rgba: Uint8Array.from([255, 0, 0, 255, 0, 0, 0, 0]) }, 1, 1);
  assert.deepEqual([...withHole.rgba], [255, 0, 0, 128], "the colour is the opaque neighbour's; only the alpha halves");
});

test("flattening composites over the background and leaves every pixel opaque", () => {
  const image = { width: 3, height: 1, rgba: Uint8Array.from([255, 0, 0, 255, 255, 0, 0, 0, 255, 0, 0, 128]) };
  const flat = flattenOver(image, [0, 0, 1]);
  assert.deepEqual([...flat.rgba], [255, 0, 0, 255, 0, 0, 255, 255, 128, 0, 127, 255]);
  assert.deepEqual([...flattenOver(image, [2, -1, 0.5]).rgba.subarray(4, 8)], [255, 0, 128, 255], "a colour outside 0..1 is clamped");
  assert.deepEqual(image.rgba.subarray(0, 4), Uint8Array.from([255, 0, 0, 255]), "the source is not modified");
});

test("the receipt sample is bounded by 64 x 36 and carries RGBA as base64", () => {
  const wide = samplePixels(pattern(1920, 1080));
  assert.deepEqual([wide.width, wide.height], [64, 36]);
  assert.equal(Buffer.from(wide.rgba, "base64").length, 64 * 36 * 4);
  const tall = samplePixels(pattern(100, 1000));
  assert.deepEqual([tall.width, tall.height], [4, 36]);
  const tiny = samplePixels(pattern(10, 5));
  assert.deepEqual([tiny.width, tiny.height], [10, 5], "a small frame is sampled whole");
  assert.deepEqual([...Buffer.from(tiny.rgba, "base64")], [...pattern(10, 5).rgba]);
});

test("a frame goes through the whole capture path: decode, flatten, fit, encode, decode", () => {
  const frame = decoded(encodePng(pattern(640, 360)));
  const preview = fitImage(flattenOver(frame, [0.1, 0.2, 0.3]), 160, 90);
  const out = decoded(encodePng(preview, { opaque: true }));
  assert.deepEqual([out.width, out.height], [160, 90]);
  assert.ok(out.rgba.every((value, index) => index % 4 !== 3 || value === 255));
  assert.throws(() => encodePng({ width: 2, height: 2, rgba: new Uint8Array(3) }), RangeError);
});
