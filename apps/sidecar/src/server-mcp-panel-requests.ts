// Work a tool call hands to the paired panel and then waits on: a snapshot refresh and a frame capture.
import { queueSnapshotRefresh } from "./read-queue.js";
import type { CaptureDeliveryCapability } from "./server-mcp-capture.js";
import { addFields, captureIdOf } from "./server-mcp-data.js";
import type { McpDeliveryDeps } from "./server-mcp-delivery-deps.js";
import type { McpSuccess } from "./server-mcp-result.js";

const IN_PANEL_CAPTURE_NEXT = "The paired panel captures this frame locally; it is never sent to the model. Call ae_observe_frame with this captureId to measure it (it waits for the capture).";

/** The panel-request members of the delivery capability. The in-panel agent's refresh and capture take the same mailbox handoff as the HTTP route, or the model is told "queued" for work nobody will do. */
export interface PanelRequestCapability {
  refreshSnapshot(result: McpSuccess, waitSeconds: number, beforeSnapshotAt: string | undefined, beforeFingerprint: string | undefined): Promise<void>;
  deliverPanelRequest(name: string, result: McpSuccess, waitSeconds: number): Promise<void>;
}

/** The panel-request members of the delivery capability, over the capture delivery it queues frames with. */
export function createPanelRequests(deps: McpDeliveryDeps, capture: Pick<CaptureDeliveryCapability, "attachCaptureCommand">): PanelRequestCapability {
  const state = deps.state;

  function noteRefreshOutcome(input: { result: McpSuccess; refreshed: boolean; waitSeconds: number; beforeSnapshotAt: string | undefined; beforeFingerprint: string | undefined }): void {
    const { result, refreshed, waitSeconds, beforeSnapshotAt, beforeFingerprint } = input;
    const fresh = deps.planState.normalizedLatest();
    const lastError = state.panel.lastError;
    if (refreshed && fresh && state.latest?.receivedAt !== beforeSnapshotAt) {
      result.snapshotFingerprint = fresh.fingerprint;
      result.data = { status: "refreshed", changed: fresh.fingerprint !== beforeFingerprint, knownRevision: `${fresh.revision}:${fresh.fingerprint}` };
    } else if (refreshed && lastError) {
      result.data = { status: "failed", error: { code: lastError.code, message: lastError.message }, pipeline: deps.planView.pipeline() };
    } else {
      addFields(result, { waitedSeconds: waitSeconds, note: "No fresh snapshot yet.", pipeline: deps.planView.pipeline() });
    }
  }

  async function refreshSnapshot(result: McpSuccess, waitSeconds: number, beforeSnapshotAt: string | undefined, beforeFingerprint: string | undefined): Promise<void> {
    const requestedAt = state.now().getTime();
    queueSnapshotRefresh(state, { reason: "explicit", read: { scope: "full" } });
    if (waitSeconds <= 0) return;
    const refreshed = await deps.transport.waitUntil(() => state.latest?.receivedAt !== beforeSnapshotAt || (state.panel.lastError?.at ?? -1) >= requestedAt, waitSeconds);
    noteRefreshOutcome({ result, refreshed, waitSeconds, beforeSnapshotAt, beforeFingerprint });
  }

  return {
    refreshSnapshot,

    async deliverPanelRequest(name: string, result: McpSuccess, waitSeconds: number): Promise<void> {
      const snapshot = deps.planState.normalizedLatest();
      if (name === "ae_refresh_snapshot") await refreshSnapshot(result, waitSeconds, state.latest?.receivedAt, snapshot?.fingerprint);
      if (name !== "ae_capture_composition_frame" || !snapshot) return;
      capture.attachCaptureCommand(result, snapshot);
      if (captureIdOf(result.data) !== undefined) addFields(result, { message: IN_PANEL_CAPTURE_NEXT });
    },
  };
}
