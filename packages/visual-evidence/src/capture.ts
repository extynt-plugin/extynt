// Local-only capture requests: bounded, tied to a composition and a time, and never shared with a provider.
import { MAX_FRAME_SIDE, MIN_CAPTURE_SIDE } from "./limits.js";
import { refusal, type Refusal } from "./refusal.js";
import { isFiniteNumber, isInteger, isWireList, isWireObject, type WireObject, type WireValue } from "./wire.js";

/** What the caller asks of the panel: one frame of one composition at one time, kept on this computer. */
export interface CaptureRequest {
  readonly compositionId: string;
  readonly time: number;
  readonly width: number;
  readonly height: number;
  readonly format: "png" | "jpeg";
  readonly quality?: number;
  readonly shareWithProvider: false;
}

/** What the panel reports back about a capture it wrote. */
export interface CaptureReceipt {
  readonly captureId: string;
  readonly compositionId: string;
  readonly time: number;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
  readonly localPath: string;
  readonly providerShared: false;
}

/** The host operation a valid request compiles to; the After Effects adapter writes PNG only. */
export interface CaptureCommand {
  readonly operation: "capture_frame";
  readonly captureId: string;
  readonly compositionId: string;
  readonly time: number;
  readonly width: number;
  readonly height: number;
  readonly format: "png";
  readonly quality?: number;
}

const CAPTURE_ID = /^[A-Za-z0-9._-]{1,96}$/;

function isBoundedDimension(value: WireValue): value is number {
  return isInteger(value) && value >= MIN_CAPTURE_SIDE && value <= MAX_FRAME_SIDE;
}

function isCaptureFormat(value: WireValue): value is "png" | "jpeg" {
  return value === "png" || value === "jpeg";
}

function isOptionalQuality(value: WireValue): value is number | undefined {
  return value === undefined || isFiniteNumber(value);
}

function withQuality(quality: number | undefined): { readonly quality?: number } {
  return quality === undefined ? {} : { quality };
}

function readRequest(source: WireObject): CaptureRequest | undefined {
  const { compositionId, time, width, height } = source;
  if (typeof compositionId !== "string" || !isFiniteNumber(time) || !isBoundedDimension(width) || !isBoundedDimension(height)) return undefined;
  const { format, quality, shareWithProvider } = source;
  if (!isCaptureFormat(format) || !isOptionalQuality(quality) || shareWithProvider !== false) return undefined;
  return { compositionId, time, width, height, format, shareWithProvider, ...withQuality(quality) };
}

/** Narrows a request that arrived as untyped JSON to the contract, or refuses it; no field is asserted into place. */
export function validateCaptureRequest(value: WireValue): CaptureRequest | Refusal {
  const invalid = refusal("INVALID_CAPTURE", "Capture must be bounded, local-only, and tied to a composition/time.");
  if (!isWireObject(value)) return isWireList(value) ? invalid : refusal("INVALID_CAPTURE", "Capture request must be an object.");
  return readRequest(value) ?? invalid;
}

/** Compiles a valid PNG request into the host command; JPEG and unbounded capture identities are refused. */
export function compileCaptureCommand(value: WireValue, captureId: string): CaptureCommand | Refusal {
  const request = validateCaptureRequest(value);
  if ("ok" in request) return request;
  if (request.format !== "png") return refusal("UNSUPPORTED_CAPTURE_FORMAT", "The current AE adapter writes bounded PNG evidence only.");
  if (!CAPTURE_ID.test(captureId)) return refusal("INVALID_CAPTURE_ID", "Capture identity is required and bounded.");
  const { compositionId, time, width, height } = request;
  return { operation: "capture_frame", captureId, compositionId, time, width, height, format: "png", ...withQuality(request.quality) };
}
