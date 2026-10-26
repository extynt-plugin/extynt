// The pixel work for one saved frame, as a pure function: decode, shrink, flatten, encode. It runs on a worker thread
// (frame-worker.ts) so a 1920 x 1080 capture does not hold up the event loop; tests call it directly.
import { decodePng } from "../capture/png-decode.js";
import { encodePng } from "../capture/png-encode.js";
import type { Background, PixelSample } from "../capture/png-fit.js";
import { derive, PREVIEW_FILTER, thumbnailOf, type FrameFailure, type Thumbnail } from "./frame-pipeline.js";

/** One unit of pixel work for the frame worker: a capture to bound or a thumbnail to make. */
export type FrameJob =
  | { kind: "capture"; bytes: Uint8Array; preview: { maxWidth: number; maxHeight: number }; background: Background | null }
  | { kind: "thumb"; bytes: Uint8Array; background: Background | null };

/** What a capture job yields; `png` is the bounded derivative, or null when the frame needs no change and the file the host wrote goes out as it is. */
export interface CaptureProduct {
  originalWidth: number;
  originalHeight: number;
  previewWidth: number;
  previewHeight: number;
  resized: boolean;
  flattened: boolean;
  sample: PixelSample;
  png: Uint8Array | null;
}

/** The outcome of a frame job: a capture product, a thumbnail or the failure that ended it. */
export type FrameResult = { ok: true; capture: CaptureProduct } | { ok: true; thumb: Thumbnail } | ({ ok: false } & FrameFailure);

const unreadable = (code: string): FrameResult => ({ ok: false, code: "CAPTURE_READ_FAILED", message: `The saved frame could not be decoded (${code}).` });

function capture(job: Extract<FrameJob, { kind: "capture" }>): FrameResult {
  const decoded = decodePng(job.bytes);
  if (!decoded.ok) return unreadable(decoded.code);
  const { image } = decoded, derived = derive(image, job.preview, job.background), unchanged = !derived.resized && !derived.flattened;
  const png = unchanged ? null : encodePng(derived.image, { opaque: derived.flattened, filter: PREVIEW_FILTER });
  return { ok: true, capture: { originalWidth: image.width, originalHeight: image.height, previewWidth: derived.image.width, previewHeight: derived.image.height, resized: derived.resized, flattened: derived.flattened, sample: derived.sample, png } };
}

export function runFrameJob(job: FrameJob): FrameResult {
  if (job.kind === "capture") return capture(job);
  const decoded = decodePng(job.bytes);
  if (!decoded.ok) return unreadable(decoded.code);
  return { ok: true, thumb: thumbnailOf(decoded.image, job.background) };
}
