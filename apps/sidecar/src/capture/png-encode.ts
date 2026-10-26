/** PNG encoder over node:zlib: 8-bit RGBA (colour type 6) or, for an opaque image, RGB (colour type 2); non-interlaced. Rows are filtered straight into the scanline buffer and the compressed data is never copied into a chunk. */
import { crc32, deflateSync } from "node:zlib";
import { FILTER_AVERAGE, FILTER_NONE, FILTER_PAETH, FILTER_SUB, FILTER_UP, filterCost, filterInto, type RowPair } from "./png-filter.js";
import { PNG_SIGNATURE, type RawImage } from "./png-types.js";

type PngEncodeOptions = {
  opaque?: boolean;
  level?: number;
  filter?: number;
};

const FILTERS = [FILTER_NONE, FILTER_SUB, FILTER_UP, FILTER_AVERAGE, FILTER_PAETH];

function chunk(type: string, data: Uint8Array): Uint8Array[] {
  const head = Buffer.alloc(8), tail = Buffer.alloc(4);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  tail.writeUInt32BE(crc32(data, crc32(head.subarray(4, 8))), 0);
  return [head, data, tail];
}

function header(image: RawImage, colorType: number): Uint8Array[] {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(image.width, 0);
  data.writeUInt32BE(image.height, 4);
  data[8] = 8;
  data[9] = colorType;
  return chunk("IHDR", data);
}

function cheapestFilter(pair: RowPair): number {
  let best = FILTER_NONE, bestCost = Infinity;
  for (const type of FILTERS) {
    const cost = filterCost(type, pair);
    if (cost < bestCost) {
      bestCost = cost;
      best = type;
    }
  }
  return best;
}

function packedRow(image: RawImage, channels: number, y: number, target: Uint8Array): Uint8Array {
  const start = y * image.width * 4;
  if (channels === 4) return image.rgba.subarray(start, start + image.width * 4);
  for (let x = 0, from = start, to = 0; x < image.width; x += 1, from += 4, to += 3) {
    target[to] = image.rgba[from] ?? 0;
    target[to + 1] = image.rgba[from + 1] ?? 0;
    target[to + 2] = image.rgba[from + 2] ?? 0;
  }
  return target;
}

function scanlines(image: RawImage, channels: number, filter: number | undefined): Uint8Array {
  const rowBytes = image.width * channels, out = new Uint8Array(image.height * (rowBytes + 1));
  const scratchBytes = channels === 3 ? rowBytes : 0, even = new Uint8Array(scratchBytes), odd = new Uint8Array(scratchBytes);
  let previous: Uint8Array = new Uint8Array(rowBytes);
  for (let y = 0; y < image.height; y += 1) {
    const pair: RowPair = { row: packedRow(image, channels, y, y % 2 === 0 ? even : odd), previous, bytesPerPixel: channels };
    const type = filter ?? cheapestFilter(pair), at = y * (rowBytes + 1);
    out[at] = type;
    filterInto(type, pair, out, at + 1);
    previous = pair.row;
  }
  return out;
}

function validate(image: RawImage, options: PngEncodeOptions): void {
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1 || image.rgba.length !== image.width * image.height * 4) throw new RangeError("encodePng needs a width x height x 4 RGBA buffer.");
  if (options.filter !== undefined && !FILTERS.includes(options.filter)) throw new RangeError("encodePng filter must be 0 to 4.");
}

/**
 * Encodes the image as a PNG. `opaque` drops the alpha channel (the caller states every pixel is opaque; alpha is not looked
 * at), `level` is the zlib level 0 to 9 (default 6, the best size for the time on photographic frames), and `filter` fixes one
 * scanline filter (0 to 4) instead of trying all five per row: about five times less encoder time for a preview, at a few per
 * cent more bytes. Throws a RangeError for a buffer that is not width x height x 4 or a filter outside 0 to 4.
 */
export function encodePng(image: RawImage, options: PngEncodeOptions = {}): Uint8Array {
  validate(image, options);
  const channels = options.opaque === true ? 3 : 4;
  const data = deflateSync(scanlines(image, channels, options.filter), { level: options.level ?? 6 });
  return Buffer.concat([Uint8Array.from(PNG_SIGNATURE), ...header(image, channels === 4 ? 6 : 2), ...chunk("IDAT", data), ...chunk("IEND", new Uint8Array(0))]);
}
