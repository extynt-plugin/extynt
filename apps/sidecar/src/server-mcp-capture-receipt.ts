// What a panel reports back for a frame capture, decoded once, and how the sidecar settles its capture record from it.
import { jsonOf } from "@extynt/mcp-server";
import { createHash } from "node:crypto";

import { fallback, type Infer, jsonValue, literal, number, string } from "@extynt/decode";
import { validateFrameSummary } from "@extynt/visual-evidence";

import { lenientObject } from "./server-mcp-arguments.js";
import { boundedHostError } from "./server-host-error.js";
import { summarizeSampledPixels } from "./server-sampled-pixels.js";
import type { CaptureRecord } from "./server-types.js";

const PNG_DATA_URL_PREFIX = "data:image/png;base64,";
const DATA_URL_ALLOWANCE_CHARS = 32;

/** The receipt of a capture: any field the panel got wrong reads as not given, and the capture then fails or is refused as unknown. */
export const captureReceipt = lenientObject({
  captureId: fallback(string(), undefined),
  ok: fallback(literal(true), false),
  dataUrl: fallback(string(), undefined),
  error: fallback(jsonValue, undefined),
  providerShared: fallback(literal(false), undefined),
  summary: fallback(jsonValue, undefined),
  sampledPixels: fallback(jsonValue, undefined),
  originalWidth: fallback(number(), undefined),
  originalHeight: fallback(number(), undefined),
  previewWidth: fallback(number(), undefined),
  previewHeight: fallback(number(), undefined),
  resized: fallback(literal(true), false),
  backgroundFlattened: fallback(literal(true), false),
});

/** True while a capture still waits for the panel to take or finish it. */
export function isCapturePending(status: CaptureRecord["status"] | undefined): boolean {
  return status === "queued" || status === "capturing";
}

/** A capture receipt as decoded. */
export type CaptureReceipt = Infer<typeof captureReceipt>;

interface Dimensions {
  readonly originalWidth: number;
  readonly originalHeight: number;
  readonly previewWidth: number;
  readonly previewHeight: number;
  readonly resized: boolean;
}

function dimensionsOf(receipt: CaptureReceipt, capture: CaptureRecord): Dimensions {
  const originalWidth = receipt.originalWidth ?? capture.request.width;
  const originalHeight = receipt.originalHeight ?? capture.request.height;
  return { originalWidth, originalHeight, previewWidth: receipt.previewWidth ?? originalWidth, previewHeight: receipt.previewHeight ?? originalHeight, resized: receipt.resized };
}

function hasBoundedImage(receipt: CaptureReceipt, capture: CaptureRecord): receipt is CaptureReceipt & { dataUrl: string } {
  return receipt.ok && receipt.dataUrl !== undefined && receipt.dataUrl.startsWith(PNG_DATA_URL_PREFIX) && receipt.dataUrl.length <= capture.maxEncodedBytes + DATA_URL_ALLOWANCE_CHARS && receipt.providerShared === false;
}

function matchesRequest(capture: CaptureRecord, dimensions: Dimensions): boolean {
  const { originalWidth, originalHeight, previewWidth, previewHeight, resized } = dimensions;
  const shrunk = previewWidth !== originalWidth || previewHeight !== originalHeight;
  return originalWidth === capture.request.width && originalHeight === capture.request.height && previewWidth <= originalWidth && previewHeight <= originalHeight && resized === shrunk;
}

function decisionOf(capture: CaptureRecord, dimensions: Dimensions): Record<string, string | number> {
  const budget = capture.maxEncodedBytes;
  if (!dimensions.resized) return { reason: "native-fit", budget };
  const { maxWidth, maxHeight } = capture.preview;
  const reason = dimensions.originalWidth > maxWidth || dimensions.originalHeight > maxHeight ? "preview-size" : "response-budget";
  return { reason, maxWidth, maxHeight, budget };
}

function measuredSummary(receipt: CaptureReceipt) {
  const measured = receipt.summary === undefined ? summarizeSampledPixels(receipt.sampledPixels) : validateFrameSummary(receipt.summary);
  return measured === null || "ok" in measured ? {} : { summary: jsonOf(measured) };
}

function complete(capture: CaptureRecord, image: { receipt: CaptureReceipt; dataUrl: string; dimensions: Dimensions }): void {
  const { receipt, dataUrl, dimensions } = image;
  capture.status = "completed";
  capture.receipt = {
    captureId: capture.captureId,
    status: "completed",
    compositionId: capture.request.compositionId,
    time: capture.request.time,
    dataUrl,
    ...dimensions,
    decision: decisionOf(capture, dimensions),
    providerShared: false,
    backgroundFlattened: receipt.backgroundFlattened,
    frameHash: createHash("sha256").update(dataUrl).digest("hex").slice(0, 24),
    ...measuredSummary(receipt),
  };
}

function fail(capture: CaptureRecord, receipt: CaptureReceipt): void {
  const error = boundedHostError(receipt.error) ?? { code: "CAPTURE_FAILED", message: "The local panel could not produce a bounded PNG preview." };
  capture.status = "failed";
  capture.receipt = { captureId: capture.captureId, status: "failed", error, providerShared: false };
}

/** Marks the capture completed when the receipt carries a bounded PNG that matches what was asked for, failed otherwise. */
export function settleCaptureRecord(capture: CaptureRecord, receipt: CaptureReceipt): void {
  const dimensions = dimensionsOf(receipt, capture);
  if (hasBoundedImage(receipt, capture) && matchesRequest(capture, dimensions)) complete(capture, { receipt, dataUrl: receipt.dataUrl, dimensions });
  else fail(capture, receipt);
}
