// What the chat agent and the tool bridge borrow from the chat: the web search, the frame observation, the authoring line, the turn-state text and the model providers.
import { type JsonObject } from "@extynt/decode";
import type { ToolResult } from "./agent.js";
import type { HttpCoreCapability } from "./server-http-core.js";
import { recordAuthoringProgress, runningTurnState, statusMemoryFor } from "./server-authoring-progress.js";
import { observeFrame, type ObserveFrameResult } from "./server-observe-frame.js";
import { reloadModelProviders } from "./server-model-settings.js";
import type { PlanStateCapability } from "./server-plan-state.js";
import type { PlanViewCapability } from "./server-plan-view.js";
import type { SidecarState } from "./server-state.js";
import { searchTheWeb, webSearchBackend } from "./server-web-search-tool.js";
import type { SearchBackend } from "./web-search.js";

export interface ChatSupportCapability {
  observeFrame(args: JsonObject, waitSeconds: number, signal?: AbortSignal): Promise<ObserveFrameResult>;
  recordAuthoringProgress(requestId: string, tool: string, data: JsonObject | undefined, queuePlanId?: string | null): void;
  reloadModelProviders(): void;
  runningTurnState(requestId: string): string;
  searchTheWeb(args: JsonObject, signal?: AbortSignal): Promise<ToolResult>;
  statusMemoryFor(requestId: string): { value: string | null };
  webSearchBackend(): SearchBackend | undefined;
}

type ChatSupportDeps = {
  readonly state: Pick<SidecarState, "captures" | "chatAuthoring" | "chatProgress" | "chatProvider" | "fallbackChatProvider" | "hostFacts" | "modelKeyVariables" | "modelSettingsErrors" | "now" | "openQueuePlanId" | "options" | "plans" | "statusMemory">;
  readonly planState: Pick<PlanStateCapability, "normalizedLatest">;
  readonly planView: Pick<PlanViewCapability, "pipeline">;
  readonly transport: Pick<HttpCoreCapability, "waitUntil">;
};

/** The chat's shared tools and state, bound to the sidecar's state. */
export function createChatSupport(deps: ChatSupportDeps): ChatSupportCapability {
  const { state } = deps;
  return {
    observeFrame: (args, waitSeconds, signal) => observeFrame(deps, args, waitSeconds, signal),
    recordAuthoringProgress: (requestId, tool, data, queuePlanId) => recordAuthoringProgress(state, { requestId, tool, data, queuePlanId }),
    reloadModelProviders: () => reloadModelProviders(state),
    runningTurnState: (requestId) => runningTurnState(state, requestId),
    searchTheWeb: (args, signal) => searchTheWeb(state, args, signal),
    statusMemoryFor: (requestId) => statusMemoryFor(state, requestId),
    webSearchBackend: () => webSearchBackend(state),
  };
}
