// The plan queue as callers see it: the tool context a call runs in, queue positions and which turn sealed a plan.
import type { ProjectSnapshot } from "@extynt/project-graph";
import { workOutcomeView, type StoredPlan, type callTool, type StoredReceipt } from "@extynt/mcp-server";

import { hostFailureLines, interruptedApplyLine } from "./agent-briefing.js";
import { recentBuildSummary } from "./context-carry.js";
import { foreignJobs } from "./chat-session-fence.js";
import { effectUsageCounts } from "./effect-notes-briefing.js";
import { callerCreatedIds, jobCreatedIds } from "./host/job-created-ids.js";
import { queueFeaturesProbe } from "./host/run-census.js";
import { liveHostOf, nativePipeline } from "./server-pipeline-view.js";
import type { JsonObject } from "@extynt/decode";
import type { PlanStateCapability } from "./server-plan-state.js";
import type { SidecarState } from "./server-state.js";
import { interfaceLanguageOf, translatorOf } from "./ui-language.js";
import { statusToolResult, type StatusCaller } from "./server-status-view.js";
import { latestWork } from "./server-work-outcome.js";

/** The view of the plan queue that the MCP tools, the workflow and the health route read. */
export interface PlanViewCapability {
  latestWork(): JsonObject | null;
  pipeline(): JsonObject;
  planQueuePosition(planId: string): number | undefined;
  sealingPlanId(requestId: string): string | null;
  sealingTurn(planId: string): string | null;
  statusToolResult(caller?: StatusCaller): ReturnType<typeof callTool>;
  toolContext(normalized: ProjectSnapshot | undefined, caller?: "panel" | "external"): Parameters<typeof callTool>[2];
  workOutcome(record: StoredPlan): JsonObject;
}

type PlanViewDeps = {
  readonly state: Pick<SidecarState, "agentMailbox" | "awaitingFreshSnapshotAfterPair" | "chatAuthoring" | "collection" | "chatProvider" | "fallbackChatProvider" | "hostFacts" | "fontSubstitutions" | "hostLink" | "hostProfile" | "inFlight" | "inventory" | "externalQueuePlanId" | "latest" | "latestInterruptedApply" | "now" | "openQueuePlanId" | "options" | "panel" | "planLedger" | "plans" | "variants" | "previousInventory" | "readyPlanQueueLimit" | "readyPlans" | "receipts" | "settledBatchIds" | "workflowCoordinator">;
  readonly planState: Pick<PlanStateCapability, "currentRuntimeEvidence" | "hostKey" | "hostLabel" | "normalizedLatest" | "settledCreatedIds">;
  readonly panelSessionId: () => string;
};

type CarriedContext = { interruptedApply?: string; hostFailures?: string[]; recentBuild?: string };

function carriedContextFacts(state: PlanViewDeps["state"], evidence: Parameters<typeof hostFailureLines>[0], snapshot: ProjectSnapshot | undefined): CarriedContext {
  const failures = hostFailureLines(evidence);
  const build = recentBuildSummary({ state: state.workflowCoordinator.workflowStore.getState(), snapshot, hiddenJobs: foreignJobs(state.workflowCoordinator.workflowStore) });
  return { ...(state.latestInterruptedApply ? { interruptedApply: interruptedApplyLine(state.latestInterruptedApply) } : {}), ...(failures.length ? { hostFailures: failures } : {}), ...(build ? { recentBuild: build } : {}) };
}

function queueSlot(state: PlanViewDeps["state"], caller: "panel" | "external"): { planId: string | null; set: (planId: string | null) => void } {
  return caller === "external"
    ? { planId: state.externalQueuePlanId, set: (planId) => { state.externalQueuePlanId = planId; } }
    : { planId: state.openQueuePlanId, set: (planId) => { state.openQueuePlanId = planId; } };
}

function receiptsByPlan(state: PlanViewDeps["state"]): Map<string, StoredReceipt> {
  const byPlan = new Map<string, StoredReceipt>();
  for (const receipt of state.receipts) if (typeof receipt.planId === "string") byPlan.set(receipt.planId, receipt);
  return byPlan;
}

function shownLanguage(state: PlanViewDeps["state"], caller: "panel" | "external"): Pick<NonNullable<Parameters<typeof callTool>[2]>, "translate"> {
  return caller === "panel" && interfaceLanguageOf(state) !== "en" ? { translate: translatorOf(state) } : {};
}

function toolContext(deps: PlanViewDeps, normalized: ProjectSnapshot | undefined, caller: "panel" | "external"): Parameters<typeof callTool>[2] {
  const { state, planState } = deps;
  state.settledBatchIds = planState.settledCreatedIds();
  if (state.hostLink.status().host) queueFeaturesProbe(state);
  const evidence = planState.currentRuntimeEvidence();
  return {
    ...(normalized === undefined ? {} : { snapshot: normalized }), ...(state.inventory === undefined ? {} : { inventory: state.inventory }), ...(state.previousInventory === undefined ? {} : { previousInventory: state.previousInventory }), ...(state.hostProfile === undefined ? {} : { hostProfile: state.hostProfile }),
    effectUsage: () => effectUsageCounts(state.collection.effectNotes), noteFontSubstitution: (substitution) => { state.fontSubstitutions.push(substitution); }, panelSessionId: deps.panelSessionId(), plans: state.plans, lostPlans: state.planLedger, variants: state.variants,
    receipts: receiptsByPlan(state), runtimeEvidence: evidence, hostKey: planState.hostKey() ?? null, liveHost: liveHostOf(state.hostLink.status().host),
    layerStyles: state.hostFacts.layerStyles.state, svgForceConverter: state.options.svgForceConverter === true, settledBatchIds: state.settledBatchIds,
    jobCreatedIds: (jobId) => callerCreatedIds({ own: jobCreatedIds(state, jobId), caller, held: { plans: state.plans, batchForPlan: (planId) => state.workflowCoordinator.batchForPlan(planId) }, sources: state.hostFacts.planSources, jobId }),
    queue: queueSlot(state, caller), now: state.now, ...shownLanguage(state, caller), ...(caller === "external" ? carriedContextFacts(state, evidence, normalized) : {}),
  };
}

/** Builds the plan view over the sidecar state and the plan state. */
export function createPlanView(deps: PlanViewDeps): PlanViewCapability {
  const { state } = deps;
  return {
    pipeline: () => nativePipeline(state),
    statusToolResult: (caller) => statusToolResult(deps, caller, (normalized) => toolContext(deps, normalized, "panel")),
    latestWork: () => latestWork(state),
    workOutcome: workOutcomeView,
    planQueuePosition(planId) {
      const index = state.agentMailbox.findIndex((item) => item.planId === planId);
      return index >= 0 ? index + 1 : undefined;
    },
    sealingTurn: (planId) => state.readyPlans.find((entry) => entry.planId === planId)?.requestId ?? null,
    sealingPlanId: (requestId) => state.openQueuePlanId ?? (state.chatAuthoring?.requestId === requestId ? state.chatAuthoring.progress.planId : null),
    toolContext: (normalized, caller = "panel") => toolContext(deps, normalized, caller),
  };
}
