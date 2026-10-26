// The verdict for create_vector_artwork, whichever importer built the composition.
import { array, boolean, decode, fallback, jsonValue, number, object, optional, string } from "@extynt/decode";
import type { Infer } from "@extynt/decode";
import type { HostStep } from "./host-step.js";
import type { Request } from "./plan-request.js";
import type { SnapshotComposition, SnapshotItem } from "./snapshot-reply.js";
import { vectorArtworkTimingMatches } from "./vector-timing.js";
import { exactStep, failedStep, unverifiedStep } from "./verdicts.js";
import type { Details, VerifiedStep } from "./verdicts.js";

const artworkEvidence = object({
  width: optional(fallback(number(), undefined)),
  height: optional(fallback(number(), undefined)),
  sourceHash: optional(fallback(string(), undefined)),
  svgMetadata: optional(fallback(object({ sourceHash: optional(fallback(string(), undefined)) }), undefined)),
  nativeShapeLayers: optional(fallback(number(), undefined)),
  persistsAfterUndo: optional(fallback(boolean(), undefined)),
  durationSeconds: optional(fallback(number(), undefined)),
  frameRate: optional(fallback(number(), undefined)),
  importer: optional(fallback(string(), undefined)),
  importNote: optional(fallback(jsonValue, undefined)),
  converterNotes: optional(fallback(jsonValue, undefined)),
  nativeFailure: optional(fallback(jsonValue, undefined)),
});

const artworkRequest = object({ fallbackSize: optional(fallback(array(number(), { minLength: 2 }), undefined)) });

type ArtworkEvidence = Infer<typeof artworkEvidence>;

interface ArtworkCall {
  readonly request: Request;
  readonly step: HostStep;
  readonly item: SnapshotItem;
  readonly comp: SnapshotComposition | null;
}

interface Artwork extends ArtworkCall {
  readonly kind: string;
  readonly evidence: ArtworkEvidence;
}

function pairOf(first: number | undefined, second: number | undefined): readonly [number, number] | undefined {
  return first !== undefined && second !== undefined ? [first, second] : undefined;
}

function requestedSize(request: Request): readonly [number, number] | undefined {
  const decoded = decode(artworkRequest, request.row);
  const size = decoded.ok ? decoded.value.fallbackSize : undefined;
  return size ? pairOf(size[0], size[1]) : undefined;
}

function failed(artwork: Artwork, basis: string, details: Details = {}): VerifiedStep {
  return failedStep(artwork.kind, basis, { itemId: artwork.item.id, ...details });
}

function unread(artwork: Artwork, basis: string, details: Details = {}): VerifiedStep {
  return unverifiedStep(artwork.kind, basis, { itemId: artwork.item.id, ...details });
}

function sizeRequestFinding(artwork: Artwork): VerifiedStep | undefined {
  const { width, height } = artwork.evidence;
  const reported = pairOf(width, height);
  const expected = requestedSize(artwork.request);
  const matches = !expected || (reported !== undefined && reported[0] === expected[0] && reported[1] === expected[1]);
  return matches ? undefined : failed(artwork, "managed-svg-converted-size-not-requested", { width, height });
}

function sizeFinding(artwork: Artwork): VerifiedStep | undefined {
  const requested = sizeRequestFinding(artwork);
  if (requested) return requested;
  const { comp } = artwork;
  const reported = pairOf(artwork.evidence.width, artwork.evidence.height);
  const observed = comp ? pairOf(comp.width, comp.height) : undefined;
  if (!comp || !observed) return unread(artwork, "managed-svg-converted-comp-not-in-snapshot");
  return reported && (observed[0] !== reported[0] || observed[1] !== reported[1]) ? failed(artwork, "managed-svg-converted-size-mismatch", { width: comp.width, height: comp.height }) : undefined;
}

function convertedFinding(artwork: Artwork): VerifiedStep | undefined {
  const size = sizeFinding(artwork);
  if (size) return size;
  const { comp } = artwork;
  if (!comp || comp.truncated || !comp.layers) return unread(artwork, "managed-svg-converted-layers-not-in-snapshot");
  return comp.layers.some((layer) => layer.type === "shape") ? undefined : failed(artwork, "managed-svg-converted-no-shape-layers");
}

function folderFinding(artwork: Artwork): VerifiedStep | undefined {
  const folder = artwork.step.parentFolderId;
  return typeof folder === "string" && artwork.item.parentFolderId !== folder ? failed(artwork, "managed-svg-folder-mismatch", { parentFolderId: artwork.item.parentFolderId }) : undefined;
}

function structuralMatch(artwork: Artwork): boolean {
  const { evidence } = artwork;
  const layers = evidence.nativeShapeLayers;
  return artwork.item.name === artwork.step.name && layers !== undefined && layers > 0 && evidence.sourceHash === evidence.svgMetadata?.sourceHash && evidence.persistsAfterUndo === true;
}

function timingFinding(artwork: Artwork): VerifiedStep | undefined {
  const { durationSeconds, frameRate } = artwork.evidence;
  const timing = vectorArtworkTimingMatches(artwork.comp, durationSeconds, frameRate);
  const details = { durationSeconds, frameRate };
  if (timing === false) return failed(artwork, "managed-svg-composition-timing-mismatch", details);
  return timing === true ? undefined : unread(artwork, "managed-svg-composition-timing-not-in-snapshot", details);
}

function convertedNotes(evidence: ArtworkEvidence): Details {
  return { importNote: evidence.importNote, converterNotes: evidence.converterNotes, ...(evidence.nativeFailure === undefined ? {} : { nativeFailure: evidence.nativeFailure }) };
}

function createdStep(artwork: Artwork, converted: boolean): VerifiedStep {
  const { evidence } = artwork;
  const basis = converted ? "managed-svg-hash-converted-shape-layers-and-composition-timing" : "managed-svg-hash-native-shapes-and-composition-timing";
  const details = { itemId: artwork.item.id, sourceHash: evidence.sourceHash, importer: converted ? "converted" : "native", nativeShapeLayers: evidence.nativeShapeLayers, durationSeconds: evidence.durationSeconds, frameRate: evidence.frameRate, visualFidelityVerified: false, managedSourcePersistsAfterUndo: true };
  return exactStep(artwork.kind, basis, converted ? { ...details, ...convertedNotes(evidence) } : details);
}

/** The verdict for one vector artwork step. An importer other than the native one is named in the receipt, never implied. */
export function verifyVectorArtworkCreated(call: ArtworkCall): VerifiedStep {
  const decoded = decode(artworkEvidence, call.step.row);
  const artwork = { ...call, kind: call.request.operation, evidence: decoded.ok ? decoded.value : {} };
  if (!structuralMatch(artwork)) return unread(artwork, "managed-svg-import-structural-evidence-incomplete");
  const converted = artwork.evidence.importer === "converted";
  const finding = folderFinding(artwork) ?? (converted ? convertedFinding(artwork) : undefined) ?? timingFinding(artwork);
  return finding ?? createdStep(artwork, converted);
}
