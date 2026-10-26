// The frame an external client's approval carries, taken through the same capture and observe tools that client has.
import { decode, decodeOrThrow, fallback, literal, number, object, string } from "@extynt/decode";
import { callTool, jsonOf, receiptJson, type StoredPlan } from "@extynt/mcp-server";
import type { ProjectSnapshot } from "@extynt/project-graph";

import { lenientObject } from "./server-mcp-arguments.js";
import { captureIdOf, type DataFields } from "./server-mcp-data.js";
import { measureAppliedFrame } from "./server-mcp-frame.js";
import type { McpToolsDeps } from "./server-mcp-model.js";
import type { SidecarState } from "./server-state.js";
import type { RunTool } from "./server-workflow-completion-evidence.js";

const waitControl = lenientObject({ waitSeconds: fallback(number(), undefined) });
const queuedCapture = object({ kind: literal("capture_frame"), command: object({ captureId: string() }) });

function withdrawUnclaimedCaptures(state: Pick<SidecarState, "agentMailbox" | "captures">, captureIds: readonly string[]): void {
  for (const captureId of captureIds) {
    if (state.captures.get(captureId)?.status !== "queued") continue;
    state.captures.delete(captureId);
    const index = state.agentMailbox.findIndex((item) => {
      const queued = decode(queuedCapture, item.approvedData);
      return queued.ok && queued.value.command.captureId === captureId;
    });
    if (index >= 0) state.agentMailbox.splice(index, 1);
  }
}

function waitSecondsOf(args: Parameters<RunTool>[1]): number {
  return decodeOrThrow(waitControl, args).waitSeconds ?? 0;
}

function runnerFor(deps: McpToolsDeps, normalized: ProjectSnapshot, issued: string[]): RunTool {
  const context = deps.planView.toolContext(normalized, "panel");
  return async (name, args) => {
    if (name === "ae_observe_frame") return deps.chatSupport.observeFrame(args, waitSecondsOf(args));
    const captured = callTool(name, args, context);
    if (!captured.ok) return captured;
    deps.delivery.attachCaptureCommand(captured, deps.planState.normalizedLatest() ?? normalized);
    const captureId = captureIdOf(captured.data);
    if (captureId !== undefined) issued.push(captureId);
    return captured;
  };
}

/** Puts the frame the panel's own seal would take on the receipt of the approved plan, then withdraws any capture no panel claimed so it never sits ahead of the client's next apply. The stored receipt is the host's; the frame rides on a copy. */
export async function attachFrame(deps: McpToolsDeps, record: StoredPlan, target: { data: DataFields; normalized: ProjectSnapshot }): Promise<void> {
  const issued: string[] = [];
  const run = runnerFor(deps, target.normalized, issued);
  const frame = await measureAppliedFrame({ record, latest: deps.planState.normalizedLatest() ?? target.normalized, run });
  withdrawUnclaimedCaptures(deps.state, issued);
  target.data.receipt = { ...(record.receipt ? receiptJson(record.receipt) : {}), frame: jsonOf(frame) };
}
