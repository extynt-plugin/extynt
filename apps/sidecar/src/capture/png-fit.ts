/** Raster operations on `RawImage`: bounded area-average resize, flattening over a background colour, and the small pixel sample a capture receipt carries. The resize reuses one accumulator and one footprint box for the whole frame. */
import type { RawImage } from "./png-types.js";

type FitSize = { width: number; height: number };
type Sums = { red: number; green: number; blue: number; alpha: number; weight: number };
type Footprint = { x0: number; x1: number; y0: number; y1: number };

/** A background as RGB in 0..1, the form After Effects reports a composition colour in. */
export type Background = readonly [number, number, number];
/** A frame shrunk to at most 64 x 36 with its RGBA bytes in base64. */
export interface PixelSample { width: number; height: number; rgba: string }

const SAMPLE_MAX_WIDTH = 64;
const SAMPLE_MAX_HEIGHT = 36;
const clampByte = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));

/** The size `width` x `height` shrinks to inside the bounds, keeping its aspect; never larger than the source. */
export function fitSize(width: number, height: number, maxWidth: number, maxHeight: number): FitSize {
  const ratio = Math.min(1, maxWidth / width, maxHeight / height);
  return { width: Math.max(1, Math.floor(width * ratio)), height: Math.max(1, Math.floor(height * ratio)) };
}

function addPixel(image: RawImage, at: number, weight: number, sums: Sums): void {
  const a = (image.rgba[at + 3] ?? 0) / 255;
  sums.red += (image.rgba[at] ?? 0) * a * weight;
  sums.green += (image.rgba[at + 1] ?? 0) * a * weight;
  sums.blue += (image.rgba[at + 2] ?? 0) * a * weight;
  sums.alpha += a * weight;
  sums.weight += weight;
}

function accumulate(image: RawImage, box: Footprint, sums: Sums): void {
  Object.assign(sums, { red: 0, green: 0, blue: 0, alpha: 0, weight: 0 });
  for (let y = Math.floor(box.y0); y < Math.ceil(box.y1); y += 1) {
    const wy = Math.min(y + 1, box.y1) - Math.max(y, box.y0);
    for (let x = Math.floor(box.x0); x < Math.ceil(box.x1); x += 1) addPixel(image, (y * image.width + x) * 4, wy * (Math.min(x + 1, box.x1) - Math.max(x, box.x0)), sums);
  }
}

function store(out: Uint8Array, at: number, sums: Sums): void {
  const alpha = sums.alpha / sums.weight;
  out[at] = alpha > 0 ? clampByte(sums.red / sums.weight / alpha) : 0;
  out[at + 1] = alpha > 0 ? clampByte(sums.green / sums.weight / alpha) : 0;
  out[at + 2] = alpha > 0 ? clampByte(sums.blue / sums.weight / alpha) : 0;
  out[at + 3] = clampByte(alpha * 255);
}

function resizeArea(image: RawImage, width: number, height: number): RawImage {
  if (width === image.width && height === image.height) return image;
  const out = new Uint8Array(width * height * 4), scaleX = image.width / width, scaleY = image.height / height;
  const sums: Sums = { red: 0, green: 0, blue: 0, alpha: 0, weight: 0 }, box: Footprint = { x0: 0, x1: 0, y0: 0, y1: 0 };
  for (let y = 0; y < height; y += 1) {
    box.y0 = y * scaleY;
    box.y1 = Math.min(image.height, (y + 1) * scaleY);
    for (let x = 0; x < width; x += 1) {
      box.x0 = x * scaleX;
      box.x1 = Math.min(image.width, (x + 1) * scaleX);
      accumulate(image, box, sums);
      store(out, (y * width + x) * 4, sums);
    }
  }
  return { width, height, rgba: out };
}

/** Shrinks into the bounds by area averaging, so every source pixel contributes in proportion to its overlap (aspect kept, never enlarged). */
export function fitImage(image: RawImage, maxWidth: number, maxHeight: number): RawImage {
  const size = fitSize(image.width, image.height, maxWidth, maxHeight);
  return resizeArea(image, size.width, size.height);
}

/** Composites over an opaque background, so the result carries alpha 255 everywhere. */
export function flattenOver(image: RawImage, background: Background): RawImage {
  const channels = background.map((value) => Math.round(Math.max(0, Math.min(1, value)) * 255));
  const out = new Uint8Array(image.rgba.length);
  for (let at = 0; at < out.length; at += 4) {
    const alpha = (image.rgba[at + 3] ?? 0) / 255;
    for (let channel = 0; channel < 3; channel += 1) out[at + channel] = Math.round((image.rgba[at + channel] ?? 0) * alpha + (channels[channel] ?? 0) * (1 - alpha));
    out[at + 3] = 255;
  }
  return { width: image.width, height: image.height, rgba: out };
}

/** The receipt's `sampledPixels`: the image shrunk inside 64 x 36 (rounded, as the panel's canvas was) and its RGBA bytes in base64. */
export function samplePixels(image: RawImage): PixelSample {
  const scale = Math.min(1, SAMPLE_MAX_WIDTH / image.width, SAMPLE_MAX_HEIGHT / image.height);
  const small = resizeArea(image, Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)));
  return { width: small.width, height: small.height, rgba: Buffer.from(small.rgba.buffer, small.rgba.byteOffset, small.rgba.byteLength).toString("base64") };
}
