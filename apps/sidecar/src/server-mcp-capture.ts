// Frame captures: queuing the capture command for the paired panel and settling the receipt the panel posts back.
import { randomUUID } from "node:crypto";

import { compileCaptureCommand } from "@extynt/host-ae";
import { jsonOf } from "@extynt/mcp-server";
import { decodeOrThrow, fallback, type Infer, jsonValue, number } from "@extynt/decode";
import type { ProjectSnapshot } from "@extynt/project-graph";

import { enqueueHostWork } from "./host/work-queue.js";
import { accepted, refused } from "./receiver-outcome.js";
import type { InProcessReceivers, ReceiverOutcome } from "./receiver-types.js";
import { lenientObject } from "./server-mcp-arguments.js";
import { captureReceipt, settleCaptureRecord, type CaptureReceipt } from "./server-mcp-capture-receipt.js";
import type { McpDeliveryDeps } from "./server-mcp-delivery-deps.js";
import type { McpSuccess } from "./server-mcp-result.js";
import type { SidecarState } from "./server-state.js";

const DEFAULT_MAX_ENCODED_BYTES = 3_000_000;
const DEFAULT_PREVIEW_WIDTH = 1280;
const DEFAULT_PREVIEW_HEIGHT = 720;
const RETAINED_CAPTURES = 16;

const captureAsked = lenientObject({
  request: fallback(jsonValue, undefined),
  preview: fallback(lenientObject({ maxWidth: fallback(number(), undefined), maxHeight: fallback(number(), undefined) }), undefined),
  maxEncodedBytes: fallback(number(), undefined),
});

type CaptureBody = Parameters<InProcessReceivers["acceptCapture"]>[0];

/** The capture members of the delivery capability: `settleCapture` completes or fails the capture a decoded receipt names, and `acceptCapture` decodes a receipt body first. */
export interface CaptureDeliveryCapability {
  attachCaptureCommand(result: McpSuccess, snapshot: ProjectSnapshot): void;
  settleCapture(receipt: CaptureReceipt): ReceiverOutcome;
  acceptCapture(body: CaptureBody): ReceiverOutcome;
}

function previewOf(asked: Infer<typeof captureAsked>): { maxWidth: number; maxHeight: number } {
  return { maxWidth: asked.preview?.maxWidth ?? DEFAULT_PREVIEW_WIDTH, maxHeight: asked.preview?.maxHeight ?? DEFAULT_PREVIEW_HEIGHT };
}

function pruneCaptures(captures: SidecarState["captures"]): void {
  for (const [id, record] of captures) {
    if (captures.size < RETAINED_CAPTURES) return;
    if (record.status === "completed" || record.status === "failed") captures.delete(id);
  }
}

function backgroundOf(snapshot: ProjectSnapshot, compositionId: string): ProjectSnapshot["compositions"][number]["backgroundColor"] {
  return snapshot.compositions.find((composition) => composition.id === compositionId)?.backgroundColor;
}

/** The capture members of the delivery capability, over the sidecar's capture records and the agent mailbox. */
export function createCaptureDelivery(deps: McpDeliveryDeps): CaptureDeliveryCapability {
  const state = deps.state;

  function settleCapture(receipt: CaptureReceipt): ReceiverOutcome {
    const capture = state.captures.get(receipt.captureId ?? "");
    if (!capture) return refused(422, "CAPTURE_NOT_FOUND", "Capture receipt was not requested by this sidecar.");
    deps.planState.markPanelSeen();
    if (state.inFlight?.kind === "capture_frame" && state.inFlight.id === capture.captureId) state.inFlight = undefined;
    settleCaptureRecord(capture, receipt);
    deps.transport.notifyChange();
    return accepted(capture.status === "completed" ? 201 : 200, { ok: true, captureId: capture.captureId, status: capture.status });
  }

  return {
    attachCaptureCommand(result: McpSuccess, snapshot: ProjectSnapshot): void {
      const asked = decodeOrThrow(captureAsked, result.data);
      const captureId = `frame-${randomUUID().replace(/-/g, "").slice(0, 24)}`;
      const command = compileCaptureCommand(asked.request, captureId);
      if (!("operation" in command)) {
        result.data = { status: "failed", error: command };
        return;
      }
      const preview = previewOf(asked);
      const maxEncodedBytes = asked.maxEncodedBytes ?? DEFAULT_MAX_ENCODED_BYTES;
      pruneCaptures(state.captures);
      state.captures.set(captureId, { captureId, status: "queued", request: command, preview, maxEncodedBytes });
      const background = backgroundOf(snapshot, command.compositionId);
      enqueueHostWork(state, { approvedData: { kind: "capture_frame", command: jsonOf(command), preview: jsonOf(preview), maxEncodedBytes, ...(background ? { background } : {}) } });
      result.data = { captureId, status: "queued", compositionId: command.compositionId, time: command.time, maxEncodedBytes, providerShared: false, message: "An open paired panel will capture this local PNG. Call ae_observe_frame with this captureId (it waits)." };
    },
    settleCapture,
    acceptCapture: (body) => settleCapture(decodeOrThrow(captureReceipt, body)),
  };
}
