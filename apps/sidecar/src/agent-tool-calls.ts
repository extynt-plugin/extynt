// Runs the tool calls of one model reply in order: resolves each, dispatches it, records the outcome, updates the turn and appends the answer the model reads next.
import type { AgentStepResult, AgentToolCall } from "@extynt/llm";
import { elideSpentReasoning } from "./agent-fold.js";
import { remainingBudget } from "./agent-policy.js";
import { toolResultText } from "./agent-plan.js";
import { toolProgressLabel } from "./agent-progress-labels.js";
import { queueWriteRefused } from "./agent-queue-answer.js";
import { updateToolControl } from "./agent-tool-control.js";
import { recordToolResult } from "./agent-tool-log.js";
import { resolveToolCall, unknownToolHint } from "./agent-tool-surface.js";
import { callSignature, progressEvent, type AgentLoopContext, type StepRuntime } from "./agent-turn.js";
import type { ToolResult } from "./agent-types.js";

interface RefusedWrite {
  name?: string | undefined;
}

interface ToolScope {
  readonly context: AgentLoopContext;
  readonly runtime: StepRuntime;
  readonly reply: AgentStepResult;
  readonly refused: RefusedWrite;
}

type ResolvedCall = ReturnType<typeof resolveToolCall>;

const QUEUE_SEAL_TOOLS: ReadonlySet<string> = new Set(["ae_queue_finish", "ae_plan_complete"]);

function failed(code: string, message: string): ToolResult {
  return { ok: false, error: { code, message } };
}

function rememberToolFailure(context: AgentLoopContext, call: AgentToolCall, result: ToolResult): string {
  const signature = callSignature(call);
  if (!result.ok) {
    context.lastToolFailed = true;
    context.failedCalls.set(signature, (context.failedCalls.get(signature) ?? 0) + 1);
  }
  const count = context.failedCalls.get(signature) ?? 0;
  return !result.ok && count > 1 ? `\n[You have already called ${call.name} with these exact arguments ${count} times and it failed the same way each time. Do not send them again: change the arguments the message asks you to change, or tell the user plainly what is blocking this.]` : "";
}

function isLastCall(reply: AgentStepResult, call: AgentToolCall): boolean {
  return reply.toolCalls[reply.toolCalls.length - 1]?.id === call.id;
}

function budgetNotes({ context, runtime, reply }: ToolScope, call: AgentToolCall): string {
  if (!isLastCall(reply, call)) return "";
  const stepsLeft = context.maxSteps - (runtime.step + 1);
  const fact = `\n[${remainingBudget(stepsLeft)}]`;
  if (stepsLeft <= 0 || stepsLeft > context.wrapUp || context.input.toolSpecs) return fact;
  const terminalAction = context.input.stopAfterWorkflowCompletion ? "and the job carries on in a fresh cycle after this one; do not call ae_workflow_complete just because this cycle is ending" : "or answer the user";
  return `${fact}\n[${stepsLeft} step${stepsLeft === 1 ? "" : "s"} left in this turn. Finish the queue you are holding and seal it with ae_queue_finish so the work already written reaches the project, then open the next one if there is room, ${terminalAction}; further inspection will be cut off.]`;
}

function appendToolMessage(scope: ToolScope, call: AgentToolCall, result: ToolResult): void {
  const { context } = scope;
  const repeatNote = rememberToolFailure(context, call, result);
  const content = `${toolResultText(result, context.budget.perResultChars, context.viewMemory)}${repeatNote}${budgetNotes(scope, call)}`;
  context.messages.push({ role: "tool", toolCallId: call.id, name: call.name, content });
}

async function fetchToolResult(context: AgentLoopContext, call: AgentToolCall): Promise<ToolResult> {
  if (call.argumentsError) return failed("INVALID_TOOL_ARGUMENTS", `Nothing ran: ${call.argumentsError}. Send ${call.name} again with its arguments as one JSON object.`);
  if (context.allowed.has(call.name)) return context.input.callTool(call.name, call.arguments);
  const hint = unknownToolHint(call.name, context.allowed);
  return failed("TOOL_NOT_AVAILABLE", context.input.allowedTools ? `${call.name} is unavailable in this restricted turn.${hint} Use only the offered tools; no proposal or approval is authorized.` : `${call.name} is not available in the panel chat.${hint} Propose a plan instead; the user applies it from the chat.`);
}

function sealAfterRefusal(call: AgentToolCall, refused: string | undefined): ToolResult | undefined {
  if (!refused || !QUEUE_SEAL_TOOLS.has(call.name)) return undefined;
  return failed("NOT_RUN_AFTER_REFUSAL", `Not run: the ${refused} call before it in this step named operations to fix, so the queue is missing them. Resend only the positions that answer names (anything it says is already queued stays as it is), then call ${call.name} in a later step.`);
}

async function callResult({ context, refused }: ToolScope, resolved: ResolvedCall): Promise<ToolResult> {
  const result = resolved.result ?? sealAfterRefusal(resolved.call, refused.name) ?? await fetchToolResult(context, resolved.call);
  if (!refused.name && queueWriteRefused(resolved.call, result)) refused.name = resolved.call.name;
  return result;
}

function noteToolOnReasoning({ context, runtime }: ToolScope, call: AgentToolCall): void {
  const reasoning = context.result.reasoning.find((entry) => entry.step === runtime.step + 1);
  if (reasoning && !reasoning.tools.includes(call.name)) reasoning.tools.push(call.name);
}

async function processToolCall(scope: ToolScope, offered: AgentToolCall): Promise<boolean> {
  const { context, runtime } = scope;
  if (context.input.signal?.aborted) return true;
  const resolved = resolveToolCall(context.surface, offered);
  const call = resolved.call;
  context.input.onProgress?.(progressEvent(context, runtime.step, { phase: "tool", tool: call.name, label: toolProgressLabel(call.name, context.input.translate) }));
  const result = await callResult(scope, resolved);
  noteToolOnReasoning(scope, call);
  recordToolResult(context, runtime, call, result);
  updateToolControl(context, call, result);
  appendToolMessage(scope, call, result);
  return context.stop !== "running";
}

/** Runs the reply's tool calls in order, stopping at the first one that ends the turn; when every call answered cleanly, the step's spent reasoning is elided. */
export async function processAgentTools(context: AgentLoopContext, runtime: StepRuntime, reply: AgentStepResult): Promise<void> {
  const scope: ToolScope = { context, runtime, reply, refused: {} };
  for (const call of reply.toolCalls) if (await processToolCall(scope, call)) return;
  if (!context.lastToolFailed && !scope.refused.name) elideSpentReasoning(context.messages);
}
