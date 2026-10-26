/** PNG decoder over node:zlib: 8- and 16-bit, colour types 2 (RGB) and 6 (RGBA), non-interlaced. Anything else is refused with a code, never guessed at. Scanlines are reconstructed in place in the inflated buffer and widened row by row, so no pixel or row is copied twice. */
import { crc32, inflateSync } from "node:zlib";
import { FILTER_PAETH, unfilterRow } from "./png-filter.js";
import { PNG_IEND_TAIL, PNG_SIGNATURE, type RawImage } from "./png-types.js";

type PngFailureCode = "PNG_SIGNATURE" | "PNG_TRUNCATED" | "PNG_CORRUPT" | "PNG_UNSUPPORTED" | "PNG_TOO_LARGE";
type PngDecodeResult = { ok: true; image: RawImage } | { ok: false; code: PngFailureCode; message: string };
type PngDecodeLimits = { maxPixels?: number };
type Header = { width: number; height: number; bitDepth: number; colorType: number };
type Chunk = { type: string; data: Uint8Array };
type Failure = { ok: false; code: PngFailureCode; message: string };
type Chunks = { ok: true; header: Header; idat: Uint8Array[] } | Failure;
type Scan = { header: Header | null; idat: Uint8Array[] };
type Layout = { width: number; channels: number; sampleBytes: number };

const DEFAULT_MAX_PIXELS = 268_435_456;
const HEADER_LENGTH = 13;

const failure = (code: PngFailureCode, message: string): Failure => ({ ok: false, code, message });
const channelsOf = (header: Header): number => (header.colorType === 6 ? 4 : 3);
const rowBytesOf = (header: Header): number => header.width * channelsOf(header) * (header.bitDepth / 8);
const startsWithSignature = (bytes: Uint8Array): boolean => PNG_SIGNATURE.every((value, index) => bytes[index] === value);

/** True when `bytes` start with the PNG signature and end with a complete IEND chunk. A CEP-era file read could return a half-written file. */
export function pngIsComplete(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_SIGNATURE.length + PNG_IEND_TAIL.length || !startsWithSignature(bytes)) return false;
  const start = bytes.length - PNG_IEND_TAIL.length;
  return PNG_IEND_TAIL.every((value, index) => bytes[start + index] === value);
}

function readChunk(view: DataView, bytes: Uint8Array, offset: number): { chunk: Chunk; next: number } | Failure {
  if (offset + 12 > bytes.length) return failure("PNG_TRUNCATED", "The PNG ends before its IEND chunk.");
  const end = offset + 8 + view.getUint32(offset);
  if (end + 4 > bytes.length) return failure("PNG_TRUNCATED", "The PNG ends before its IEND chunk.");
  const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
  if (crc32(bytes.subarray(offset + 4, end)) !== view.getUint32(end)) return failure("PNG_CORRUPT", "A PNG chunk failed its checksum.");
  return { chunk: { type, data: bytes.subarray(offset + 8, end) }, next: end + 4 };
}

function parseHeader(data: Uint8Array): { header: Header } | Failure {
  if (data.length !== HEADER_LENGTH) return failure("PNG_CORRUPT", "The IHDR chunk has the wrong length.");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const header = { width: view.getUint32(0), height: view.getUint32(4), bitDepth: data[8] ?? 0, colorType: data[9] ?? 0 };
  if (data[10] !== 0 || data[11] !== 0) return failure("PNG_CORRUPT", "Unknown compression or filter method.");
  return data[12] === 0 ? { header } : failure("PNG_UNSUPPORTED", "Interlaced images are not supported.");
}

function unsupportedReason(header: Header): string | null {
  if (header.width < 1 || header.height < 1) return "the image has no pixels";
  if (header.bitDepth !== 8 && header.bitDepth !== 16) return `bit depth ${header.bitDepth} is not supported`;
  if (header.colorType !== 2 && header.colorType !== 6) return `colour type ${header.colorType} is not supported`;
  return null;
}

function absorb(scan: Scan, chunk: Chunk): Failure | null {
  if (chunk.type === "IDAT") scan.idat.push(chunk.data);
  if (chunk.type !== "IHDR") return null;
  const parsed = parseHeader(chunk.data);
  if ("ok" in parsed) return parsed;
  scan.header = parsed.header;
  return null;
}

