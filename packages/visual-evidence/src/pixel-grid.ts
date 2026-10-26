// A frame as RGBA values in row-major order, and the readers that keep every pixel access in range.
import type { Rgb } from "./color.js";

/** A frame's RGBA values and its size. */
export interface PixelGrid {
  readonly pixels: ArrayLike<number>;
  readonly width: number;
  readonly height: number;
}

const TRANSPARENT_BELOW = 8;
const OPAQUE = 255;

/** The alpha of the pixel at `index`; a missing value reads as opaque. */
export function alphaAt(pixels: ArrayLike<number>, index: number): number {
  return pixels[index * 4 + 3] ?? OPAQUE;
}

/** True when an alpha is too low for the pixel to count as drawn. */
export function isTransparent(alpha: number): boolean {
  return alpha < TRANSPARENT_BELOW;
}

/** The colour of the pixel at `index`; missing channels read as 0. */
export function rgbAt(pixels: ArrayLike<number>, index: number): Rgb {
  const at = index * 4;
  return [pixels[at] ?? 0, pixels[at + 1] ?? 0, pixels[at + 2] ?? 0];
}
