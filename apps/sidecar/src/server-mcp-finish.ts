// Finishing a tool call: the completions that wait on the paired panel (a capture, an approval), then the decoration, the undo handoff and the answer.
import type { ProjectSnapshot } from "@extynt/project-graph";
import { jsonOf, type StoredPlan } from "@extynt/mcp-server";

import { finishApproval } from "./server-mcp-approval.js";
import { isCapturePending } from "./server-mcp-capture-receipt.js";
import { addFields, captureIdOf } from "./server-mcp-data.js";
import { decorateResult, refreshFingerprint } from "./server-mcp-decorate.js";
import type { McpCall, McpToolsDeps } from "./server-mcp-model.js";
import { UNDO_TOOLS } from "./server-mcp-plan-delivery.js";
import type { McpResult, McpSuccess } from "./server-mcp-result.js";

/** One tool call that has run: its result, the snapshot it ran against and the approval it may carry. */
export interface McpRun {
  readonly call: McpCall;
  readonly snapshot: ProjectSnapshot | undefined;
  readonly result: McpResult;
  readonly approval: { readonly planId: string; readonly statusBefore: StoredPlan["status"] | undefined };
  readonly beforeSnapshotAt: string | undefined;
}

async function finishCapture(deps: McpToolsDeps, call: McpCall, held: { result: McpSuccess; snapshot: ProjectSnapshot }): Promise<boolean> {
  const { result, snapshot } = held;
  deps.delivery.attachCaptureCommand(result, snapshot);
  const captureId = captureIdOf(result.data);
  if (call.waitSeconds <= 0 || captureId === undefined) return false;
  const { captures } = deps.state;
  await deps.transport.waitUntil(() => !isCapturePending(captures.get(captureId)?.status), call.waitSeconds);
  const capture = captures.get(captureId);
  if (capture && !isCapturePending(capture.status)) {
    call.answer({ ok: true, tool: "ae_get_capture_frame", snapshotFingerprint: snapshot.fingerprint, data: { captureId, status: capture.status, receipt: jsonOf(capture.receipt ?? null) } });
    return true;
  }
  addFields(result, { status: capture?.status ?? "queued", waitedSeconds: call.waitSeconds, note: "Capture still pending; call ae_observe_frame with this captureId (it waits).", pipeline: deps.planView.pipeline() });
  return false;
}

function finishApprovedPlan(deps: McpToolsDeps, run: McpRun, held: { result: McpSuccess; snapshot: ProjectSnapshot }): Promise<boolean> {
  const { call, approval } = run;
  return finishApproval(deps, { result: held.result, normalized: held.snapshot, planId: approval.planId, statusBeforeApprove: approval.statusBefore, agentOriginated: call.agentOriginated, waitSeconds: call.waitSeconds, exchange: call.exchange });
}

async function answeredByCompletion(deps: McpToolsDeps, run: McpRun): Promise<boolean> {
  const { result, snapshot } = run;
  if (!result.ok || !snapshot) return false;
  switch (run.call.input.name) {
    case "ae_capture_composition_frame":
      return finishCapture(deps, run.call, { result, snapshot });
    case "ae_approve_plan":
      return finishApprovedPlan(deps, run, { result, snapshot });
    default:
      return false;
  }
}

/** Answers the call: through the completion that waits on the panel when the tool has one, otherwise with the decorated result. */
export async function finishResult(deps: McpToolsDeps, run: McpRun): Promise<void> {
  const { call, result, snapshot, beforeSnapshotAt } = run;
  if (await answeredByCompletion(deps, run)) return;
  await decorateResult(deps, call, { result, beforeSnapshotAt, beforeFingerprint: snapshot?.fingerprint });
  if (result.ok && UNDO_TOOLS.has(call.input.name)) await deps.delivery.deliverUndo(result, call.waitSeconds);
  refreshFingerprint(deps, call.input, result);
  call.answer(result);
}
