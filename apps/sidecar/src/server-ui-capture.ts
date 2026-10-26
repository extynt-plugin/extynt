// The frame capture the panel asks for: the capture command for a composition's current view, queued for the host lane and read back once the lane has delivered.
import { randomUUID } from "node:crypto";
import { decode, map, number, object, optional, string, type Infer } from "@extynt/decode";
import { jsonOf } from "@extynt/mcp-server";
import { compileCaptureCommand, type HostCaptureCommand } from "@extynt/host-ae";
import type { ProjectSnapshot } from "@extynt/project-graph";
import { enqueueHostWork, type HostWorkQueueState } from "./host/work-queue.js";
import type { SidecarState } from "./server-state.js";

type CaptureState = Pick<SidecarState, "captures"> & HostWorkQueueState;

interface CompositionView {
  readonly width: number;
  readonly height: number;
  readonly time: number;
  readonly background: readonly [number, number, number] | undefined;
}

type CapturedFrame = Infer<typeof frameReceipt>;

const frameReceipt = map(
  object({ dataUrl: string(), previewWidth: optional(number()), previewHeight: optional(number()), time: optional(number()) }),
  ({ dataUrl, previewWidth, previewHeight, time }) => ({ dataUrl, width: previewWidth, height: previewHeight, time }),
);

const MAX_CAPTURES_KEPT = 16;
const PREVIEW_LIMIT = { maxWidth: 1568, maxHeight: 882 };
const CAPTURE_BYTES = 3_000_000;
const MAX_CAPTURE_SIDE = 4096;
const MIN_CAPTURE_SIDE = 16;

function dropFinishedCaptures(captures: CaptureState["captures"]): void {
  for (const [id, record] of captures) {
    if (captures.size < MAX_CAPTURES_KEPT) return;
    if (record.status === "completed" || record.status === "failed") captures.delete(id);
  }
}

/** The composition's size, current time and background, or null when the snapshot has no such composition. */
export function compositionView(snapshot: ProjectSnapshot | undefined, compositionId: string): CompositionView | null {
  const composition = snapshot?.compositions.find((entry) => entry.id === compositionId);
  if (!composition) return null;
  return { width: composition.width, height: composition.height, time: composition.currentTime ?? 0, background: composition.backgroundColor };
}

/** A new capture id and the command that takes the view's frame at `time`, or the refusal the command compiler gave. */
export function captureCommand(view: CompositionView, compositionId: string, time: number): HostCaptureCommand | { readonly code: string; readonly message: string } {
  const captureId = `frame-${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const side = (pixels: number) => Math.min(MAX_CAPTURE_SIDE, Math.max(MIN_CAPTURE_SIDE, pixels));
  const command = compileCaptureCommand({ compositionId, time, width: side(view.width), height: side(view.height), format: "png", shareWithProvider: false }, captureId);
  return "operation" in command ? command : { code: command.code, message: command.message };
}

/** Records the capture as queued and hands it to the host lane. */
export function queueCapture(state: CaptureState, command: HostCaptureCommand, background: CompositionView["background"]): void {
  dropFinishedCaptures(state.captures);
  state.captures.set(command.captureId, { captureId: command.captureId, status: "queued", request: command, preview: PREVIEW_LIMIT, maxEncodedBytes: CAPTURE_BYTES });
  enqueueHostWork(state, { approvedData: { kind: "capture_frame", command: jsonOf(command), preview: PREVIEW_LIMIT, maxEncodedBytes: CAPTURE_BYTES, ...(background ? { background } : {}) } });
}

/** True once the host lane has completed or failed the capture. */
export function captureFinished(state: Pick<SidecarState, "captures">, captureId: string): boolean {
  const status = state.captures.get(captureId)?.status;
  return status === "completed" || status === "failed";
}

/** The delivered frame, or null while the capture has not completed with a picture. */
export function capturedFrame(state: Pick<SidecarState, "captures">, captureId: string): CapturedFrame | null {
  const record = state.captures.get(captureId);
  if (record?.status !== "completed") return null;
  const frame = decode(frameReceipt, record.receipt);
  return frame.ok ? frame.value : null;
}
