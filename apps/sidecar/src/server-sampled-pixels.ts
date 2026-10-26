// Summarises the pixels a capture sampled, so a receipt can report what the frame looked like without carrying the frame.
import { decode, number, object, string } from "@extynt/decode";
import { summarizeFrame } from "@extynt/visual-evidence";

const MAX_SAMPLED_PIXELS = 96 * 96;

const BYTES_PER_PIXEL = 4;
const BASE64_EXPANSION = 2;

const sample = object({
  width: number({ int: true, min: 1 }),
  height: number({ int: true, min: 1 }),
  rgba: string({ maxLength: MAX_SAMPLED_PIXELS * BYTES_PER_PIXEL * BASE64_EXPANSION }),
});

/** The summary of a sampled-pixel payload, or null when the payload is not a frame of the permitted size. */
export function summarizeSampledPixels<Payload>(payload: Payload): ReturnType<typeof summarizeFrame> | null {
  const read = decode(sample, payload);
  if (!read.ok) return null;
  const { width, height, rgba } = read.value;
  if (width * height > MAX_SAMPLED_PIXELS) return null;
  const bytes = Buffer.from(rgba, "base64");
  return bytes.length < width * height * BYTES_PER_PIXEL ? null : summarizeFrame(bytes, width, height);
}
