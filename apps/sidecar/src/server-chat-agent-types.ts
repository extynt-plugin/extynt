// The chat agent's contract: what it is built from, what one turn is given, the state a turn's tool calls share and what it provides.
import { type JsonObject } from "@extynt/decode";
import type { ChatProvider, ProviderImage } from "@extynt/llm";
import type { callTool } from "@extynt/mcp-server";
import type { WorkflowContinuationInput } from "@extynt/workflow";
import type { AgentRunResult } from "./agent.js";
import type { AgentRunInput } from "./agent-types.js";
import type { ToolArgs } from "./server-chat-agent-call.js";
import type { ApplyRuntimeCapability } from "./server-apply-runtime.js";
import type { ChatSupportCapability } from "./server-chat-support.js";
import type { FocusCapability } from "./server-focus.js";
import type { HttpCoreCapability } from "./server-http-core.js";
import type { McpDeliveryCapability } from "./server-mcp-delivery.js";
import type { PlanLogCapability } from "./server-plan-log.js";
import type { PlanStateCapability } from "./server-plan-state.js";
import type { PlanViewCapability } from "./server-plan-view.js";
import type { SidecarState } from "./server-state.js";
import type { WorkflowAdmissionCapability } from "./server-workflow-admission.js";
import type { WorkflowOrchestrationBundle, WORKFLOW_OWNER } from "./workflow-orchestration.js";

/** The MCP envelope every agent tool answers in. */
export type AgentToolReply = ReturnType<typeof callTool>;

/** The envelope of a tool call that succeeded. */
export type AgentToolSuccess = Extract<AgentToolReply, { ok: true }>;

/** Everything the chat agent reads and calls, as narrow views of the sidecar's state and capabilities. */
export type ChatAgentDeps = {
  readonly state: Pick<SidecarState, "hostProfile" | "preferences" | "aliases" | "chatProjectLinks" | "hostLink" | "collection" | "decisions" | "designApprovals" | "hostFacts" | "activePanelInstanceId" | "agentMailbox" | "panel" | "inFlight" | "captures" | "chatAuthoring" | "chatProgress" | "chatSteering" | "fallbackChatProvider" | "latestInterruptedApply" | "modelKeyVariables" | "now" | "openQueuePlanId" | "options" | "persistWorkflowHandoffs" | "plans" | "specialistUsage" | "reviewHeldRequests" | "workflowCoordinator" | "workflowHeldAnimation" | "workflowHeldReleasedInto" | "workflowHeldReleasing" | "workflowOrchestrations" | "workflowSidecarActions" | "workflowSpecialistSessions">;
  readonly applyRuntime: Pick<ApplyRuntimeCapability, "settleInFlightBatch" | "settleWaitSeconds">;
  readonly chatSupport: Pick<ChatSupportCapability, "observeFrame" | "recordAuthoringProgress" | "runningTurnState" | "searchTheWeb" | "statusMemoryFor" | "webSearchBackend">;
  readonly delivery: Pick<McpDeliveryCapability, "attachSealedCard" | "deliverPanelRequest" | "deliverUndo">;
  readonly focus: Pick<FocusCapability, "beforeTool" | "beforeTurn">;
  readonly planLog: Pick<PlanLogCapability, "logStepUsage">;
  readonly planState: Pick<PlanStateCapability, "currentRuntimeEvidence" | "demoteScoped" | "lineageChain" | "normalizedLatest" | "normalizedWhole" | "pairedWorkflowRepairSnapshot" | "pairedWorkflowSnapshot">;
  readonly planView: Pick<PlanViewCapability, "pipeline" | "sealingPlanId" | "statusToolResult" | "toolContext">;
  readonly transport: Pick<HttpCoreCapability, "notifyChange" | "waitUntil">;
  readonly workflowAdmission: Pick<WorkflowAdmissionCapability, "awaitSealedApply" | "queueReadyPlan">;
};

/**
 * One chat turn as the agent receives it. `discoveryOnly` is a trusted, route-assigned read-only bootstrap, never taken from request JSON.
 * `images` are the reference images the user attached to the brief; a job reads its own from the ledger so a continuation still has them.
 * `workflowObservationOnly` means executed host work needs evidence, not another mutation attempt. `workflowRole` is runtime authority assigned by workflow-v1,
 * not accepted from an HTTP request. `workflowOwnerProvider`, `workflowChecklist`, `workflowPlanned`, `extendLanding` and `log` are internal only:
 * the owner model is the default provider for a specialist role without an override; the free-run owner turn offers ae_workflow_checklist and its contract asks for it;
 * the planner wrote the checklist so the model does not restate it; `extendLanding` gives the owner back time it spent blocked on a specialist, within the panel's ceiling;
 * `log` is the agent log, so work the sidecar does for the owner (a specialist's turn) lands beside its tool calls.
 */
export type ChatAgentInput = {
  discoveryOnly?: boolean;
  requestId: string;
  sessionId?: string;
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  autoApply: boolean;
  signal?: AbortSignal;
  landingAt?: number;
  image?: { mediaType: string; base64: string };
  images?: ProviderImage[];
  stopAfterSeal?: boolean;
  workflowJobId?: string;
  workflowGoalSummary?: string;
  workflowContinuation?: WorkflowContinuationInput | null;
  workflowCycle?: number;
  workflowObservationOnly?: boolean;
  workflowRole?: typeof WORKFLOW_OWNER;
  workflowOrchestration?: WorkflowOrchestrationBundle;
  workflowOwnerProvider?: ChatProvider;
  workflowChecklist?: boolean;
  workflowPlanned?: boolean;
  extendLanding?: (milliseconds: number) => void;
  log?: AgentRunInput["log"];
};

/** The stage the owner selected for the batch it is building: what it is and the operation types it may queue. */
export type WorkflowStageSelection = { summary: string; operationTypes: string[] };

/** The state one turn's tool calls share. `designer` marks the visual-scene designer's own calls: they build the design, so the design-first gates do not apply to them, and they run while its turn is still pending. */
export type AgentCallState = {
  workflowCompletion?: AgentRunResult["workflowCompletion"];
  workflowStage?: WorkflowStageSelection | undefined;
  createdLayers?: Set<string> | undefined;
  designAutoBuilds?: number;
  unbuiltNote?: string | undefined;
  designer?: boolean;
};

/** What the chat agent provides: it runs a turn, runs one tool as the turn would, and does the sidecar's own work at a free-run cycle boundary (planner, due reviews), returning feedback for the cycle about to start, if any. */
export interface ChatAgentCapability {
  runAgentTool(name: string, args: ToolArgs, input: ChatAgentInput, state: AgentCallState): Promise<AgentToolReply>;
  runChatAgent(provider: ChatProvider, input: ChatAgentInput): Promise<AgentRunResult | undefined>;
  runNativeAgentTool(name: string, args: JsonObject, input: ChatAgentInput): Promise<AgentToolReply>;
  prepareCycle(provider: ChatProvider, input: ChatAgentInput, goal: string): Promise<string | undefined>;
  workflowCompletionTool(name: string, args: JsonObject, input: Pick<ChatAgentInput, "workflowJobId" | "workflowRole">, state: AgentCallState): AgentToolReply;
}
