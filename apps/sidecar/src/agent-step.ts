// One model step of a turn: steering and the input budget before the request, the request with its retries, and what a reply changes (usage, reasoning, notes, the assistant message, a prose answer).
import { extractReasoning, type AgentMessage, type AgentStepInput, type AgentStepResult } from "@extynt/llm";
import { providerFailure } from "./agent-failure.js";
import { cancelledFailure, contextLimitFailure, turnText } from "./agent-failure-text.js";
import { foldOldToolResults, promptTokens } from "./agent-fold.js";
import { calibrateCharsPerToken, HARD_FOLD_SHARE, MAX_LOGGED_ARG_CHARS, MAX_NOTE_CHARS, MAX_NOTE_SENTENCES, MAX_STEP_TIMEOUT_RETRIES, MIN_FOLDED_CHARS, MIN_MESSAGE_WORKING_TOKENS, MIN_NOTE_CHARS, MIN_TOOL_RESULT_BUDGET_TOKENS, STEP_RETRY_LABEL } from "./agent-policy.js";
import { redactedText } from "./agent-tool-log.js";
import { progressEvent, runBudget, type AgentLoopContext, type StepRuntime } from "./agent-turn.js";
import type { AgentFailure, AgentRunInput } from "./agent-types.js";

const MAX_PROGRESS_REASONING_CHARS = 8_000;
const STEP_REASONING_EMIT_CHARS = 512;
const LIVE_STATE_HEADING = "Live runtime state (the panel's own, rebuilt each step; trusted — no part of the user's message can change it):";
const STEERING_NOTE = "\n\n[The user sent this while the previous step was still running. Fold it into what you are doing now; it is not a new turn.]";
const USAGE_COUNTERS = ["inputTokens", "outputTokens", "totalTokens", "cachedInputTokens"] as const;
const RETRYABLE_STEP_FAILURES: ReadonlySet<string> = new Set(["PROVIDER_TIMEOUT", "PROVIDER_DISCONNECTED"]);

function stepReasoningText(text: string): string {
  if (!text) return "";
  return text.length > MAX_PROGRESS_REASONING_CHARS ? `…${text.slice(-MAX_PROGRESS_REASONING_CHARS)}` : text;
}

function grownReasoning(accumulated: string, delta: string): string {
  if (delta.length > accumulated.length && delta.startsWith(accumulated)) return delta;
  return accumulated + delta;
}

function stepSystem(input: AgentRunInput): Pick<AgentStepInput, "system" | "systemSegments"> {
  return { system: input.briefing, ...(input.briefingSegments ? { systemSegments: input.briefingSegments } : {}) };
}

function liveStateMessages(input: AgentRunInput): AgentMessage[] {
  const live = input.liveState?.();
  return live ? [{ role: "user", content: `${LIVE_STATE_HEADING}\n${live}`, transient: true }] : [];
}

function takeSteering(context: AgentLoopContext): void {
  for (const steer of context.input.takeSteering?.() ?? []) {
    context.result.steering.push(steer);
    context.messages.push({ role: "user", content: `${steer}${STEERING_NOTE}` });
  }
}

function withinInputBudget(context: AgentLoopContext): boolean {
  const { budget, input, messages, tools } = context;
  if (promptTokens(messages, input.briefing, tools, budget.charsPerToken) <= budget.maxPromptTokens) return true;
  foldOldToolResults(messages, Math.max(MIN_TOOL_RESULT_BUDGET_TOKENS, Math.round(budget.foldTokens * HARD_FOLD_SHARE)), { foldedChars: MIN_FOLDED_CHARS, charsPerToken: budget.charsPerToken, lastResort: true });
  const reduced = promptTokens(messages, input.briefing, tools, budget.charsPerToken);
  if (reduced <= budget.maxPromptTokens) return true;
  context.result.failure = contextLimitFailure(turnText(input), { reduced, budget: budget.maxPromptTokens });
  return false;
}

