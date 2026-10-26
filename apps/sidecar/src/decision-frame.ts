// The frame-quality decision, advisory: asks a model how well the sampled frame shows the request and books a sentence when it finds the frame short; it adds a note to a completion and never refuses one.
import { FRAME_QUALITY, type DecisionImage, type DrawnLayer, type SampledFrame, withFittedBands } from "@extynt/decide";
import { bookLabel, bookedText } from "./decision-book.js";
import type { CaptureRecord } from "./server-types.js";
import type { DecisionService } from "./decision-service.js";
import type { FrameCheckRow } from "./verify/frame-check.js";

const FULL_LEVEL = 3;

const FRAME_DATA_URL = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/su;

const ADVICE: ReadonlyArray<string> = [
  "A model reading the sampled frame found nothing the request asked for drawn in it; check the frame before finishing.",
  "A model reading the sampled frame found something the request asked for beyond the frame; check its position.",
  "A model reading the sampled frame found a layer cut by the frame edge; check that it should be.",
];

const entryOf = (jobId: string) => ({ decision: "frame-quality-advice", text: jobId });

function drawn(row: FrameCheckRow): DrawnLayer {
  return { name: row.layer, text: false, box: row.box === undefined ? null : [row.box.left, row.box.top, row.box.right, row.box.bottom] };
}

/** The picture a capture's data URL holds, or undefined when there is none or it is not an image. */
export function imageOfDataUrl(dataUrl: string | undefined): DecisionImage | undefined {
  const [, mediaType, base64] = (dataUrl === undefined ? null : FRAME_DATA_URL.exec(dataUrl)) ?? [];
  return mediaType && base64 ? { mediaType, base64 } : undefined;
}

/** The newest completed capture of a composition that holds an image, as a picture; undefined when none does. */
export function latestFrameImage(captures: ReadonlyMap<string, CaptureRecord>, compositionId: string): DecisionImage | undefined {
  const held = [...captures.values()].filter((capture) => capture.status === "completed" && capture.receipt?.compositionId === compositionId && capture.receipt.dataUrl !== undefined);
  return imageOfDataUrl(held.at(-1)?.receipt?.dataUrl);
}

/** Asks the models once how well the job's sampled frames show its request, and books a note when they find the picture short of it; a model that accepts images also sees the picture when one is given. */
export async function adviseFrameQuality(service: DecisionService, input: { readonly jobId: string; readonly frame: Omit<SampledFrame, "layers">; readonly rows: ReadonlyArray<FrameCheckRow>; readonly image?: DecisionImage }): Promise<void> {
  if (!service.hasModels() || input.rows.length === 0) return;
  const state: SampledFrame = { ...input.frame, layers: input.rows.map(drawn) };
  const { settled } = await service.decideAll(state, { settled: withFittedBands(FRAME_QUALITY) }, { moment: "frame-gate", jobId: input.jobId, ...(input.image === undefined ? {} : { image: input.image }) }, FRAME_QUALITY.name);
  if (settled.source === "deterministic" || settled.level >= FULL_LEVEL) return;
  bookLabel(entryOf(input.jobId), ADVICE[settled.level] ?? "");
}

/** The note a model left for a job's completion, if any. */
export function frameAdvice(jobId: string): string | undefined {
  return bookedText(entryOf(jobId));
}
