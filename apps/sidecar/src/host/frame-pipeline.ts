// A frame After Effects saved as a PNG, turned into what the sidecar hands on: read from disk here, then decoded, shrunk
// by area averaging, flattened over the composition's background and encoded again on a worker thread (frame-job.ts), so
// none of that pixel work holds up the event loop. The PNG never leaves this computer except as the bounded derivative
// the receipt or the thumbnail carries.
import { readFile, unlink } from "node:fs/promises";
import { array, fallback, map, number } from "@extynt/decode";
import type { Decoder } from "@extynt/decode";
import { pngIsComplete } from "../capture/png-decode.js";
import { FILTER_PAETH } from "../capture/png-filter.js";
import { encodePng } from "../capture/png-encode.js";
import { fitImage, fitSize, flattenOver, samplePixels } from "../capture/png-fit.js";
import type { Background, PixelSample } from "../capture/png-fit.js";
import type { RawImage } from "../capture/png-types.js";

export interface FrameFailure { code: string; message: string }
type FrameBytes = { ok: true; bytes: Uint8Array } | ({ ok: false } & FrameFailure);

const pause = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

async function readOnce(path: string): Promise<Uint8Array | null> {
  try { const bytes = await readFile(path); return pngIsComplete(bytes) ? bytes : null; } catch { return null; }
}

const PENDING_TIMEOUT_MS = 8000;
const PENDING_POLL_MS = 150;

/**
 * A frame AE is still rendering when the capture call returns: AE 26 writes a heavy frame a second or more later.
 * Looks for either name the host may use until one holds a complete PNG, or the wait runs out.
 */
export async function readPendingFrame(paths: readonly string[], waitMs = PENDING_TIMEOUT_MS): Promise<{ ok: true; bytes: Uint8Array; path: string } | ({ ok: false } & FrameFailure)> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    for (const path of paths) {
      const bytes = await readOnce(path);
      if (bytes) return { ok: true, bytes, path };
    }
    if (Date.now() >= deadline) return { ok: false, code: "CAPTURE_WRITE_FAILED", message: `After Effects had not written the frame ${Math.round(waitMs / 1000)} s after the capture call.` };
    await pause(PENDING_POLL_MS);
  }
}

/**
 * Reads `path` once it holds a complete PNG. AE 25 makes the file visible as soon as it starts writing and finishes a
 * heavy frame (glow, blur, a 3D camera) a second or more later, so a short or unreadable file is waited for, not failed.
 */
export async function readFrame(path: string, waitMs = PENDING_TIMEOUT_MS): Promise<FrameBytes> {
  const got = await readPendingFrame([path], waitMs);
  return got.ok ? { ok: true, bytes: got.bytes } : { ok: false, code: "CAPTURE_INCOMPLETE", message: `The saved frame was still not a complete PNG ${Math.round(waitMs / 1000)} s after After Effects wrote it.` };
}

/** Removes the file the host saved; false when it could not be removed (the caller then asks the host to discard it by id). */
export async function removeFrame(path: string): Promise<boolean> {
  try { await unlink(path); return true; } catch { return false; }
}

interface Derivative {
  image: RawImage;
  resized: boolean;
  flattened: boolean;
  sample: PixelSample;
}

/** The frame inside `bounds` (aspect kept, never enlarged), over `background` when one is given. It is shrunk first and flattened after, so the flatten touches the small image only; averaging premultiplied pixels and then compositing equals compositing and then averaging, up to 8-bit rounding. */
export function derive(image: RawImage, bounds: { maxWidth: number; maxHeight: number }, background: Background | null): Derivative {
  const size = fitSize(image.width, image.height, bounds.maxWidth, bounds.maxHeight), resized = size.width !== image.width || size.height !== image.height;
  const shrunk = resized ? fitImage(image, bounds.maxWidth, bounds.maxHeight) : image, final = background ? flattenOver(shrunk, background) : shrunk;
  return { image: final, resized, flattened: background !== null, sample: samplePixels(final) };
}

/** Previews and thumbnails are encoded with this one scanline filter, not the best of five per row. */
export const PREVIEW_FILTER = FILTER_PAETH;

export const dataUrlOf = (png: Uint8Array): string => `data:image/png;base64,${Buffer.from(png).toString("base64")}`;

const THUMB_WIDTH = 240;
const THUMB_BACKGROUND: Background = [0.12, 0.12, 0.12];

export interface Thumbnail { dataUrl: string; width: number; height: number }

export function thumbnailOf(image: RawImage, background: Background | null): Thumbnail {
  const derived = derive(image, { maxWidth: THUMB_WIDTH, maxHeight: 1024 }, background ?? THUMB_BACKGROUND);
  return { dataUrl: dataUrlOf(encodePng(derived.image, { opaque: true, filter: PREVIEW_FILTER })), width: derived.image.width, height: derived.image.height };
}

function backgroundFrom(channels: readonly number[]): Background | null {
  const [red, green, blue] = channels;
  return red === undefined || green === undefined || blue === undefined || Number.isNaN(red + green + blue) ? null : [red, green, blue];
}

/** The background a request names: its first three channels when they are all numbers, else none. Channels are not clamped. */
export const frameBackground: Decoder<Background | null> = fallback(map(array(fallback(number(), Number.NaN)), backgroundFrom), null);
