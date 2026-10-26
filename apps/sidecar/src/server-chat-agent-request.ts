// Builds the request the agent loop runs one chat turn from: the briefing, the live state, the tool runner and every option the turn's input and the model's abilities switch on.
import { effortAtMost, imagesAccepted, type ChatProvider, type ProviderImage, type ReasoningEffort } from "@extynt/llm";
import type { AgentRunInput } from "./agent.js";
import { DISCOVERY_TOOLS } from "./discovery-briefing.js";
import { profileDirectory } from "./profile-store.js";
import { liveStateOf, type TurnBriefing } from "./server-chat-agent-briefing.js";
import type { AgentToolRunner } from "./server-chat-agent-call.js";
import { agentProgressRecorder } from "./server-chat-agent-progress.js";
import type { AgentCallState, ChatAgentDeps, ChatAgentInput } from "./server-chat-agent-types.js";
import { appendAgentStepLog } from "./server-agent-logs.js";
import { translatorOf } from "./ui-language.js";
import { PROVIDER_KEY_VARIABLES } from "./server-provider-models.js";
import { heldCompletion, withheldCompletion } from "./server-workflow-checklist-tools.js";
import { finalAnswerWake } from "./server-workflow-coverage-wake.js";
import { specialistWorkflowId } from "./server-workflow-specialist-id.js";
import { referencesOf, unseenReferencesLine } from "./workflow-references.js";

const BOOTSTRAP_EFFORT: ReasoningEffort = "medium";

interface AgentRunParts {
  readonly deps: ChatAgentDeps;
  readonly provider: ChatProvider;
  readonly input: ChatAgentInput;
  readonly briefing: TurnBriefing;
  readonly callState: AgentCallState;
  readonly runTool: AgentToolRunner;
}

type LoopOptions = Required<Pick<AgentRunInput, "callTool" | "liveState" | "takeSteering" | "onProgress">> & Pick<AgentRunInput, "beforeFinalAnswer">;

interface ReferenceImages {
  readonly images: ProviderImage[];
  readonly seen: boolean;
}

function takeSteering(deps: ChatAgentDeps, requestId: string): () => string[] {
  return () => {
    const queued = deps.state.chatSteering.get(requestId);
    if (!queued?.length) return [];
    deps.state.chatSteering.delete(requestId);
    return queued;
  };
}

function providerNameOf(deps: ChatAgentDeps, provider: ChatProvider): NonNullable<AgentRunInput["providerName"]> {
  const configured = provider === deps.state.fallbackChatProvider ? deps.state.modelKeyVariables.fallback : deps.state.modelKeyVariables.primary;
  const keyVariable = configured ?? PROVIDER_KEY_VARIABLES[provider.id];
  return { displayName: provider.displayMetadata.displayName, ...(keyVariable === undefined ? {} : { keyVariable }) };
}

function referenceImages(deps: ChatAgentDeps, provider: ChatProvider, input: ChatAgentInput): ReferenceImages {
  const stored = referencesOf(deps.state, specialistWorkflowId(deps, input));
  const images = stored.length ? stored : input.images ?? [];
  return { images, seen: images.length > 0 && imagesAccepted(provider.config?.acceptsImages, provider.capabilities?.current.images) };
}

function messageOf(deps: ChatAgentDeps, input: ChatAgentInput, references: ReferenceImages): string {
  const message = heldCompletion(deps, input, input.message);
  return references.images.length && !references.seen ? `${message}\n\n${unseenReferencesLine(references.images.length)}` : message;
}

function stepPolicy(provider: ChatProvider, state: AgentCallState): NonNullable<AgentRunInput["stepPolicy"]> {
  return () => {
    const effort = state.workflowStage ? provider.config.reasoningEffort : effortAtMost(provider.config.reasoningEffort, BOOTSTRAP_EFFORT);
    return effort === undefined ? {} : { reasoningEffort: effort };
  };
}

