// scripts/lib/png-to-bmp.ts: the PNG reader (every scanline filter, RGB and RGBA) and the 24-bit BMP writer.
import assert from "node:assert/strict";
import test from "node:test";
import { deflateSync } from "node:zlib";
import { cropImage, decodePng, encodeBmp } from "../scripts/lib/png-to-bmp.ts";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  return Buffer.concat([length, Buffer.from(type, "latin1"), data, Buffer.alloc(4)]);
}

function png(size: { width: number; height: number }, colourType: number, scanlines: ReadonlyArray<ReadonlyArray<number>>): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size.width, 0);
  header.writeUInt32BE(size.height, 4);
  header.writeUInt8(8, 8);
  header.writeUInt8(colourType, 9);
  const raw = Buffer.from(scanlines.flat());
  return Buffer.concat([SIGNATURE, chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

test("every scanline filter is undone: none, sub, up, average and paeth", () => {
  const image = decodePng(png({ width: 2, height: 5 }, 2, [
    [0, 10, 20, 30, 40, 50, 60],
    [4, 1, 2, 3, 4, 5, 6],
    [1, 1, 1, 1, 1, 1, 1],
    [3, 0, 0, 0, 0, 0, 0],
    [2, 1, 1, 1, 1, 1, 1],
  ]));
  assert.deepEqual([image.width, image.height], [2, 5]);
  assert.deepEqual([...image.rgb.subarray(0, 6)], [10, 20, 30, 40, 50, 60]);
  assert.deepEqual([...image.rgb.subarray(6, 12)], [11, 22, 33, 44, 55, 66]);
  assert.deepEqual([...image.rgb.subarray(12, 18)], [1, 1, 1, 2, 2, 2]);
  assert.deepEqual([...image.rgb.subarray(18, 24)], [0, 0, 0, 1, 1, 1]);
  assert.deepEqual([...image.rgb.subarray(24, 30)], [1, 1, 1, 2, 2, 2]);
});

test("an RGBA image loses its alpha channel", () => {
  const image = decodePng(png({ width: 1, height: 1 }, 6, [[0, 1, 2, 3, 255]]));
  assert.deepEqual([...image.rgb], [1, 2, 3]);
});

test("other formats and non-PNG bytes are refused", () => {
  assert.throws(() => decodePng(Buffer.from("not a png at all")), /not a PNG/);
  assert.throws(() => decodePng(png({ width: 1, height: 1 }, 0, [[0, 7]])), /only 8-bit RGB/);
  assert.throws(() => decodePng(png({ width: 1, height: 1 }, 2, [[9, 1, 2, 3]])), /filter 9/);
});

test("cropping keeps the top-left corner and never grows the image", () => {
  const image = { width: 3, height: 2, rgb: Uint8Array.from({ length: 18 }, (_, index) => index) };
  const cropped = cropImage(image, { width: 2, height: 1 });
  assert.deepEqual([cropped.width, cropped.height, ...cropped.rgb], [2, 1, 0, 1, 2, 3, 4, 5]);
  assert.deepEqual(cropImage(image, { width: 9, height: 9 }), image);
});

test("the BMP is 24-bit, bottom row first, blue-green-red, each row padded to four bytes", () => {
  const bmp = encodeBmp({ width: 1, height: 2, rgb: Uint8Array.from([1, 2, 3, 4, 5, 6]) });
  assert.equal(bmp.toString("latin1", 0, 2), "BM");
  assert.equal(bmp.length, 54 + 2 * 4);
  assert.equal(bmp.readUInt32LE(2), bmp.length);
  assert.equal(bmp.readUInt32LE(10), 54);
  assert.deepEqual([bmp.readInt32LE(18), bmp.readInt32LE(22), bmp.readUInt16LE(28)], [1, 2, 24]);
  assert.deepEqual([...bmp.subarray(54)], [6, 5, 4, 0, 3, 2, 1, 0]);
});
