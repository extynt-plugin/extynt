/** A solid-colour PNG of the size a capture asked for: what the fake host "saves" for `aeCaptureFrame`. */
import { crc32, deflateSync } from "node:zlib";

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]), head = Buffer.alloc(4), tail = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  tail.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, tail]);
}

function encodePng(width: number, height: number, pixels: Buffer): Buffer {
  const header = Buffer.alloc(13), stride = width * 4, raw = Buffer.alloc((1 + stride) * height);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  for (let y = 0; y < height; y += 1) pixels.copy(raw, y * (1 + stride) + 1, y * stride, (y + 1) * stride);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

export function solidPng(width: number, height: number, rgba: readonly [number, number, number, number] = [40, 90, 200, 255]): Buffer {
  const pixels = Buffer.alloc(width * height * 4);
  for (let at = 0; at < pixels.length; at += 4) pixels.set(rgba, at);
  return encodePng(width, height, pixels);
}

export interface SceneRect { x: number; y: number; width: number; height: number; rgb: readonly [number, number, number] }

/** A crude stand-in for a rendered frame: filled axis-aligned rectangles (pixel units, painted in order) over a flat background. */
export function scenePng(width: number, height: number, background: readonly [number, number, number], rects: readonly SceneRect[]): Buffer {
  const pixels = Buffer.alloc(width * height * 4);
  for (let at = 0; at < pixels.length; at += 4) pixels.set([...background, 255], at);
  for (const rect of rects) {
    const x0 = Math.max(0, Math.round(rect.x)),
      x1 = Math.min(width, Math.round(rect.x + rect.width)),
      y0 = Math.max(0, Math.round(rect.y)),
      y1 = Math.min(height, Math.round(rect.y + rect.height));
    for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) pixels.set([...rect.rgb, 255], (y * width + x) * 4);
  }
  return encodePng(width, height, pixels);
}
