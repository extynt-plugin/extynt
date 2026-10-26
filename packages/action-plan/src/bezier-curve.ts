// The decoder for a CSS-style cubic-bezier curve, the one place its control-point ranges are stated; its type is what the decoder produces.
import { number, strictObject, type Infer } from "@extynt/decode";

/** Control points for the segment from one keyframe to the next: x within 0-1, y within -10 to 10; no other field. */
export const cubicBezierCurve = strictObject({
  x1: number({ min: 0, max: 1 }),
  y1: number({ min: -10, max: 10 }),
  x2: number({ min: 0, max: 1 }),
  y2: number({ min: -10, max: 10 }),
});

export type CubicBezierCurve = Infer<typeof cubicBezierCurve>;
