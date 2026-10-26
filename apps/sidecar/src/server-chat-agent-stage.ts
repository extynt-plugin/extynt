// The workflow stage selection: ae_workflow_select_stage and the preflight that routes it.
import { array, decode, object, string } from "@extynt/decode";
import { jsonOf, PLAN_UNDO_BATCH_SIZE, toolError } from "@extynt/mcp-server";
import { WORKFLOW_STAGE_TOOL } from "./agent.js";
import type { AgentToolCall } from "./server-chat-agent-call.js";
import type { AgentToolReply, ChatAgentDeps, WorkflowStageSelection } from "./server-chat-agent-types.js";
import { stageFrameCheckGate } from "./server-workflow-design.js";
import { queuedWorkflowOperations, workflowOperationReferenceIndex } from "./server-workflow-queue-boundary.js";

const MAX_SUMMARY_LENGTH = 240;
const MAX_STAGE_TYPES = 16;
const STAGE_ARGUMENTS = object({ summary: string(), operationTypes: array(string(), { minLength: 1, maxLength: MAX_STAGE_TYPES }) });

function invalidStage(): AgentToolReply {
  return toolError("INVALID_WORKFLOW_STAGE", `summary and 1–${MAX_STAGE_TYPES} unique operationTypes are required.`);
}

function uniqueTypes(types: readonly string[]): string[] | undefined {
  const trimmed = types.map((type) => type.trim());
  const unique = [...new Set(trimmed.filter(Boolean))];
  return unique.length === types.length ? unique : undefined;
}

type StageSelection = { readonly selected: WorkflowStageSelection } | { readonly refusal: AgentToolReply };

function unknownTypesRefusal(operationTypes: readonly string[]): AgentToolReply | undefined {
  const unknownTypes = operationTypes.filter((type) => !workflowOperationReferenceIndex().has(type));
  if (!unknownTypes.length) return undefined;
  return toolError("UNKNOWN_WORKFLOW_OPERATION", `These are not implemented plan operation types: ${unknownTypes.join(", ")}. Call ae_search_native_operations or ae_list_native_operations, then select the exact plan type names they return.`);
}

function stageSelection(call: AgentToolCall): StageSelection {
  const decoded = decode(STAGE_ARGUMENTS, call.args);
  const summary = decoded.ok ? decoded.value.summary.trim().slice(0, MAX_SUMMARY_LENGTH) : "";
  const operationTypes = decoded.ok ? uniqueTypes(decoded.value.operationTypes) : undefined;
  if (!summary || !operationTypes) return { refusal: invalidStage() };
  const unknownTypes = unknownTypesRefusal(operationTypes);
  return unknownTypes ? { refusal: unknownTypes } : { selected: { summary, operationTypes } };
}

interface OperationReference {
  readonly type: string;
  readonly fields: string | undefined;
}

function workflowOperationReferences(operationTypes: readonly string[]): OperationReference[] {
  const references = workflowOperationReferenceIndex();
  return operationTypes.map((type) => ({ type, fields: references.get(type) }));
}

function lockedStageRefusal(call: AgentToolCall, queued: number, operationTypes: readonly string[]): AgentToolReply | undefined {
  const omittedSelectedTypes = call.state.workflowStage?.operationTypes.filter((type) => !operationTypes.includes(type)) ?? [];
  if (queued === 0 || !omittedSelectedTypes.length) return undefined;
  return toolError("WORKFLOW_STAGE_LOCKED", `This stage already has queued operations, so re-selection must preserve its current operation types: ${omittedSelectedTypes.join(", ")}. You may add the dependency types this same bounded batch still needs.`);
}

function selectedStageReply(deps: ChatAgentDeps, call: AgentToolCall, selected: WorkflowStageSelection, queued: number): AgentToolReply {
  const { summary, operationTypes } = selected;
  return {
    ok: true,
    tool: WORKFLOW_STAGE_TOOL,
    snapshotFingerprint: deps.planState.normalizedLatest()?.fingerprint ?? null,
    data: jsonOf({
      stage: { cycle: call.input.workflowCycle ?? 0, summary, operationTypes },
      batch: { maxOperations: PLAN_UNDO_BATCH_SIZE, queued, remaining: Math.max(0, PLAN_UNDO_BATCH_SIZE - queued) },
      operationReferences: workflowOperationReferences(operationTypes),
      next: "Author only this dependency-complete stage. Call ae_describe_native_operation if a full field constraint or example is needed. Seal when this batch is whole, then continue with the next part of the request.",
    }),
  };
}

function workflowStageTool(deps: ChatAgentDeps, call: AgentToolCall): AgentToolReply {
  const selection = stageSelection(call);
  if ("refusal" in selection) return selection.refusal;
  const { selected } = selection;
  const frameCheck = stageFrameCheckGate(deps, call.input, selected.operationTypes);
  if (frameCheck) return frameCheck;
  const queued = queuedWorkflowOperations(deps);
  const locked = lockedStageRefusal(call, queued, selected.operationTypes);
  if (locked) return locked;
  call.state.workflowStage = selected;
  return selectedStageReply(deps, call, selected, queued);
}

/** Answers the stage selection tool: it needs a workflow job, a summary and the unique operation types of the stage; any other tool passes. */
export function workflowStagePreflight(deps: ChatAgentDeps, call: AgentToolCall): AgentToolReply | undefined {
  if (call.name !== WORKFLOW_STAGE_TOOL) return undefined;
  return call.input.workflowJobId ? workflowStageTool(deps, call) : toolError("WORKFLOW_STAGE_UNAVAILABLE", "Stage selection is available only inside a workflow-v1 cycle.");
}
