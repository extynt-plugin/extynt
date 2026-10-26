// The ae_observe_frame tool: reads the measurement of a captured composition frame for the model, waiting briefly while the panel is still capturing.
import { decode, jsonObject, type JsonObject } from "@extynt/decode";
import { jsonFieldsOf } from "@extynt/mcp-server";

import { compareToEarlierCaptures, type CaptureComparison } from "./capture-compare.js";
import type { HttpCoreCapability } from "./server-http-core.js";
import { isCapturePending } from "./server-mcp-capture-receipt.js";
import type { PlanStateCapability } from "./server-plan-state.js";
import type { PlanViewCapability } from "./server-plan-view.js";
import type { SidecarState } from "./server-state.js";
import type { CaptureRecord } from "./server-types.js";

interface ObserveFrameDeps {
  readonly state: Pick<SidecarState, "captures">;
  readonly planState: Pick<PlanStateCapability, "normalizedLatest">;
  readonly planView: Pick<PlanViewCapability, "pipeline">;
  readonly transport: Pick<HttpCoreCapability, "waitUntil">;
}

interface ObservedFrameData extends CaptureComparison {
  readonly captureId: string;
  readonly status: CaptureRecord["status"];
  readonly summary: JsonObject | null;
  readonly pipeline?: ReturnType<PlanViewCapability["pipeline"]>;
  readonly how?: string;
  readonly next?: string;
}

/** The tool result: the observation with the snapshot it was read against, or the reason there is none. */
export type ObserveFrameResult =
  | { readonly ok: true; readonly tool: string; readonly snapshotFingerprint: string | null; readonly data: JsonObject }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } };

const MEASUREMENT_GUIDE = "contentFraction and regionContent are shares of the frame, 0-1; regionContent is row-major on a 3x3 grid, so [0..2] is the top row and [6..8] the bottom; contentBox is in frame coordinates with 0,0 at the top left; background is the colour \"empty\" was measured against. cellLuma and cellColors give each cell's mean luminance (0-255) and commonest colour in the same order; changedFrom lists the cells that changed since the previous capture of this composition and identicalTo means the pixels did not change at all. Compare two times to see movement, and read a region's share to see whether something is where it belongs.";
const NOT_MEASURED_FAILED = "The capture failed, so there is nothing to measure.";
const NOT_MEASURED_YET = "This capture was never measured. The measurement is produced by the panel when it captures, and a capture taken before that was added carries none; capture the frame again.";
const STILL_CAPTURING = "The frame has not been captured yet. Ask again, or read ae_capture_composition_frame's own status for it.";
const INVALID_CAPTURE_ID = { code: "INVALID_ARGUMENT", message: "captureId is required and must be a string of 1 to 96 characters." } as const;
const UNKNOWN_CAPTURE = { code: "CAPTURE_NOT_FOUND", message: "No bounded capture exists for that ID. Capture the frame with ae_capture_composition_frame first." } as const;

function measurementOf(capture: CaptureRecord): JsonObject | null {
  const decoded = decode(jsonObject, capture.receipt?.summary);
  return decoded.ok ? decoded.value : null;
}

function observedCapture(capture: CaptureRecord, comparison: CaptureComparison): ObservedFrameData {
  const summary = measurementOf(capture);
  const { captureId, status } = capture;
  if (summary) return { captureId, status, summary, ...comparison, how: MEASUREMENT_GUIDE };
  return { captureId, status, summary, next: status === "failed" ? NOT_MEASURED_FAILED : NOT_MEASURED_YET };
}

function observationOf(deps: ObserveFrameDeps, capture: CaptureRecord): ObservedFrameData {
  const { captureId, status } = capture;
  if (isCapturePending(status)) return { captureId, status, summary: null, pipeline: deps.planView.pipeline(), next: STILL_CAPTURING };
  return observedCapture(capture, compareToEarlierCaptures(deps.state.captures, captureId));
}

function captureIdOf(args: JsonObject): string | undefined {
  const given = args.captureId;
  return typeof given === "string" && given.length >= 1 && given.length <= 96 ? given : undefined;
}

/** Reads one capture's measurement. A pending capture is waited for up to `waitSeconds`, and the turn's `signal` ends that wait so a cancelled turn does not stay parked on the panel. */
export async function observeFrame(deps: ObserveFrameDeps, args: JsonObject, waitSeconds: number, signal?: AbortSignal): Promise<ObserveFrameResult> {
  const captureId = captureIdOf(args);
  if (captureId === undefined) return { ok: false, error: INVALID_CAPTURE_ID };
  const pending = (): boolean => isCapturePending(deps.state.captures.get(captureId)?.status);
  if (waitSeconds > 0 && pending()) await deps.transport.waitUntil(() => !pending(), waitSeconds, signal);
  const capture = deps.state.captures.get(captureId);
  if (!capture) return { ok: false, error: UNKNOWN_CAPTURE };
  const snapshotFingerprint = deps.planState.normalizedLatest()?.fingerprint ?? null;
  return { ok: true, tool: "ae_observe_frame", snapshotFingerprint, data: jsonFieldsOf(observationOf(deps, capture)) };
}
