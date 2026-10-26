// Reads SVG colour values (hex, rgb(), basic names) into 0-1 channels with an alpha.
import type { Rgb, Rgba } from "./svg-convert-types.js";

const NAMED: ReadonlyMap<string, Rgb> = new Map<string, Rgb>([
  ["black", [0, 0, 0]], ["silver", [192, 192, 192]], ["gray", [128, 128, 128]], ["grey", [128, 128, 128]],
  ["white", [255, 255, 255]], ["maroon", [128, 0, 0]], ["red", [255, 0, 0]], ["purple", [128, 0, 128]],
  ["fuchsia", [255, 0, 255]], ["magenta", [255, 0, 255]], ["green", [0, 128, 0]], ["lime", [0, 255, 0]],
  ["olive", [128, 128, 0]], ["yellow", [255, 255, 0]], ["navy", [0, 0, 128]], ["blue", [0, 0, 255]],
  ["teal", [0, 128, 128]], ["aqua", [0, 255, 255]], ["cyan", [0, 255, 255]], ["orange", [255, 165, 0]],
]);
const HEX_DIGITS = /^(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/iu;
const FUNCTIONAL = /^rgba?\(([^)]*)\)$/u;

function unit(channel: number): number {
  return Math.round((Math.min(255, Math.max(0, channel)) / 255) * 1e4) / 1e4;
}

function toColour(channels: readonly number[], alpha: number): Rgba | undefined {
  const [r, g, b] = channels;
  if (r === undefined || g === undefined || b === undefined || !channels.every(Number.isFinite) || !Number.isFinite(alpha)) return undefined;
  return { rgb: [unit(r), unit(g), unit(b)], alpha: Math.min(1, Math.max(0, alpha)) };
}

function hexColour(digits: string): Rgba | undefined {
  if (!HEX_DIGITS.test(digits)) return undefined;
  const long = digits.length <= 4 ? [...digits].map((digit) => digit + digit).join("") : digits;
  const bytes = [0, 2, 4, 6].map((offset) => (offset < long.length ? parseInt(long.slice(offset, offset + 2), 16) : 255));
  return toColour(bytes.slice(0, 3), (bytes[3] ?? 255) / 255);
}

function component(text: string, scale: number): number {
  return text.endsWith("%") ? (parseFloat(text) / 100) * scale : parseFloat(text);
}

function functionalColour(args: string): Rgba | undefined {
  const parts = args.trim().split(/[\s,/]+/u).filter(Boolean);
  if (parts.length < 3 || parts.length > 4) return undefined;
  const alpha = parts[3] === undefined ? 1 : component(parts[3], 1);
  return toColour(parts.slice(0, 3).map((part) => component(part, 255)), alpha);
}

function keywordColour(value: string): Rgba | undefined {
  if (value === "transparent") return { rgb: [0, 0, 0], alpha: 0 };
  const named = NAMED.get(value);
  return named ? toColour(named, 1) : undefined;
}

/** Hex (#rgb, #rgba, #rrggbb, #rrggbbaa), rgb()/rgba(), transparent or a basic colour name; anything else is undefined. */
export function parseColour(text: string): Rgba | undefined {
  const value = text.trim().toLowerCase();
  if (value.startsWith("#")) return hexColour(value.slice(1));
  const functional = FUNCTIONAL.exec(value);
  return functional ? functionalColour(functional[1] ?? "") : keywordColour(value);
}