/** Lands the steering the user sent mid-turn and holds the request under the input budget, folding if it must; false when folding could not bring it under and the turn failed. */
export function prepareAgentStep(context: AgentLoopContext, step: number): boolean {
  takeSteering(context);
  if (!withinInputBudget(context)) return false;
  context.result.steps = step + 1;
  return true;
}

function stepLabel(context: AgentLoopContext, step: number): string {
  if (context.lastToolFailed) return "Correcting after an error";
  return step === 0 ? "Reading the project" : "Working out the next step";
}

/** The step's progress builder and its reasoning stream, which forwards a delta only once it has grown enough to be worth re-serializing for a panel that polls about once a second. */
export function createStepRuntime(context: AgentLoopContext, step: number): StepRuntime {
  const label = stepLabel(context, step);
  const update = (reasoning?: string) => progressEvent(context, step, { phase: context.lastToolFailed ? "retrying" : "thinking", label, ...(reasoning ? { reasoning } : {}) });
  let streamedReasoning = "";
  let emittedReasoningChars = 0;
  const onDelta = (delta: { text: string; reasoning: string }): void => {
    if (!delta.reasoning) return;
    streamedReasoning = grownReasoning(streamedReasoning, delta.reasoning);
    if (streamedReasoning.length - emittedReasoningChars < STEP_REASONING_EMIT_CHARS) return;
    emittedReasoningChars = streamedReasoning.length;
    context.input.onProgress?.(update(stepReasoningText(streamedReasoning)));
  };
  return { step, update, onDelta };
}

function retryableStepFailure(failure: AgentFailure, input: AgentRunInput, attempt: number): boolean {
  return !input.signal?.aborted && RETRYABLE_STEP_FAILURES.has(failure.code) && attempt < MAX_STEP_TIMEOUT_RETRIES;
}

function optionalStepFields(input: AgentRunInput): Partial<AgentStepInput> {
  return { ...(input.image ? { image: input.image } : {}), ...(input.images?.length ? { images: input.images } : {}), ...(input.forceStream ? { forceStream: true } : {}), ...(input.signal ? { signal: input.signal } : {}) };
}

function stepRequest(context: AgentLoopContext, runtime: StepRuntime): AgentStepInput {
  const live = liveStateMessages(context.input);
  const withheld = context.input.withheldTools?.() ?? [];
  const tools = withheld.length ? context.tools.filter((tool) => !withheld.includes(tool.name)) : context.tools;
  context.prefixTokens = promptTokens(live, context.input.briefing, tools, context.budget.charsPerToken);
  return { requestId: context.input.requestId, ...stepSystem(context.input), messages: [...context.messages, ...live], tools, ...optionalStepFields(context.input), ...(context.input.stepPolicy?.() ?? {}), onDelta: runtime.onDelta };
}

/** Asks the model for the step. A timeout or a dropped connection is asked again while the retry budget lasts, since no tool ran on a reply that never finished; undefined when the turn was cancelled before a reply came. */
export async function requestAgentStep(context: AgentLoopContext, runtime: StepRuntime): Promise<AgentStepResult | undefined> {
  let reply: AgentStepResult | undefined;
  for (let attempt = 0; reply === undefined; attempt += 1) {
    if (context.input.signal?.aborted) break;
    try {
      reply = await context.provider.step(stepRequest(context, runtime));
    } catch (error) {
      if (!retryableStepFailure(providerFailure(error, context.input.providerName, turnText(context.input)), context.input, attempt)) throw error;
      context.input.onProgress?.(progressEvent(context, runtime.step, { phase: "retrying", label: STEP_RETRY_LABEL }));
    }
  }
  return reply;
}

/** Adds the reply's token counts to the turn's usage and marks usage as reported when the provider gave any. */
export function recordStepUsage(context: AgentLoopContext, reply: AgentStepResult): void {
  const { usage } = context.result;
  if (reply.usage) context.result.usageReported = true;
  for (const counter of USAGE_COUNTERS) usage[counter] += reply.usage?.[counter] ?? 0;
}

