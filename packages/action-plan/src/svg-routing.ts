// Decides which importer builds an SVG, After Effects' own (26.0 and later) or extynt's converter, and words the converter's trade-offs; pure, so the AE 25 route runs on any host.

import type { SvgImporterRoute } from "./vector-artwork-decoder.js";

export type { SvgImporterRoute };

/**
 * What routing reads: the connected host's key or version string, such as "25.6 (123) macOS/arm64" or "After Effects:26.2.1:macOS"
 * (null when unknown), and the dev-only switch `forceConverter`, already gated by the sidecar's build kind.
 */
export interface SvgRoutingInput {
  hostKey: string | null | undefined;
  forceConverter?: boolean;
}

interface ConversionNotesInput {
  approximated?: readonly string[];
  skipped?: readonly string[];
}

const PLAUSIBLE_MAJORS = { min: 10, max: 99 };
const VERSION_TOKEN = /(?:^|[\s:/(])(\d{1,3}(?:\.\d{1,3}){0,3})(?![0-9])/;
const UNSUPPORTED_PAINT = "patterns and other unsupported paint are skipped";
const CLIP_MASK_FILTER = "clip paths, masks and filters are skipped";
const APPROXIMATED_WORDS: ReadonlyMap<string, string> = new Map([
  ["gradient", "gradients become solid colours"],
  ["group-opacity", "group opacity is applied to each shape"],
  ["non-uniform-stroke-scale", "stretched strokes keep an even width"],
  ["nested-svg", "nested SVGs are flattened"],
  ["unsupported-colour", "colours extynt cannot read are approximated"],
  ["malformed-path-data", "damaged path data is cut short"],
]);
const SKIPPED_WORDS: ReadonlyMap<string, string> = new Map([
  ["text", "text is skipped"],
  ["clip-path", CLIP_MASK_FILTER],
  ["mask", CLIP_MASK_FILTER],
  ["filter", CLIP_MASK_FILTER],
  ["stroke-dasharray", "dashed strokes are drawn solid"],
  ["invalid-transform", "shapes with an unreadable transform are skipped"],
  ["missing-paint-reference", "fills that point at missing paint are skipped"],
]);

/** The first After Effects major whose own SVG importer extynt uses. 26 is measured; 25 is decided by a run on a real AE 25 (set this to 25 when its importer works). Mirrors NATIVE_SVG_MIN_MAJOR in host-native and kNativeSvgMinMajor in core/host_version.cpp; a sidecar test holds the two TypeScript values equal. */
export const NATIVE_SVG_IMPORTER_MIN_MAJOR = 26;

export const SVG_IMPORTER_VERSION_PATTERN = /^\d{1,3}(?:\.\d{1,3}){0,3}$/;

function majorOf(version: string): number {
  return Number(version.split(".")[0]);
}

/** The leading dotted version in a host key or `app.version` text ("26.2x14" gives "26.2"), or null when there is none a real release could have; majors outside 10-99 are read as a malformed version, never as "old". */
export function aeVersionOf(hostKey: string | null | undefined): string | null {
  const version = typeof hostKey === "string" ? VERSION_TOKEN.exec(hostKey)?.[1] : undefined;
  if (version === undefined) return null;
  const major = majorOf(version);
  return major >= PLAUSIBLE_MAJORS.min && major <= PLAUSIBLE_MAJORS.max ? version : null;
}

/** A host older than 26 always routes to the converter; the switch forces it elsewhere; an unknown version keeps native first. */
export function svgImporterRoute(input: SvgRoutingInput): SvgImporterRoute {
  const version = aeVersionOf(input.hostKey);
  if (version !== null && majorOf(version) < NATIVE_SVG_IMPORTER_MIN_MAJOR) return { importer: "converter", importerAeVersion: version };
  return input.forceConverter === true ? { importer: "converter" } : {};
}

function wordsFor(code: string, table: ReadonlyMap<string, string>, fallback: string): string {
  return table.get(code) ?? (code.endsWith("-paint") ? UNSUPPORTED_PAINT : `${code} ${fallback}`);
}

/** The user-facing trade-offs of a conversion, in plain words, without repeats. */
export function converterTradeOffs(notes: ConversionNotesInput | undefined): string[] {
  const words = [
    ...(notes?.approximated ?? []).map((code) => wordsFor(code, APPROXIMATED_WORDS, "is approximated")),
    ...(notes?.skipped ?? []).map((code) => wordsFor(code, SKIPPED_WORDS, "is skipped")),
  ];
  return [...new Set(words)];
}
