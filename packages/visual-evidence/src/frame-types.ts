// The shapes of a frame summary and of the options that steer it. A summary is bounded, so it can sit in a prompt where the frame cannot.
import type { Rgb } from "./color.js";

/** Where the content is, in 0-1 frame coordinates. */
export interface ContentBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** One colour on screen as `#rrggbb` and its 0-1 share of the frame. */
export interface DominantColor {
  readonly hex: string;
  readonly fraction: number;
}

/**
 * What the caller may say about a frame. `background` is the colour that means nothing is here and defaults to the frame's own most
 * common colour; `tolerance` is the per-channel difference, 0-255, that counts as content; `regions` is the grid size.
 */
export interface FrameSummaryOptions {
  readonly background?: Rgb;
  readonly tolerance?: number;
  readonly regions?: 1 | 2 | 3;
  readonly dominantColors?: number;
}

/**
 * A frame reduced to numbers and short strings; nothing in it is a pixel and nothing in it grows with the frame. `background` is the
 * colour treated as empty, `contentFraction` and `transparentFraction` are 0-1 shares of the pixels, and `regionContent` is the content
 * share per grid cell, row-major. `contentBox` is null when nothing differs, `dominantColors` is most common first, and `cellLuma`
 * (mean luminance 0-255) and `cellColors` (commonest `#rrggbb`) let a reader without eyes see one cell get brighter or change colour.
 */
export interface FrameSummary {
  readonly width: number;
  readonly height: number;
  readonly background: Rgb;
  readonly contentFraction: number;
  readonly transparentFraction: number;
  readonly regionContent: number[];
  readonly contentBox: ContentBox | null;
  readonly dominantColors: DominantColor[];
  readonly cellLuma?: number[];
  readonly cellColors?: string[];
}
