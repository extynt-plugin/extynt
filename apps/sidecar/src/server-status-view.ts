// The `ae_status` tool result: versions, the pipeline, the project snapshot, the model and the newest work.
import { getActiveComposition, type ProjectSnapshot } from "@extynt/project-graph";
import { MCP_SERVER_VERSION, statusResult, type callTool, type ToolContext } from "@extynt/mcp-server";

import { SIDECAR_VERSION } from "./server-contracts.js";
import { interruptedApplyLine } from "./agent-briefing.js";
import { hostIdentityView, hostLibraryView, nativePipeline } from "./server-pipeline-view.js";
import { latestWork } from "./server-work-outcome.js";
import type { JsonObject } from "@extynt/decode";
import type { PlanStateCapability } from "./server-plan-state.js";
import type { SidecarState } from "./server-state.js";

/** Who asked for the status: an agent's MCP process names its own version in X-AE-Client-Version; the panel's chat has no MCP process. */
export type StatusCaller = { agentOriginated: boolean; clientVersion: string | null };

type StatusViewDeps = {
  readonly state: Pick<SidecarState, "agentMailbox" | "awaitingFreshSnapshotAfterPair" | "chatProvider" | "fallbackChatProvider" | "hostFacts" | "hostLink" | "inFlight" | "latest" | "latestInterruptedApply" | "now" | "panel" | "plans" | "readyPlanQueueLimit" | "readyPlans">;
  readonly planState: Pick<PlanStateCapability, "hostLabel" | "normalizedLatest">;
};

const SKEW_REMEDY = "Restart Claude Desktop / your MCP client to load the new extynt MCP server.";
const MILLISECONDS = 1000;

function mcpVersionFacts(caller: StatusCaller | undefined): JsonObject {
  const running = caller?.agentOriginated ? caller.clientVersion : MCP_SERVER_VERSION;
  const skew = caller?.agentOriginated === true && caller.clientVersion !== MCP_SERVER_VERSION;
  const process = caller?.clientVersion ? `The MCP server process is ${caller.clientVersion}` : "The MCP server process predates version reporting";
  const remedy = `${process}, but this sidecar (${SIDECAR_VERSION}) expects ${MCP_SERVER_VERSION}. ${SKEW_REMEDY}`;
  return { mcpServerVersion: running, sidecarMcpVersion: MCP_SERVER_VERSION, versionSkew: skew, ...(skew ? { versionSkewRemedy: remedy } : {}) };
}

function statusModel(state: StatusViewDeps["state"]): JsonObject | null {
  const provider = state.chatProvider;
  if (!provider) return null;
  return { name: provider.displayMetadata.displayName, model: provider.model, fallback: state.fallbackChatProvider?.displayMetadata.displayName ?? null };
}

function statusSnapshot(state: StatusViewDeps["state"], normalized: ProjectSnapshot | undefined): JsonObject | null {
  if (!normalized) return null;
  const active = getActiveComposition(normalized);
  const receivedSecondsAgo = state.latest ? Math.round((state.now().getTime() - Date.parse(state.latest.receivedAt)) / MILLISECONDS) : null;
  return { projectName: normalized.project.name, activeComposition: active ? { id: active.id, name: active.name, layers: active.layers.length } : null, selectedLayers: normalized.selection.layerIds.length, capturedAt: normalized.capturedAt, receivedSecondsAgo };
}

function statusFacts(deps: StatusViewDeps, caller: StatusCaller | undefined, normalized: ProjectSnapshot | undefined): JsonObject {
  const { state } = deps;
  return {
    version: SIDECAR_VERSION, ...mcpVersionFacts(caller), workflowEngine: "workflow-v1", host: deps.planState.hostLabel() ?? null, hostIdentity: hostIdentityView(state.hostLink.status().host),
    pipeline: nativePipeline(state), awaitingFreshSnapshot: state.awaitingFreshSnapshotAfterPair,
    snapshot: statusSnapshot(state, normalized),
    model: statusModel(state),
    latestWork: latestWork(state),
    ...(state.latestInterruptedApply ? { interruptedApply: interruptedApplyLine(state.latestInterruptedApply) } : {}),
    hostLibrary: hostLibraryView(state),
  };
}

/** The `ae_status` result for the caller: the shared status, with the facts only the sidecar holds. */
export function statusToolResult(deps: StatusViewDeps, caller: StatusCaller | undefined, context: (normalized: ProjectSnapshot | undefined) => ToolContext): ReturnType<typeof callTool> {
  const normalized = deps.planState.normalizedLatest();
  return statusResult(normalized, { ...context(normalized), statusFacts: statusFacts(deps, caller, normalized) });
}
