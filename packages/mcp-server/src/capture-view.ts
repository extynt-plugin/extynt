// A captured frame as an MCP image: the receipt's metadata as text and the PNG as image content.
import { objectAt, objectOf, stringAt } from "./json.js";
import type { JsonObject } from "@extynt/decode";

/** A capture result split for MCP: its metadata and, when the frame arrived, the base64 PNG. */
export interface CaptureView {
  readonly metadata: JsonObject;
  readonly base64?: string;
}

const PNG_PREFIX = "data:image/png;base64,";

function failedMetadata(data: JsonObject, code: string, message: string): CaptureView {
  return { metadata: objectOf({ captureId: data.captureId, status: "failed", error: { code, message } }) };
}

function pendingMetadata(data: JsonObject): CaptureView {
  const error = objectAt(data, "receipt")?.error;
  return { metadata: objectOf({ captureId: data.captureId, status: data.status, error: error ? error : undefined, pipeline: objectAt(data, "pipeline") }) };
}

function completedView(data: JsonObject): CaptureView {
  const receipt = objectAt(data, "receipt");
  if (!receipt) return failedMetadata(data, "CAPTURE_RECEIPT_INVALID", "Completed capture lacks a valid receipt.");
  const dataUrl = stringAt(receipt, "dataUrl") ?? "";
  if (!dataUrl.startsWith(PNG_PREFIX) || dataUrl.length === PNG_PREFIX.length) return failedMetadata(data, "CAPTURE_DATA_INVALID", "Completed capture lacks PNG image data.");
  const { dataUrl: _dataUrl, providerShared: _providerShared, ...rest } = receipt;
  return { base64: dataUrl.slice(PNG_PREFIX.length), metadata: objectOf({ captureId: data.captureId, status: "completed", receipt: { ...rest, automaticUpload: false, modelVisibleOnRetrieval: true } }) };
}

/** The capture view of a `ae_get_capture_frame` result, or `undefined` for any other tool's result. */
export function captureView(result: JsonObject): CaptureView | undefined {
  const data = objectAt(result, "data");
  if (result.tool !== "ae_get_capture_frame" || !data) return undefined;
  return data.status === "completed" ? completedView(data) : pendingMetadata(data);
}
