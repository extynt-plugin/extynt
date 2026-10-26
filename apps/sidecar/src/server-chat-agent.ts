// The chat agent: it runs a turn of the agent loop, runs one tool as the turn would, and does the sidecar's own work at a free-run cycle boundary.
import { canRunAgent, runAgent, type AgentRunResult } from "./agent.js";
import type { ChatProvider } from "@extynt/llm";
import { turnBriefing } from "./server-chat-agent-briefing.js";
import type { AgentToolCall, AgentToolRunner, TurnToolRunner } from "./server-chat-agent-call.js";
import { withSidecarActions } from "./server-chat-agent-actions.js";
import { workflowCompletionReply } from "./server-chat-agent-completion.js";
import { dispatchAgentTool } from "./server-chat-agent-dispatch.js";
import { runNativeAgentTool } from "./server-chat-agent-native.js";
import { runPreflightedTool } from "./server-chat-agent-preflighted.js";
import { agentRunInput } from "./server-chat-agent-request.js";
import type { AgentCallState, AgentToolReply, ChatAgentCapability, ChatAgentDeps, ChatAgentInput } from "./server-chat-agent-types.js";
import { checklistJob } from "./server-workflow-checklist-tools.js";
import { checklistPlanned } from "./server-workflow-checklist.js";
import { releaseAtCycleStart } from "./server-workflow-design-flow.js";
import { completeFinishedTurn } from "./server-workflow-finish-turn.js";
import { withSelfSeal } from "./server-workflow-self-seal.js";
import { prepareCycle as prepareSidecarSpecialists } from "./server-workflow-sidecar-specialists.js";
import { specialistWorkflowId } from "./server-workflow-specialist-id.js";
import { landingExtender } from "./server-workflow-specialists.js";
import { workflowBriefing, workflowSegments } from "./workflow-contract.js";
import { orchestrationSummary } from "./workflow-orchestration.js";

interface TurnTools {
  readonly toolInput: ChatAgentInput;
  readonly callState: AgentCallState;
  readonly run: AgentToolRunner;
}

function runAgentTool(deps: ChatAgentDeps, call: AgentToolCall): Promise<AgentToolReply> {
  if (call.input.discoveryOnly) return runNativeAgentTool(deps, call);
  const { args, input, state } = call;
  const tools: TurnToolRunner = (name, toolArgs, toolState) => runAgentTool(deps, { name, args: toolArgs, input, state: toolState });
  return withSelfSeal(deps, input, { name: call.name, args }, (name, toolArgs) => {
    const next: AgentToolCall = { name, args: toolArgs, input, state };
    return dispatchAgentTool(deps, next, tools, () => runPreflightedTool(deps, next, tools));
  });
}

function turnTools(deps: ChatAgentDeps, provider: ChatProvider, input: ChatAgentInput): TurnTools {
  const toolInput: ChatAgentInput = { ...input, workflowOwnerProvider: provider };
  const callState: AgentCallState = {};
  return { toolInput, callState, run: (name, args) => runAgentTool(deps, { name, args: args, input: toolInput, state: callState }) };
}

function checklistTurnInput(deps: ChatAgentDeps, input: ChatAgentInput): ChatAgentInput {
  const jobId = checklistJob(deps, input);
  return jobId ? { ...input, workflowChecklist: true, ...(checklistPlanned(deps.state, jobId) ? { workflowPlanned: true } : {}) } : input;
}

function recordAgentWorkflowResult(deps: ChatAgentDeps, input: ChatAgentInput, callState: AgentCallState, result: AgentRunResult): void {
  if (callState.workflowCompletion) result.workflowCompletion = callState.workflowCompletion;
  if (callState.workflowCompletion?.accepted && callState.unbuiltNote) result.answer = [result.answer, callState.unbuiltNote].filter(Boolean).join("\n\n");
  const workflowId = specialistWorkflowId(deps, input);
  const orchestration = workflowId ? deps.state.workflowOrchestrations.get(workflowId) : undefined;
  if (orchestration) result.orchestration = orchestrationSummary(orchestration);
}

async function runChatAgent(deps: ChatAgentDeps, provider: ChatProvider, received: ChatAgentInput): Promise<AgentRunResult | undefined> {
  if (!canRunAgent(provider)) return undefined;
  const focusNote = await deps.focus.beforeTurn(received);
  const normalized = deps.planState.normalizedLatest();
  if (!normalized && received.workflowJobId) return undefined;
  const discovery = received.discoveryOnly === true || !normalized;
  const input = checklistTurnInput(deps, discovery ? { ...received, discoveryOnly: true, autoApply: false } : received);
  const base = await turnBriefing({ deps, provider, input, focusNote, normalized, discovery });
  const { toolInput, callState, run } = turnTools(deps, provider, input);
  const briefing = { text: workflowBriefing(base.text, input), segments: workflowSegments(base.segments, input) };
  const request = agentRunInput({ deps, provider, input, briefing, callState, runTool: async (name, args) => withSidecarActions(deps, toolInput, name, await run(name, args)) });
  Object.assign(toolInput, { extendLanding: landingExtender(request), log: request.log });
  await releaseAtCycleStart(deps, toolInput, run);
  const result = await runAgent(provider, request);
  await completeFinishedTurn(deps, toolInput, { callState, result }, run);
  recordAgentWorkflowResult(deps, input, callState, result);
  return result;
}

async function prepareCycle(deps: ChatAgentDeps, provider: ChatProvider, input: ChatAgentInput, goal: string): Promise<string | undefined> {
  if (!canRunAgent(provider)) return undefined;
  const { toolInput, run } = turnTools(deps, provider, input);
  return prepareSidecarSpecialists(deps, { provider, input: toolInput, goal, run });
}

/** The chat agent over the sidecar's state and capabilities. Both the turn and a single tool call run under one shared call state, the turn's own or the designer's. */
export function createChatAgent(deps: ChatAgentDeps): ChatAgentCapability {
  return {
    runAgentTool: (name, args, input, state) => runAgentTool(deps, { name, args: args, input, state }),
    runChatAgent: (provider, input) => runChatAgent(deps, provider, input),
    runNativeAgentTool: (name, args, input) => runNativeAgentTool(deps, { name, args, input }),
    prepareCycle: (provider, input, goal) => prepareCycle(deps, provider, input, goal),
    workflowCompletionTool: (name, args, input, state) => workflowCompletionReply(deps, { name, args, input, state }),
  };
}
