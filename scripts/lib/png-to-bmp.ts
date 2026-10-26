// Reads the 8-bit RGB or RGBA PNG a headless browser screenshot writes and writes a cropped 24-bit BMP, which is the
// image format Inno Setup reads for the wizard artwork. No dependency: node:zlib inflates, the filters are undone here.
import { inflateSync } from "node:zlib";

/** Pixels as tightly packed red, green, blue bytes, top row first. */
export interface RgbImage {
  readonly width: number;
  readonly height: number;
  readonly rgb: Uint8Array;
}

/** The width and height of the top-left rectangle that is kept. */
export interface CropSize {
  readonly width: number;
  readonly height: number;
}

interface Header {
  readonly width: number;
  readonly height: number;
  readonly channels: number;
}

interface Neighbours {
  readonly left: number;
  readonly up: number;
  readonly upLeft: number;
}

interface Scanline {
  readonly filter: number;
  readonly filtered: Uint8Array;
  readonly previous: Uint8Array;
  readonly bytesPerPixel: number;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS_BY_COLOUR_TYPE: ReadonlyMap<number, number> = new Map([[2, 3], [6, 4]]);
const BMP_FILE_HEADER_BYTES = 14;
const BMP_INFO_HEADER_BYTES = 40;
const PIXELS_PER_METRE_AT_96_DPI = 3780;

function byteAt(bytes: Uint8Array, index: number): number {
  return bytes[index] ?? 0;
}

function paeth({ left, up, upLeft }: Neighbours): number {
  const estimate = left + up - upLeft;
  const distanceLeft = Math.abs(estimate - left);
  const distanceUp = Math.abs(estimate - up);
  const distanceUpLeft = Math.abs(estimate - upLeft);
  if (distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft) return left;
  return distanceUp <= distanceUpLeft ? up : upLeft;
}

const PREDICTORS: ReadonlyArray<(neighbours: Neighbours) => number> = [
  () => 0,
  ({ left }) => left,
  ({ up }) => up,
  ({ left, up }) => (left + up) >> 1,
  paeth,
];

function unfilterScanline({ filter, filtered, previous, bytesPerPixel }: Scanline): Uint8Array {
  const predictor = PREDICTORS[filter];
  if (!predictor) throw new Error(`PNG scanline filter ${filter} is not defined`);
  const row = new Uint8Array(filtered.length);
  for (let index = 0; index < filtered.length; index += 1) {
    const left = index >= bytesPerPixel ? byteAt(row, index - bytesPerPixel) : 0;
    const upLeft = index >= bytesPerPixel ? byteAt(previous, index - bytesPerPixel) : 0;
    row[index] = (byteAt(filtered, index) + predictor({ left, up: byteAt(previous, index), upLeft })) & 0xff;
  }
  return row;
}

function readChunks(png: Buffer): ReadonlyMap<string, Buffer[]> {
  if (!png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) throw new Error("not a PNG file");
  const chunks = new Map<string, Buffer[]>();
  for (let offset = PNG_SIGNATURE.length; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("latin1", offset + 4, offset + 8);
    chunks.set(type, [...(chunks.get(type) ?? []), png.subarray(offset + 8, offset + 8 + length)]);
    offset += 12 + length;
  }
  return chunks;
}

function readHeader(chunks: ReadonlyMap<string, Buffer[]>): Header {
  const [header] = chunks.get("IHDR") ?? [];
  if (!header) throw new Error("PNG has no header chunk");
  const channels = CHANNELS_BY_COLOUR_TYPE.get(header.readUInt8(9));
  if (channels === undefined || header.readUInt8(8) !== 8 || header.readUInt8(12) !== 0) throw new Error("only 8-bit RGB and RGBA PNGs without interlacing are read");
  return { width: header.readUInt32BE(0), height: header.readUInt32BE(4), channels };
}

function rgbOfRow(row: Uint8Array, header: Header): Uint8Array {
  const rgb = new Uint8Array(header.width * 3);
  for (let pixel = 0; pixel < header.width; pixel += 1) {
    for (let channel = 0; channel < 3; channel += 1) rgb[pixel * 3 + channel] = byteAt(row, pixel * header.channels + channel);
  }
  return rgb;
}

/** The pixels of an 8-bit RGB or RGBA, non-interlaced PNG; alpha is dropped. */
export function decodePng(png: Buffer): RgbImage {
  const chunks = readChunks(png);
  const header = readHeader(chunks);
  const inflated = inflateSync(Buffer.concat(chunks.get("IDAT") ?? []));
  const rowBytes = header.width * header.channels;
  const rgb = new Uint8Array(header.width * header.height * 3);
  let previous: Uint8Array = new Uint8Array(rowBytes);
  for (let y = 0; y < header.height; y += 1) {
    const start = y * (rowBytes + 1);
    const filtered = inflated.subarray(start + 1, start + 1 + rowBytes);
    previous = unfilterScanline({ filter: byteAt(inflated, start), filtered, previous, bytesPerPixel: header.channels });
    rgb.set(rgbOfRow(previous, header), y * header.width * 3);
  }
  return { width: header.width, height: header.height, rgb };
}

/** The top-left `size` of the image; the image itself when it is not larger. */
export function cropImage(image: RgbImage, size: CropSize): RgbImage {
  const width = Math.min(image.width, size.width);
  const height = Math.min(image.height, size.height);
  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y += 1) rgb.set(image.rgb.subarray(y * image.width * 3, y * image.width * 3 + width * 3), y * width * 3);
  return { width, height, rgb };
}

function bmpHeaders(image: RgbImage, rowBytes: number): Buffer {
  const pixelBytes = rowBytes * image.height;
  const headers = Buffer.alloc(BMP_FILE_HEADER_BYTES + BMP_INFO_HEADER_BYTES);
  headers.write("BM", 0, "latin1");
  headers.writeUInt32LE(headers.length + pixelBytes, 2);
  headers.writeUInt32LE(headers.length, 10);
  headers.writeUInt32LE(BMP_INFO_HEADER_BYTES, 14);
  headers.writeInt32LE(image.width, 18);
  headers.writeInt32LE(image.height, 22);
  headers.writeUInt16LE(1, 26);
  headers.writeUInt16LE(24, 28);
  headers.writeUInt32LE(pixelBytes, 34);
  headers.writeInt32LE(PIXELS_PER_METRE_AT_96_DPI, 38);
  headers.writeInt32LE(PIXELS_PER_METRE_AT_96_DPI, 42);
  return headers;
}

/** A 24-bit uncompressed BMP: bottom row first, blue-green-red, each row padded to four bytes. */
export function encodeBmp(image: RgbImage): Buffer {
  const rowBytes = Math.ceil((image.width * 3) / 4) * 4;
  const pixels = Buffer.alloc(rowBytes * image.height);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const source = (y * image.width + x) * 3;
      const target = (image.height - 1 - y) * rowBytes + x * 3;
      pixels.set([byteAt(image.rgb, source + 2), byteAt(image.rgb, source + 1), byteAt(image.rgb, source)], target);
    }
  }
  return Buffer.concat([bmpHeaders(image, rowBytes), pixels]);
}
