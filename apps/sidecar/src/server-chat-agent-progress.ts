// Records the agent loop's step progress, and each tool reply's authoring progress, where the panel polls for them.
import type { AgentProgress } from "./agent.js";
import { announcePlanTool } from "./plans-events.js";
import { replyPayload } from "./server-chat-agent-reply.js";
import type { AgentToolReply, ChatAgentDeps, ChatAgentInput } from "./server-chat-agent-types.js";
import type { ChatAuthoringProgress, ChatProgress } from "./server-types.js";

const MAX_PROGRESS_NOTES = 12;
const PLAN_AUTHORING_TOOLS: ReadonlySet<string> = new Set(["ae_propose_plan", "ae_create_vector_artwork"]);

function noteTrail(previous: ChatProgress | undefined, progress: AgentProgress): string[] {
  const notes = [...(previous?.notes ?? []), ...(progress.phase === "note" ? [progress.label] : [])];
  return notes.slice(-MAX_PROGRESS_NOTES);
}

function carriedDetails(previous: ChatProgress | undefined, authoring: ChatAuthoringProgress | undefined, progress: AgentProgress): Partial<ChatProgress> {
  return {
    ...(authoring ? { authoring } : {}),
    ...(previous?.orchestration ? { orchestration: previous.orchestration } : {}),
    ...(progress.usage ? { usage: { ...progress.usage } } : {}),
    ...(typeof progress.reasoning === "string" ? { reasoning: progress.reasoning } : {}),
  };
}

function progressUpdate(deps: ChatAgentDeps, input: ChatAgentInput, progress: AgentProgress): ChatProgress {
  const previous = deps.state.chatProgress.get(input.requestId);
  const authoring = deps.state.chatAuthoring?.requestId === input.requestId ? deps.state.chatAuthoring.progress : undefined;
  return {
    requestId: input.requestId,
    step: progress.step,
    maxSteps: previous ? previous.maxSteps : deps.state.options.maxAgentSteps ?? progress.maxSteps,
    phase: progress.phase,
    label: progress.label,
    notes: noteTrail(previous, progress),
    at: deps.state.now().toISOString(),
    wrappingUp: progress.wrappingUp === true,
    ...carriedDetails(previous, authoring, progress),
  };
}

/** The loop's progress callback: it replaces the turn's progress record wholesale and logs the step's token usage. */
export function agentProgressRecorder(deps: ChatAgentDeps, input: ChatAgentInput): (progress: AgentProgress) => void {
  return (progress) => {
    const update = progressUpdate(deps, input, progress);
    if (progress.usage) deps.planLog.logStepUsage(input.requestId, progress.step, progress.usage);
    deps.state.chatProgress.set(input.requestId, update);
  };
}

interface ToolProgressScope {
  readonly name: string;
  readonly requestId: string;
  readonly openQueuePlanId: string | null;
}

/** Tells the panel what a successful tool reply authored: the authoring line, a changed plan list and the plan's author. */
export function recordToolProgress(deps: ChatAgentDeps, scope: ToolProgressScope, reply: AgentToolReply): void {
  if (!reply.ok) return;
  const payload = replyPayload(reply);
  deps.chatSupport.recordAuthoringProgress(scope.requestId, scope.name, payload, scope.openQueuePlanId);
  if (PLAN_AUTHORING_TOOLS.has(scope.name)) deps.transport.notifyChange();
  announcePlanTool(deps.state, { name: scope.name, planId: payload?.planId ?? scope.openQueuePlanId, source: "panel" });
}
