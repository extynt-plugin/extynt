// The state one agent turn carries between steps, and the pure builders for it: the budget, the bounded history, the offered tools and the empty result.
import { imagesAccepted, type AgentMessage, type AgentToolCall, type AgentToolSpec, type ToolCallingProvider } from "@extynt/llm";
import { budgetChars, DEFAULT_AGENT_MAX_STEPS, estimateTokens, PROMPT_BACKSTOP_MULTIPLE, turnBudget, wrapUpSteps, type TurnBudget } from "./agent-policy.js";
import { agentToolSpecs } from "./agent-tool-specs.js";
import { toolSurface, type ToolSurface } from "./agent-tool-surface.js";
import { WORKFLOW_STAGE_TOOL, type AgentFailure, type AgentProgress, type AgentRunInput, type AgentRunResult } from "./agent-types.js";

/** Why the loop stops before the model answers in prose; at most one is ever set, because the loop returns as soon as one is. */
export type TurnStop = "running" | "sealed" | "asked-user" | "workflow-completion";

/** Everything a turn's steps share: the provider and input, the offered tools, the conversation so far, the result being built and the flags that steer the next step. */
export interface AgentLoopContext {
  readonly provider: ToolCallingProvider;
  readonly input: AgentRunInput;
  readonly tools: AgentToolSpec[];
  readonly surface: ToolSurface;
  readonly allowed: ReadonlySet<string>;
  readonly maxSteps: number;
  readonly wrapUp: number;
  readonly messages: AgentMessage[];
  readonly result: AgentRunResult;
  readonly viewMemory: { lastView: Map<string, string> };
  readonly failedCalls: Map<string, number>;
  readonly completionRefusals: Map<string, string>;
  budget: TurnBudget;
  prefixTokens: number;
  lastPlanError: AgentFailure | undefined;
  stop: TurnStop;
  lastToolFailed: boolean;
  stageSealed: boolean;
}

/** One step of a turn: its index, how to build its thinking progress event and how to stream its reasoning. */
export interface StepRuntime {
  readonly step: number;
  readonly update: (reasoning?: string) => AgentProgress;
  readonly onDelta: (delta: { text: string; reasoning: string }) => void;
}

/** A progress event for step index `step`, carrying a snapshot of the usage so far and the wrap-up flag for the steps left. */
export function progressEvent(context: AgentLoopContext, step: number, fields: Pick<AgentProgress, "phase" | "label" | "tool" | "reasoning">): AgentProgress {
  return { step: step + 1, maxSteps: context.maxSteps, wrappingUp: context.maxSteps - (step + 1) <= context.wrapUp, usage: { ...context.result.usage }, ...fields };
}

/** The identity of a call by name and exact arguments, for spotting a repeated call. */
export function callSignature(call: AgentToolCall): string {
  return `${call.name}:${JSON.stringify(call.arguments)}`;
}

/** The turn budget for the provider's window, pinned to the caller's tool budget when it gave one, and calibrated to a measured characters-per-token ratio when known. */
export function runBudget(provider: ToolCallingProvider, input: AgentRunInput, charsPerToken?: number): TurnBudget {
  const derived = turnBudget(provider.config?.contextWindow, provider.config?.reasoningEffort, charsPerToken);
  const pinned = input.toolBudgetTokens;
  if (pinned === undefined) return derived;
  return { ...derived, toolTokens: pinned, workingSetTokens: pinned, foldTokens: pinned, maxPromptTokens: derived.promptTokens + Math.min(pinned, pinned * PROMPT_BACKSTOP_MULTIPLE), ...budgetChars(pinned, derived.charsPerToken) };
}

function boundedHistory(input: AgentRunInput, budget: TurnBudget): AgentMessage[] {
  const history: AgentMessage[] = [];
  let historyTokens = 0;
  for (const turn of [...input.history].reverse()) {
    const tokens = estimateTokens(turn.content, budget.charsPerToken);
    if (historyTokens + tokens > budget.historyTokens) break;
    history.unshift({ role: turn.role, content: turn.content });
    historyTokens += tokens;
  }
  return history;
}

function initialAgentResult(): AgentRunResult {
  return { outcome: "answered", notes: [], answer: "", plans: [], tools: [], reasoning: [], steps: 0, steering: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0 } };
}

function offeredSpecs(provider: ToolCallingProvider, input: AgentRunInput): AgentToolSpec[] {
  return input.toolSpecs ?? agentToolSpecs({
    acceptsImages: imagesAccepted(provider.config?.acceptsImages, provider.capabilities?.current.images),
    webSearch: input.webSearch === true,
    workflowStage: input.workflowStage === true,
    workflowSpecialists: input.workflowSpecialists === true,
    workflowChecklist: input.workflowChecklist === true,
    wholeRead: input.wholeRead === true,
  });
}

function restrictedNames(input: AgentRunInput): ReadonlySet<string> | undefined {
  if (input.toolSpecs) return new Set(input.toolSpecs.map((tool) => tool.name));
  return input.allowedTools ? new Set(input.allowedTools) : undefined;
}

function turnSurface(provider: ToolCallingProvider, input: AgentRunInput): ToolSurface {
  const specs = offeredSpecs(provider, input);
  const names = restrictedNames(input);
  return toolSurface(names ? specs.filter((tool) => names.has(tool.name)) : specs, { restricted: names !== undefined });
}

/** A fresh turn: the offered tool surface, the bounded history plus the user's message, an empty result and every flag cleared. */
export function startTurn(provider: ToolCallingProvider, input: AgentRunInput): AgentLoopContext {
  const surface = turnSurface(provider, input);
  const tools = surface.offered;
  const budget = runBudget(provider, input);
  const maxSteps = input.maxSteps ?? DEFAULT_AGENT_MAX_STEPS;
  return {
    provider,
    input,
    tools,
    surface,
    allowed: new Set([...surface.byName.keys(), ...tools.map((tool) => tool.name), ...(input.workflowStage === true ? [WORKFLOW_STAGE_TOOL] : [])]),
    maxSteps,
    wrapUp: wrapUpSteps(maxSteps),
    messages: [...boundedHistory(input, budget), { role: "user", content: input.message }],
    result: initialAgentResult(),
    viewMemory: { lastView: new Map<string, string>() },
    failedCalls: new Map<string, number>(),
    completionRefusals: new Map<string, string>(),
    budget,
    prefixTokens: 0,
    lastPlanError: undefined,
    stop: "running",
    lastToolFailed: false,
    stageSealed: false,
  };
}
