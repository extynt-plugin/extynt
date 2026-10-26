// Records each finished tool call on the turn's trace and in the sidecar log, redacted and bounded, plus the benchmark event for a refused operation batch.
import { array, decode, decodeJson, nullable, object, optional, rawJson, string } from "@extynt/decode";
import { redactText, type AgentToolCall } from "@extynt/llm";
import { MAX_DIAGNOSTIC_TEXT_CHARS, MAX_LOGGED_ARG_CHARS } from "./agent-policy.js";
import { queueAnswerLog } from "./agent-queue-answer.js";
import { callSignature, type AgentLoopContext, type StepRuntime } from "./agent-turn.js";
import type { AgentToolLogLine, ToolResult } from "./agent-types.js";

const MAX_DESIGN_RESULT_CHARS = 2_400;
const OPERATION_FAMILY = /^[a-z][a-z0-9_]{0,63}$/;
const QUEUE_VALIDATION_TOOLS: ReadonlySet<string> = new Set(["ae_queue_add", "ae_queue_fix", "ae_queue_finish", "ae_propose_plan", "ae_plan_add", "ae_plan_complete"]);
const OPERATIONS = object({ operations: optional(array(rawJson())) });
const OPERATION_TYPE = object({ type: optional(nullable(string())), operation: optional(nullable(string())) });

/** The text with secrets removed and cut to `maxStringLength`; file paths are masked unless `includeFilePaths`. */
export function redactedText(text: string, maxStringLength: number, includeFilePaths: boolean): string {
  const { value } = redactText(text, { includeFilePaths, maxStringLength });
  return typeof value === "string" ? value : "";
}

function failureFields(result: ToolResult): Pick<AgentToolLogLine, "code" | "message"> {
  if (result.ok) return {};
  return { code: result.error?.code, message: result.error?.message.slice(0, MAX_DIAGNOSTIC_TEXT_CHARS) };
}

function designResultField(call: AgentToolCall, result: ToolResult): Pick<AgentToolLogLine, "designResult"> {
  if (call.name !== "ae_queue_design" || !result.ok || result.data === undefined) return {};
  return { designResult: redactedText(JSON.stringify(result.data), MAX_DESIGN_RESULT_CHARS, true) };
}

function submittedOperationTypes(args: AgentToolCall["arguments"]): string[] {
  const listed = decode(OPERATIONS, args);
  const entries = listed.ok ? (listed.value.operations ?? []) : [];
  const types = entries.flatMap((entry) => {
    const operation = decodeJson(entry, OPERATION_TYPE);
    const type = operation.ok ? (operation.value.type ?? operation.value.operation) : undefined;
    return type !== undefined && type !== null && OPERATION_FAMILY.test(type) ? [type] : [];
  });
  return [...new Set(types)];
}

function recordAdmissionRejection(context: AgentLoopContext, runtime: StepRuntime, call: AgentToolCall, result: ToolResult): void {
  if (result.ok || !QUEUE_VALIDATION_TOOLS.has(call.name)) return;
  context.input.log?.({
    event: "agent.admission_rejected",
    requestId: context.input.requestId,
    step: runtime.step + 1,
    tool: call.name,
    errorCode: result.error?.code ?? "UNKNOWN",
    repairAttempt: (context.failedCalls.get(callSignature(call)) ?? 0) + 1,
    operationTypes: submittedOperationTypes(call.arguments),
  });
}

/** Adds the call to the turn's trace, logs it (outcome, bounded design and queue answers, redacted arguments) and logs an operation batch the queue refused. */
export function recordToolResult(context: AgentLoopContext, runtime: StepRuntime, call: AgentToolCall, result: ToolResult): void {
  const failure = failureFields(result);
  context.result.tools.push({ name: call.name, ok: result.ok, ...failure });
  const answer = queueAnswerLog(call, result);
  context.input.log?.({
    event: "agent.tool",
    requestId: context.input.requestId,
    step: runtime.step + 1,
    tool: call.name,
    ok: result.ok,
    ...failure,
    ...designResultField(call, result),
    ...(answer ? { queueAnswer: answer } : {}),
    args: redactedText(JSON.stringify(call.arguments), MAX_LOGGED_ARG_CHARS, true),
  });
  recordAdmissionRejection(context, runtime, call, result);
}
