// The shapes one MCP tool call moves through: the exchange that answers it, the admitted call and the capabilities every step works with.
import type { McpInput } from "./server-mcp-arguments.js";
import type { ApplyAdmissionCapability } from "./server-apply-admission.js";
import type { ChatSupportCapability } from "./server-chat-support.js";
import type { FocusCapability } from "./server-focus.js";
import type { HttpCoreCapability } from "./server-http-core.js";
import type { McpDeliveryCapability } from "./server-mcp-delivery.js";
import type { PlanLogCapability } from "./server-plan-log.js";
import type { PlanStateCapability } from "./server-plan-state.js";
import type { PlanViewCapability } from "./server-plan-view.js";
import type { McpResponder } from "./server-mcp-result.js";
import type { RespondInput } from "./sidecar-context.js";
import type { Refusal } from "./server-route-body.js";
import type { Exchange } from "./server-route-table.js";
import type { RuntimeCapability } from "./server-runtime.js";
import type { SidecarState } from "./server-state.js";
import { errorEnvelope } from "./server-http-wire.js";
import type { WorkflowContinuationCapability } from "./server-workflow-continuation.js";
import type { WorkflowCyclesCapability } from "./server-workflow-cycles.js";

/** The request and response one tool call arrives on, with their diagnostic context. */
export type McpExchange = Pick<Exchange, "request" | "response" | "context">;

/** One admitted tool call: its input, where it is answered, who made it and how long it may wait. */
export interface McpCall {
  readonly input: McpInput;
  readonly exchange: McpExchange;
  readonly agentOriginated: boolean;
  readonly waitSeconds: number;
  readonly waitRequested: boolean;
  readonly answer: McpResponder;
}

/** The sidecar state and the capabilities a tool call works with. */
export interface McpToolsDeps {
  readonly state: SidecarState;
  readonly applyAdmission: Pick<ApplyAdmissionCapability, "executableFor" | "panelSessionId">;
  readonly chatSupport: Pick<ChatSupportCapability, "observeFrame">;
  readonly continuation: Pick<WorkflowContinuationCapability, "onWorkflowSettlement">;
  readonly cycles: Pick<WorkflowCyclesCapability, "cancelWorkflowJob">;
  readonly delivery: Pick<McpDeliveryCapability, "attachCaptureCommand" | "attachMailboxCommand" | "deliverUndo" | "refreshSnapshot">;
  readonly focus: Pick<FocusCapability, "beforeTool">;
  readonly planLog: Pick<PlanLogCapability, "logPlanEvent">;
  readonly planState: Pick<PlanStateCapability, "currentRuntimeEvidence" | "markPanelSeen" | "normalizedLatest" | "normalizedWhole" | "demoteScoped">;
  readonly planView: Pick<PlanViewCapability, "pipeline" | "planQueuePosition" | "sealingTurn" | "statusToolResult" | "toolContext">;
  readonly runtime: Pick<RuntimeCapability, "prunePlans">;
  readonly transport: Pick<HttpCoreCapability, "notifyChange" | "respond" | "waitUntil">;
}

type McpAnswer = Omit<RespondInput, "response" | "context">;

/** Answers the exchange. */
export function answerCall(transport: Pick<HttpCoreCapability, "respond">, exchange: McpExchange, answer: McpAnswer): void {
  transport.respond({ ...answer, response: exchange.response, context: exchange.context });
}

/** Answers the exchange with the standard error envelope and the refusal's status and code. */
export function refuseCall(transport: Pick<HttpCoreCapability, "respond">, exchange: McpExchange, refusal: Refusal): void {
  answerCall(transport, exchange, { statusCode: refusal.status, value: errorEnvelope(refusal.code, refusal.message), outcome: "rejected", errorCode: refusal.code });
}
