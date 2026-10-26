// Shared types of the SVG converter: points, matrices, colours and the converted shape forms it hands to the host.
import type { ConvertedFill, ConvertedLayer, ConvertedShape, ConvertedStroke, SvgConversionNotes } from "./vector-artwork-decoder.js";

export type { ConvertedFill, ConvertedLayer, ConvertedShape, ConvertedStroke, SvgConversionNotes };

export type Point = [number, number];

/** SVG matrix(a b c d e f): x' = a*x + c*y + e, y' = b*x + d*y + f. */
export type Matrix = [number, number, number, number, number, number];

export type Rgb = [number, number, number];

export interface Rgba {
  rgb: Rgb;
  alpha: number;
}

export type SvgConversion =
  | { ok: true; layers: ConvertedLayer[]; size: [number, number]; notes: SvgConversionNotes }
  | { ok: false; reason: string };

/** The size limits a conversion enforces; an SVG over any of them gets no converter fallback. */
export const CONVERTER_LIMITS = { maxShapes: 256, maxPoints: 12_000, maxPathsPerShape: 64, maxVerticesPerPath: 1_000, maxLayers: 256, maxCompSize: 30_000 } as const;

/** Collects feature names once each, in the order first met. */
export class NoteSink {
  private readonly approximated = new Set<string>();
  private readonly skipped = new Set<string>();

  public approximate(name: string): void {
    this.approximated.add(name);
  }

  public skip(name: string): void {
    this.skipped.add(name);
  }

  public toNotes(): SvgConversionNotes {
    return { approximated: [...this.approximated], skipped: [...this.skipped] };
  }
}
