// Frame quality: a rubric score for how well one sampled frame shows what was asked, over the boxes of the drawn layers; advisory, it adds findings and never removes the deterministic ones.
import { score } from "./spec.js";
import type { ScoreSpec } from "./spec.js";

/** A drawn layer in a sampled frame: its name, whether it is text, and its bounding box [left, top, right, bottom] in pixels (null when nothing was measured). */
export type DrawnLayer = {
  readonly name: string;
  readonly text: boolean;
  readonly box: readonly [number, number, number, number] | null;
};

/** What the frame-quality decision reads: the request, the frame's size and the layers drawn in it. */
export type SampledFrame = {
  readonly request: string;
  readonly width: number;
  readonly height: number;
  readonly layers: ReadonlyArray<DrawnLayer>;
};

type Verdict = "IN_FRAME" | "OFF_FRAME" | "CLIPPED";

const CLIPPED_BELOW = 0.5;
const TEXT_CLIPPED_BELOW = 0.98;

function meets(a0: number, a1: number, b0: number, b1: number): boolean {
  return a1 > a0 ? a1 > b0 && a0 < b1 : a0 >= b0 && a0 <= b1;
}

function insideShare(box: readonly [number, number, number, number], width: number, height: number): number {
  const [left, top, right, bottom] = box;
  const area = (right - left) * (bottom - top);
  if (area <= 0) return 1;
  return (Math.max(0, Math.min(right, width) - Math.max(left, 0)) * Math.max(0, Math.min(bottom, height) - Math.max(top, 0))) / area;
}

function judge(layer: DrawnLayer, width: number, height: number): Verdict {
  if (layer.box === null) return "IN_FRAME";
  const [left, top, right, bottom] = layer.box;
  if (!meets(left, right, 0, width) || !meets(top, bottom, 0, height)) return "OFF_FRAME";
  const share = insideShare(layer.box, width, height);
  if (layer.text) return share < TEXT_CLIPPED_BELOW ? "CLIPPED" : "IN_FRAME";
  return (right - left) * (bottom - top) < width * height && share < CLIPPED_BELOW ? "CLIPPED" : "IN_FRAME";
}

/** How well a sampled frame shows what the request asked for, from the geometry of its layers: nothing drawn, something off frame, something clipped, or everything in frame. */
export const FRAME_QUALITY: ScoreSpec<SampledFrame> = score<SampledFrame>({
  name: "frame-quality",
  wantsImage: true,
  needsImage: true,
  instructions: "A motion designer asked for work in After Effects and one frame of the result was sampled. The state holds the request, the frame size and the pixel boxes of the layers drawn in the frame. Judge how well this frame shows what the request asked for.",
  levels: [
    "nothing the request asked for is drawn in this frame",
    "something the request asked for lies entirely or mostly beyond the frame, so little or none of it can be seen",
    "everything is at least partly in the frame but a layer is cut by the frame edge (a layer that is larger than the frame and covers it is not clipped, it is in frame)",
    "everything the request asked for is drawn and fully inside the frame",
  ],
  deterministic: (state) => {
    const verdicts = state.layers.map((layer) => judge(layer, state.width, state.height));
    if (state.layers.length === 0) return 0;
    if (verdicts.includes("OFF_FRAME")) return 1;
    return verdicts.includes("CLIPPED") ? 2 : 3;
  },
});
