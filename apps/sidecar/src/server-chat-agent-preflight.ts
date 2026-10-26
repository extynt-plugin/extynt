// The checks that run before a workflow tool call is routed: who may call it, what a read-only cycle may call, which stage it needs and where the stage's batch ends.
import { TOOL_DEFINITIONS, toolError } from "@extynt/mcp-server";
import { isCollectionTool } from "./collection-tools.js";
import type { AgentToolCall } from "./server-chat-agent-call.js";
import { workflowStagePreflight } from "./server-chat-agent-stage.js";
import type { AgentToolReply, ChatAgentDeps, ChatAgentInput } from "./server-chat-agent-types.js";
import { checklistJob } from "./server-workflow-checklist-tools.js";
import { noteQueueLabel } from "./server-workflow-checklist.js";
import { ensureStage } from "./server-workflow-implicit-stage.js";
import { workflowQueueBoundary } from "./server-workflow-queue-boundary.js";
import { recordSeedAction } from "./server-workflow-sidecar-actions.js";
import { WORKFLOW_OWNER } from "./workflow-orchestration.js";

const WORKFLOW_QUEUE_TOOLS: ReadonlySet<string> = new Set(["ae_queue_add", "ae_queue_fix", "ae_queue_finish"]);
const OBSERVATION_ONLY_MESSAGE = "The prior stage already executed. This bounded reconciliation cycle is read-only; capture and observe current host state instead of replaying mutations.";
const ORCHESTRATOR_ONLY_MESSAGE = "Only the sidecar-assigned orchestrator/validator may select stages, submit operations, seal batches, or complete this workflow.";

function isForeignWorkflowCall(name: string, input: Pick<ChatAgentInput, "workflowJobId" | "workflowRole">): boolean {
  return !!input.workflowJobId && input.workflowRole !== WORKFLOW_OWNER && !isCollectionTool(name);
}

/** The refusal for a workflow job's tool call that comes from anyone but the sidecar-assigned owner; the collection tools are open to every role. */
export function foreignWorkflowRefusal(name: string, input: Pick<ChatAgentInput, "workflowJobId" | "workflowRole">): ReturnType<typeof toolError> | undefined {
  return isForeignWorkflowCall(name, input) ? toolError("WORKFLOW_OWNER_REQUIRED", ORCHESTRATOR_ONLY_MESSAGE) : undefined;
}

function observationToolAllowed(name: string): boolean {
  if (name === "ae_workflow_complete") return true;
  return TOOL_DEFINITIONS.some((tool) => tool.name === name && tool.annotations.readOnlyHint === true && tool.planCard !== true);
}

function workflowRoleGate({ name, input }: AgentToolCall): AgentToolReply | undefined {
  const foreign = foreignWorkflowRefusal(name, input);
  if (foreign) return foreign;
  if (input.workflowObservationOnly && !observationToolAllowed(name)) return toolError("WORKFLOW_OBSERVATION_ONLY", OBSERVATION_ONLY_MESSAGE);
  return undefined;
}

function noteSelectedStage(deps: ChatAgentDeps, { name, args, state }: AgentToolCall, jobId: string): void {
  const hadStage = !!state.workflowStage;
  ensureStage(state, name, args);
  if (!hadStage && state.workflowStage) recordSeedAction(deps.state, jobId, `opened the stage "${state.workflowStage.summary.slice(0, 80)}" for your ${name} call (you had not selected one)`);
}

function workflowQueuePreflight(deps: ChatAgentDeps, call: AgentToolCall, jobId: string): AgentToolReply | undefined {
  const { name, args, input, state } = call;
  const labelled = checklistJob(deps, input);
  if (labelled && name !== "ae_queue_finish") noteQueueLabel(deps.state, labelled, args);
  noteSelectedStage(deps, call, jobId);
  return state.workflowStage ? workflowQueueBoundary(deps, name, args, state.workflowStage) : undefined;
}

function queuePreflight(deps: ChatAgentDeps, call: AgentToolCall): AgentToolReply | undefined {
  const jobId = call.input.workflowJobId;
  return jobId && WORKFLOW_QUEUE_TOOLS.has(call.name) ? workflowQueuePreflight(deps, call, jobId) : undefined;
}

/** Answers a tool call the workflow does not allow, in this order: a caller that may not call it or a read-only cycle that may not mutate, the stage selection, then a queue call: labelled, given the stage it needs and held to the stage's boundary. */
export function workflowToolPreflight(deps: ChatAgentDeps, call: AgentToolCall): AgentToolReply | undefined {
  return workflowRoleGate(call) ?? workflowStagePreflight(deps, call) ?? queuePreflight(deps, call);
}
