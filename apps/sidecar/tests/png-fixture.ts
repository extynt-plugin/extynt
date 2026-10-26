/** Frames for the capture tests. `FIXTURE_PNG` was written by Python's zlib, not by this repository's encoder, so the decoder is held to what another encoder produces. */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodePng } from "../src/capture/png-encode.js";

/** 16 x 16, RGBA: the left half opaque red (220, 30, 30), the right half fully transparent. */
export const FIXTURE_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAG0lEQVR4nGO4Iyf3Hx9mIARGDRg1YNSA4WIAAB6gC5D33d/+AAAAAElFTkSuQmCC";
export const FIXTURE_PNG = Buffer.from(FIXTURE_PNG_BASE64, "base64");

/** A solid frame of the given size, encoded by this repository's encoder. */
export function solidPng(width: number, height: number, rgb: readonly [number, number, number] = [40, 90, 200]): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let at = 0; at < rgba.length; at += 4) { rgba[at] = rgb[0]; rgba[at + 1] = rgb[1]; rgba[at + 2] = rgb[2]; rgba[at + 3] = 255; }
  return encodePng({ width, height, rgba });
}

/** A directory for the frames the fake host "saves", and a way to put a file in it. */
export function frameDirectory(): { path: string; write(name: string, bytes: Uint8Array): string } {
  const path = mkdtempSync(join(tmpdir(), "extynt-frames-"));
  return { path, write: (name, bytes) => { const file = join(path, name); writeFileSync(file, bytes); return file; } };
}
