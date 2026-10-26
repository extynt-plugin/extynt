// What the receipt modules share: the dependencies the receipt intake runs on and the shape of a stored plan record.
import type { HttpCoreCapability } from "./server-http-core.js";
import type { JobUndoCapability } from "./server-job-undo.js";
import type { PlanLogCapability } from "./server-plan-log.js";
import type { PlanStateCapability } from "./server-plan-state.js";
import type { RuntimeCapability } from "./server-runtime.js";
import type { SidecarState } from "./server-state.js";

/** The sidecar state and capabilities a receipt is admitted, built and settled with. */
export type ReceiptContext = {
  readonly state: Pick<SidecarState, "collection" | "hostProfile" | "activePanelInstanceId" | "hostLink" | "latest" | "awaitingFreshSnapshotAfterPair" | "inFlight" | "nativeBridge" | "lineage" | "maxBodyBytes" | "now" | "options" | "plans" | "preApply" | "preferences" | "receipts" | "workflowCoordinator">;
  readonly planLog: Pick<PlanLogCapability, "logPlanEvent">;
  readonly planState: Pick<PlanStateCapability, "markPanelSeen" | "normalizedLatest">;
  readonly jobUndo: Pick<JobUndoCapability, "continueJobUndo">;
  readonly runtime: Pick<RuntimeCapability, "projectWorkflowApplyReceipt" | "projectWorkflowUndoReceipt" | "recordRuntimeEvidence">;
  readonly transport: Pick<HttpCoreCapability, "notifyChange" | "respond">;
};

/** A plan record as the plan store holds it. */
export type ReceiptPlanRecord = NonNullable<ReturnType<ReceiptContext["state"]["plans"]["get"]>>;
