// The capture tools the standalone dispatcher can answer: a bounded frame request, and the refusals for what only the sidecar holds.
import { findCompositionById } from "@extynt/project-graph";
import type { CompositionSnapshot, ProjectSnapshot } from "@extynt/project-graph";
import { toolError } from "./tool-result.js";
import type { Infer, JsonObject } from "@extynt/decode";
import { objectOf } from "./json.js";
import { AE_CAPTURE_COMPOSITION_FRAME, AE_GET_CAPTURE_FRAME } from "./tool-specs-read.js";
import type { ToolBase, ToolFailure, ToolRequest, ToolResult } from "./tool-result.js";

const DEFAULT_ENCODED_BYTES = 3_000_000;
const MIN_ENCODED_BYTES = 65_536;
const MAX_SIDE = 4096;
const MIN_PREVIEW = 16;
const MAX_PREVIEW = 1920;

type FrameArgs = Infer<typeof AE_CAPTURE_COMPOSITION_FRAME.input.decoder>;

type CaptureIdArgs = Infer<typeof AE_GET_CAPTURE_FRAME.input.decoder>;

interface Accepted<T> {
  readonly value: T;
}

interface CaptureTarget {
  readonly compositionId: string;
  readonly composition: CompositionSnapshot;
}

function captureComposition(snapshot: ProjectSnapshot, args: FrameArgs): CaptureTarget | ToolFailure {
  const requested = args.compositionId;
  const compositionId = requested === undefined || requested === "" ? snapshot.activeCompositionId ?? "" : requested;
  const composition = compositionId ? findCompositionById(snapshot, compositionId) : undefined;
  return composition ? { compositionId, composition } : toolError("TARGET_NOT_FOUND", "The requested composition is not present in the fresh snapshot.");
}

function captureTime(snapshot: ProjectSnapshot, args: FrameArgs, duration: number): Accepted<number> | ToolFailure {
  const time = args.time ?? snapshot.currentTime ?? 0;
  return time >= 0 && time <= duration ? { value: time } : toolError("INVALID_ARGUMENT", "Capture time must be within the composition duration.");
}

function wholeNumber(value: number | undefined): number | undefined {
  return value !== undefined && Number.isInteger(value) ? value : undefined;
}

function captureByteBudget(args: FrameArgs): Accepted<number> | ToolFailure {
  const value = wholeNumber(args.maxEncodedBytes) ?? DEFAULT_ENCODED_BYTES;
  return value >= MIN_ENCODED_BYTES && value <= DEFAULT_ENCODED_BYTES ? { value } : toolError("INVALID_ARGUMENT", "maxEncodedBytes must be an integer from 65536 through 3000000.");
}

function previewSize(args: FrameArgs, composition: CompositionSnapshot): Accepted<JsonObject> | ToolFailure {
  const maxWidth = wholeNumber(args.previewMaxWidth) ?? Math.min(1280, composition.width);
  const maxHeight = wholeNumber(args.previewMaxHeight) ?? Math.min(720, composition.height);
  const inRange = (side: number): boolean => side >= MIN_PREVIEW && side <= MAX_PREVIEW;
  return inRange(maxWidth) && inRange(maxHeight) ? { value: { maxWidth, maxHeight } } : toolError("INVALID_ARGUMENT", "Preview dimensions must be integers from 16 through 1920.");
}

function oversized(composition: CompositionSnapshot): ToolFailure | undefined {
  return composition.width > MAX_SIDE || composition.height > MAX_SIDE
    ? toolError("CAPTURE_RESOLUTION_UNSUPPORTED", "This local preview adapter supports native compositions up to 4096 pixels on either axis.")
    : undefined;
}

function frameRequest(base: ToolBase, snapshot: ProjectSnapshot, args: FrameArgs): ToolResult {
  const target = captureComposition(snapshot, args);
  if ("error" in target) return target;
  const { composition } = target;
  const time = captureTime(snapshot, args, composition.duration);
  if ("error" in time) return time;
  const unsupported = oversized(composition);
  if (unsupported) return unsupported;
  const bytes = captureByteBudget(args);
  if ("error" in bytes) return bytes;
  const preview = previewSize(args, composition);
  if ("error" in preview) return preview;
  const request = objectOf({ compositionId: target.compositionId, time: time.value, width: composition.width, height: composition.height, format: "png", shareWithProvider: false });
  return { ...base, data: objectOf({ request, preview: preview.value, maxEncodedBytes: bytes.value, status: "queued" }) };
}

const OBSERVE_MISSING = "No bounded capture exists for that ID, so there is nothing measured. This adapter holds no captures; the sidecar does, and it answers this tool there.";
const CAPTURE_MISSING = "No bounded capture exists for that ID. This adapter has no capture store; completed captures are held by the sidecar.";

function heldBySidecar(name: string, { captureId }: CaptureIdArgs): ToolResult {
  if (captureId.length < 1 || captureId.length > 96) return toolError("INVALID_ARGUMENT", "captureId is required and must be a string of 1 to 96 characters.");
  return toolError("CAPTURE_NOT_FOUND", name === "ae_observe_frame" ? OBSERVE_MISSING : CAPTURE_MISSING);
}

/** Queues a bounded frame request for the sidecar to carry out. */
export function captureFrameTool({ base, snapshot, args }: ToolRequest<FrameArgs>): ToolResult {
  return frameRequest(base, snapshot, args);
}

/** The refusal for a capture the sidecar holds, after the capture id has been checked. */
export function capturedFrameTool({ name, args }: ToolRequest<CaptureIdArgs>): ToolResult {
  return heldBySidecar(name, args);
}

/** The refusal for the build kit, which only the sidecar assembles. */
export function buildKitTool(): ToolResult {
  return toolError("BUILD_KIT_SIDECAR_ONLY", "ae_get_build_kit is answered by the sidecar; this adapter holds the briefing pieces it is built from nowhere.");
}