function collectChunks(bytes: Uint8Array): Chunks {
  if (!startsWithSignature(bytes)) return failure("PNG_SIGNATURE", "The data is not a PNG.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), scan: Scan = { header: null, idat: [] };
  for (let offset = PNG_SIGNATURE.length;;) {
    const read = readChunk(view, bytes, offset);
    if ("ok" in read) return read;
    const failed = absorb(scan, read.chunk);
    if (failed) return failed;
    if (read.chunk.type === "IEND") break;
    offset = read.next;
  }
  return scan.header && scan.idat.length ? { ok: true, header: scan.header, idat: scan.idat } : failure("PNG_CORRUPT", "The PNG has no header or no image data.");
}

function filtersValid(raw: Uint8Array, height: number, stride: number): boolean {
  for (let y = 0; y < height; y += 1) if ((raw[y * stride] ?? 0) > FILTER_PAETH) return false;
  return true;
}

function inflateImage(idat: Uint8Array[], header: Header): Uint8Array | null {
  const stride = rowBytesOf(header) + 1, expected = header.height * stride;
  try {
    const out = inflateSync(idat.length === 1 && idat[0] ? idat[0] : Buffer.concat(idat), { maxOutputLength: expected });
    return out.length === expected && filtersValid(out, header.height, stride) ? out : null;
  } catch {
    return null;
  }
}

function sample(row: Uint8Array, index: number, sampleBytes: number): number {
  if (sampleBytes === 1) return row[index] ?? 0;
  return Math.round((((row[index] ?? 0) << 8) | (row[index + 1] ?? 0)) / 257);
}

function widenRow(row: Uint8Array, out: Uint8Array, offset: number, layout: Layout): void {
  const { width, channels, sampleBytes } = layout, step = channels * sampleBytes;
  if (channels === 4 && sampleBytes === 1) {
    out.set(row, offset);
    return;
  }
  for (let x = 0, from = 0, to = offset; x < width; x += 1, from += step, to += 4) {
    out[to] = sample(row, from, sampleBytes);
    out[to + 1] = sample(row, from + sampleBytes, sampleBytes);
    out[to + 2] = sample(row, from + 2 * sampleBytes, sampleBytes);
    out[to + 3] = channels === 4 ? sample(row, from + 3 * sampleBytes, sampleBytes) : 255;
  }
}

function toRgba(raw: Uint8Array, header: Header): Uint8Array {
  const layout: Layout = { width: header.width, channels: channelsOf(header), sampleBytes: header.bitDepth / 8 };
  const bytesPerPixel = layout.channels * layout.sampleBytes, rowBytes = rowBytesOf(header);
  const out = new Uint8Array(header.width * header.height * 4);
  let previous: Uint8Array = new Uint8Array(rowBytes);
  for (let y = 0; y < header.height; y += 1) {
    const start = y * (rowBytes + 1), row = raw.subarray(start + 1, start + 1 + rowBytes);
    unfilterRow(raw[start] ?? 0, { row, previous, bytesPerPixel });
    previous = row;
    widenRow(row, out, y * header.width * 4, layout);
  }
  return out;
}

function refusal(header: Header, maxPixels: number): Failure | null {
  const unsupported = unsupportedReason(header);
  if (unsupported) return failure("PNG_UNSUPPORTED", unsupported);
  return header.width * header.height > maxPixels ? failure("PNG_TOO_LARGE", `The image is ${header.width} x ${header.height}, over the pixel limit.`) : null;
}

/** Decodes a PNG into straight 8-bit RGBA, or says why it cannot; the default pixel limit is a 16384 x 16384 frame, the largest After Effects composition, and anything bigger is refused. */
export function decodePng(bytes: Uint8Array, limits: PngDecodeLimits = {}): PngDecodeResult {
  const chunks = collectChunks(bytes);
  if (!chunks.ok) return chunks;
  const { header, idat } = chunks, refused = refusal(header, limits.maxPixels ?? DEFAULT_MAX_PIXELS);
  if (refused) return refused;
  const raw = inflateImage(idat, header);
  return raw ? { ok: true, image: { width: header.width, height: header.height, rgba: toRgba(raw, header) } } : failure("PNG_CORRUPT", "The image data does not inflate to the size the header promises.");
}
