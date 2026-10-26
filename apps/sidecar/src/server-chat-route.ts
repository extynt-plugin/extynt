// The chat capability other parts of the sidecar reach: ending a chat turn and releasing what it held.
import type { ActiveChatTurn } from "./server-chat-admission.js";
import { finishChatTurn } from "./server-chat-turn-run.js";
import type { SidecarState } from "./server-state.js";
import type { WorkflowContinuationCapability } from "./server-workflow-continuation.js";

/** What the rest of the sidecar may call on a chat turn. */
export interface ChatRouteCapability {
  finishChatTurn(requestId: string, active: ActiveChatTurn): void;
}

interface ChatRouteDeps {
  readonly state: Pick<SidecarState, "activeChatTurn" | "chatAuthoring" | "chatProgress" | "chatSteering" | "reviewHeldRequests" | "workflowRuns">;
  readonly continuation: Pick<WorkflowContinuationCapability, "deferWorkflowDrain" | "wakeDeferredWorkflowContinuations">;
}

/** The chat capability over the session state and the continuation that ending a turn wakes. */
export function createChatRoute(deps: ChatRouteDeps): ChatRouteCapability {
  return { finishChatTurn: (requestId, active) => finishChatTurn(deps.state, deps.continuation, requestId, active) };
}
