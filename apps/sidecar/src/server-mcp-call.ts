// One MCP tool call from admission to answer: wait for the plan, settle focus, run the tool and finish it.
import type { StoredPlan } from "@extynt/mcp-server";
import type { ProjectSnapshot } from "@extynt/project-graph";

import { admitCall } from "./server-mcp-admission.js";
import { executeTool } from "./server-mcp-execute.js";
import { finishResult, type McpRun } from "./server-mcp-finish.js";
import type { McpInput } from "./server-mcp-arguments.js";
import type { McpCall, McpExchange, McpToolsDeps } from "./server-mcp-model.js";
import { applyProposal } from "./server-mcp-proposal.js";
import type { McpResult } from "./server-mcp-result.js";
import { answerParameterTool, answerSpecialTool } from "./server-mcp-special.js";
import { IN_FLIGHT_PLAN_STATUSES } from "./server-limits.js";

type Approval = McpRun["approval"];

async function waitForPlanStatus(deps: McpToolsDeps, call: McpCall): Promise<void> {
  if (call.input.name !== "ae_get_plan_status" || call.waitSeconds <= 0) return;
  const { plans } = deps.state;
  const planId = call.input.controls.planId;
  const record = plans.get(planId);
  if (!record || !(call.waitRequested || IN_FLIGHT_PLAN_STATUSES.has(record.status))) return;
  const { updatedAt, status } = record;
  await deps.transport.waitUntil(() => {
    const current = plans.get(planId);
    return !current || current.updatedAt !== updatedAt || current.status !== status;
  }, call.waitSeconds);
}

function approvalOf(deps: McpToolsDeps, input: McpInput): Approval {
  if (input.name !== "ae_approve_plan") return { planId: "", statusBefore: undefined };
  const { planId } = input.controls;
  const status: StoredPlan["status"] | undefined = planId ? deps.state.plans.get(planId)?.status : undefined;
  return { planId, statusBefore: status };
}

function addFocusNote(result: McpResult, note: string | undefined): void {
  if (note && result.ok) result.focusNote = note;
}

async function answeredBeforeRunning(deps: McpToolsDeps, call: McpCall, snapshot: ProjectSnapshot | undefined): Promise<boolean> {
  return (await answerSpecialTool(deps, call, snapshot?.fingerprint ?? null)) || (await answerParameterTool(deps, call, snapshot));
}

async function runTool(deps: McpToolsDeps, call: McpCall, held: { snapshot: ProjectSnapshot | undefined; focusNote: string | undefined }): Promise<void> {
  const { snapshot, focusNote } = held;
  const approval = approvalOf(deps, call.input);
  const result = executeTool(deps, call.input, { snapshot, agentOriginated: call.agentOriginated });
  addFocusNote(result, focusNote);
  const run: McpRun = { call, snapshot, result, approval, beforeSnapshotAt: deps.state.latest?.receivedAt };
  if (await applyProposal(deps, run)) return;
  await finishResult(deps, run);
}

/** Answers one tool call on its exchange. An agent plans and approves against what After Effects shows now: a differing read is re-requested first, bounded, and a timeout is only noted on the result. */
export async function callMcpTool(deps: McpToolsDeps, input: McpInput, exchange: McpExchange): Promise<void> {
  const call = admitCall(deps, input, exchange);
  if (!call) return;
  await waitForPlanStatus(deps, call);
  const focusNote = await deps.focus.beforeTool(input.name, call.agentOriginated, input.arguments);
  const snapshot = deps.planState.normalizedLatest();
  if (await answeredBeforeRunning(deps, call, snapshot)) return;
  await runTool(deps, call, { snapshot, focusNote });
}
