// The runtime capability: evidence recording, plan settlement and in-flight handling composed over one set of dependencies.
import { createRuntimeEvidence, type RuntimeEvidenceCapability } from "./server-runtime-evidence.js";
import { createPlanFlight, type PlanFlightCapability } from "./server-plan-flight.js";
import { createPlanSettlement, type PlanSettlementCapability } from "./server-plan-settlement.js";
import type { HttpCoreCapability } from "./server-http-core.js";
import type { PlanLogCapability } from "./server-plan-log.js";
import type { PlanStateCapability } from "./server-plan-state.js";
import type { PlanViewCapability } from "./server-plan-view.js";
import type { SidecarState } from "./server-state.js";
import type { WorkflowContinuationCapability } from "./server-workflow-continuation.js";

/** Everything the runtime offers: evidence recording, plan settlement and in-flight handling. */
export interface RuntimeCapability extends RuntimeEvidenceCapability, PlanSettlementCapability, PlanFlightCapability {}

type RuntimeDeps = {
  readonly state: Pick<SidecarState, "agentMailbox" | "approvalRecords" | "captures" | "inFlight" | "latestInterruptedApply" | "lineage" | "now" | "options" | "plans" | "preApply" | "receipts" | "runtimeEvidence" | "workflowCoordinator">;
  readonly planState: Pick<PlanStateCapability, "approvalClockStart" | "hostKey" | "hostLabel" | "normalizedLatest">;
  readonly planView: Pick<PlanViewCapability, "sealingTurn">;
  readonly planLog: Pick<PlanLogCapability, "logPlanEvent">;
  readonly transport: Pick<HttpCoreCapability, "notifyChange">;
  readonly continuation: Pick<WorkflowContinuationCapability, "onWorkflowSettlement">;
};

/** Builds the runtime capability over the sidecar state. */
export function createRuntime(deps: RuntimeDeps): RuntimeCapability {
  const settlement = createPlanSettlement(deps);
  return {
    ...settlement,
    ...createPlanFlight({ ...deps, settlement }),
    ...createRuntimeEvidence(deps),
  };
}
