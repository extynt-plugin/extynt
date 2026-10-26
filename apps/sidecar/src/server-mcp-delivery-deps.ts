// The sidecar state and capabilities the delivery of tool work to the paired panel reads: plans, the agent mailbox and captures.
import type { ApplyAdmissionCapability } from "./server-apply-admission.js";
import type { HttpCoreCapability } from "./server-http-core.js";
import type { PlanLogCapability } from "./server-plan-log.js";
import type { PlanStateCapability } from "./server-plan-state.js";
import type { PlanViewCapability } from "./server-plan-view.js";
import type { SidecarState } from "./server-state.js";

/** What every part of the delivery reads. */
export interface McpDeliveryDeps {
  readonly state: Pick<SidecarState, "agentMailbox" | "captures" | "inFlight" | "issuedReads" | "latest" | "liveStamp" | "now" | "panel" | "pendingJobUndo" | "plans" | "readSequence" | "readyPlans" | "workflowCoordinator">;
  readonly applyAdmission: Pick<ApplyAdmissionCapability, "executableFor">;
  readonly planLog: Pick<PlanLogCapability, "logPlanEvent">;
  readonly planState: Pick<PlanStateCapability, "markPanelSeen" | "normalizedLatest">;
  readonly planView: Pick<PlanViewCapability, "pipeline">;
  readonly transport: Pick<HttpCoreCapability, "notifyChange" | "waitUntil">;
}