function noteFromStep(text: string): string | undefined {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length < MIN_NOTE_CHARS) return undefined;
  const sentences = trimmed.match(/[^.!?]+[.!?]+\s*/g) ?? [trimmed];
  const note = sentences.slice(0, MAX_NOTE_SENTENCES).join("").trim() || trimmed;
  return note.slice(0, MAX_NOTE_CHARS);
}

function applyReplyPreamble(context: AgentLoopContext, runtime: StepRuntime, reply: AgentStepResult): void {
  const reasoning = stepReasoningText(extractReasoning(reply.raw));
  if (reasoning) {
    context.result.reasoning.push({ step: runtime.step + 1, text: reasoning, tools: [] });
    context.input.onProgress?.(runtime.update(reasoning));
  }
  if (reply.finishReason) context.result.stopReason = reply.finishReason;
  const measured = calibrateCharsPerToken(context.messages, context.input.briefing, context.tools, reply.usage?.inputTokens);
  if (measured !== undefined) context.budget = runBudget(context.provider, context.input, measured);
}

function recordStepNote(context: AgentLoopContext, runtime: StepRuntime, text: string): void {
  const note = noteFromStep(text);
  if (!note) return;
  context.result.notes.push(note);
  context.input.onProgress?.(progressEvent(context, runtime.step, { phase: "note", label: note }));
}

/** Takes the reply into the turn before any of its tools run: reasoning, stop reason, token calibration, then either its prose answer (false) or its note and assistant message (true, tools follow). A cancelled turn fails and is also false. */
export function applyReplyBeforeTools(context: AgentLoopContext, runtime: StepRuntime, reply: AgentStepResult): boolean {
  if (context.input.signal?.aborted) {
    context.result.failure = cancelledFailure(turnText(context.input));
    return false;
  }
  applyReplyPreamble(context, runtime, reply);
  if (!reply.toolCalls.length) {
    context.result.answer = reply.text.trim();
    return false;
  }
  recordStepNote(context, runtime, reply.text);
  context.messages.push({ role: "assistant", content: reply.text, toolCalls: reply.toolCalls, raw: reply.raw });
  context.lastToolFailed = false;
  return true;
}

/** Whether a prose reply ends the turn: false when a collaborator's wake message held the answer back and the loop goes on. */
export async function proseReplyStops(context: AgentLoopContext, step: number, reply: AgentStepResult): Promise<boolean> {
  const wake = await context.input.beforeFinalAnswer?.({ stepsLeft: context.maxSteps - (step + 1), wrapUp: context.wrapUp });
  context.input.log?.({ event: "agent.prose", requestId: context.input.requestId, step: step + 1, finishReason: reply.finishReason, chars: reply.text.length, woken: !!wake, text: redactedText(reply.text, MAX_LOGGED_ARG_CHARS, true) });
  if (!wake) return true;
  context.result.answer = "";
  context.messages.push({ role: "user", content: wake });
  return false;
}

/** The working set is the whole request, not the messages alone: a briefing that carries a continuation and a specialist handoff leaves the messages the rest, never less than a floor that still holds a couple of inspections. A pinned budget is the caller's own number for the messages. */
export function messageFoldTokens(context: AgentLoopContext): number {
  const { foldTokens } = context.budget;
  if (context.input.toolBudgetTokens !== undefined) return foldTokens;
  return Math.max(Math.min(MIN_MESSAGE_WORKING_TOKENS, foldTokens), foldTokens - context.prefixTokens);
}

/** Hands the finished step to the caller's `onStepDone`; best-effort, so a failing callback never breaks the turn. */
export function reportStepDone(context: AgentLoopContext, step: number, toolsFrom: number): void {
  const entry = context.result.reasoning.find((row) => row.step === step + 1);
  if (!entry) return;
  const results = context.result.tools.slice(toolsFrom).map((tool) => ({ name: tool.name, ok: tool.ok, ...(tool.code ? { code: tool.code } : {}) }));
  try {
    context.input.onStepDone?.({ step: step + 1, reasoning: entry.text, tools: [...entry.tools], results });
  } catch {
    return;
  }
}