function holdsWholeRead(deps: ChatAgentDeps, input: ChatAgentInput): boolean {
  const snapshot = input.discoveryOnly ? undefined : deps.planState.normalizedLatest();
  return !!snapshot && !snapshot.coverage;
}

function scopeOptions(deps: ChatAgentDeps, input: ChatAgentInput): Partial<AgentRunInput> {
  return {
    ...(input.discoveryOnly ? { allowedTools: DISCOVERY_TOOLS } : {}),
    ...(!input.discoveryOnly && deps.chatSupport.webSearchBackend() ? { webSearch: true } : {}),
    ...(holdsWholeRead(deps, input) ? { wholeRead: true } : {}),
  };
}

function turnOptions(deps: ChatAgentDeps, input: ChatAgentInput): Partial<AgentRunInput> {
  return {
    ...(input.image ? { image: input.image } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.landingAt === undefined ? {} : { landingAt: input.landingAt }),
    ...(deps.state.options.maxAgentSteps ? { maxSteps: deps.state.options.maxAgentSteps } : {}),
    ...(input.stopAfterSeal ? { stopAfterSeal: true } : {}),
  };
}

function workflowOptions(parts: AgentRunParts): Partial<AgentRunInput> {
  const { deps, provider, input, callState } = parts;
  if (!input.workflowJobId) return {};
  return {
    stopAfterWorkflowCompletion: true,
    workflowStage: true,
    workflowSpecialists: true,
    ...(input.workflowChecklist ? { workflowChecklist: true, withheldTools: () => (withheldCompletion(deps, input) ? ["ae_workflow_complete"] : []) } : {}),
    stepPolicy: stepPolicy(provider, callState),
  };
}

function loggingOptions(deps: ChatAgentDeps, provider: ChatProvider, input: ChatAgentInput): Partial<AgentRunInput> {
  return {
    onStepDone: (done) => appendAgentStepLog(deps.state.options.stateDirectory ?? profileDirectory(), { requestId: input.requestId, ...(input.workflowJobId ? { workflowId: input.workflowJobId } : {}), at: deps.state.now().toISOString(), ...done }),
    log: (line) => {
      if (!deps.state.options.quietAgentLog) process.stdout.write(`${JSON.stringify({ at: deps.state.now().toISOString(), provider: provider.displayMetadata.displayName, ...line })}\n`);
    },
  };
}

function loopOptions(parts: AgentRunParts): LoopOptions {
  const { deps, input, runTool } = parts;
  return {
    liveState: liveStateOf(deps, input),
    takeSteering: takeSteering(deps, input.requestId),
    onProgress: agentProgressRecorder(deps, input),
    callTool: async (name, args) => heldCompletion(deps, input, await runTool(name, args)),
    ...(input.discoveryOnly ? {} : { beforeFinalAnswer: async (room) => heldCompletion(deps, input, await finalAnswerWake(deps, input, room)) }),
  };
}

/** The agent loop's request for one turn. Until a stage is selected a workflow turn reasons at medium at most, since those steps still read the whole project: a model set higher is capped there, one set lower keeps its own choice. Reference images are sent when the model takes images; otherwise the message says plainly that they were not seen. */
export function agentRunInput(parts: AgentRunParts): AgentRunInput {
  const { deps, provider, input, briefing } = parts;
  const references = referenceImages(deps, provider, input);
  return {
    requestId: input.requestId,
    message: messageOf(deps, input, references),
    history: input.history,
    briefing: briefing.text,
    briefingSegments: briefing.segments,
    autoApply: input.autoApply,
    translate: translatorOf(deps.state),
    providerName: providerNameOf(deps, provider),
    ...(references.seen ? { images: references.images } : {}),
    ...loopOptions(parts),
    ...scopeOptions(deps, input),
    ...turnOptions(deps, input),
    ...loggingOptions(deps, provider, input),
    ...workflowOptions(parts),
  };
}
