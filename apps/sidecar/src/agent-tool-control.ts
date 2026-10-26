// What a finished tool call changes about the turn: the plan cards it produced, whether it sealed a batch, asked the user, was refused at admission or proposed completion.
import { boolean, decode, isJsonArray, literal, object, optional, string, type JsonValue } from "@extynt/decode";
import type { AgentToolCall } from "@extynt/llm";
import { PLAN_TOOLS } from "./agent-policy.js";
import { planCard } from "./agent-plan.js";
import { callSignature, type AgentLoopContext, type TurnStop } from "./agent-turn.js";
import { WORKFLOW_ASK_TOOL, type ToolPayload, type ToolResult } from "./agent-types.js";

const SEAL_TOOLS: ReadonlySet<string> = new Set(["ae_plan_complete", "ae_queue_finish"]);
const ASKED_USER = object({ question: string(), kind: literal("question", "design-brief") });
const ADMISSION_REFUSAL = object({ code: string(), message: string(), planId: string() });
const TOOL_RESULT = object({ ok: boolean(), error: optional(object({ code: string(), message: string() })) });
const NOTHING_SEALED = object({ sealed: literal(false) });
const UNCHANGED_SEAL = object({ sealed: literal(false), unchanged: literal(true) });

/** Whether a seal tool answered that nothing was open to seal: a finish with no open batch is not a seal. */
export function isNothingSealed(data: JsonValue | undefined): boolean {
  return decode(NOTHING_SEALED, data).ok;
}

/** Whether a seal found every queued value already what it asks for and dropped the queue unsealed: that work is already in After Effects. */
export function isUnchangedSeal(data: JsonValue | undefined): boolean {
  return decode(UNCHANGED_SEAL, data).ok;
}

const isToolResult = (value: ToolPayload | undefined): value is ToolResult => decode(TOOL_RESULT, value).ok;

const isToolResults = (value: ToolPayload | undefined): value is ToolResult[] => isJsonArray(value) && value.every(isToolResult);

/** The seal results a tool answer carries, each counted as the model's own finish; none when it carries no list. */
export function embeddedSealsOf(result: ToolResult): readonly ToolResult[] {
  const seals = result.embeddedSeals;
  return isToolResults(seals) ? seals : [];
}

function stopTurn(context: AgentLoopContext, stop: TurnStop): void {
  if (context.stop === "running") context.stop = stop;
}

function addPlanCard(context: AgentLoopContext, call: AgentToolCall, result: ToolResult): void {
  if (!result.ok) {
    context.lastPlanError = result.error;
    return;
  }
  context.lastPlanError = undefined;
  const card = planCard(result.data, call.arguments, result.sealedCard, result.autoApply === true);
  if (!card) return;
  const index = context.result.plans.findIndex((entry) => entry.planId === card.planId);
  if (index >= 0) context.result.plans[index] = card;
  else context.result.plans.push(card);
}

function updateSealControl(context: AgentLoopContext, call: AgentToolCall, result: ToolResult): void {
  if (!SEAL_TOOLS.has(call.name) || !result.ok || isNothingSealed(result.data)) return;
  if (context.input.autoApply) context.result.mutated = true;
  if (result.continuesLoop === true) {
    context.result.settledInLoop = true;
    context.stageSealed = true;
  } else if (context.input.stopAfterSeal) {
    stopTurn(context, "sealed");
  }
}

function recordAskedUser(context: AgentLoopContext, result: ToolResult): void {
  const asked = decode(ASKED_USER, result.data);
  if (!asked.ok) return;
  stopTurn(context, "asked-user");
  context.result.askedUser = asked.value;
  context.result.answer = asked.value.question;
}

function recordAdmissionRefusal(context: AgentLoopContext, result: ToolResult): void {
  const refusal = decode(ADMISSION_REFUSAL, result.workflowAdmissionRefusal);
  if (refusal.ok) context.result.workflowAdmissionRefusal = refusal.value;
}

function workflowCompletionStops(context: AgentLoopContext, call: AgentToolCall, result: ToolResult): boolean {
  if (!context.input.stopAfterWorkflowCompletion || call.name !== "ae_workflow_complete") return false;
  if (result.ok) return true;
  const signature = callSignature(call);
  const refusal = `${result.error?.code ?? ""}:${result.error?.message ?? ""}`;
  const repeated = context.completionRefusals.get(signature) === refusal;
  context.completionRefusals.set(signature, refusal);
  return repeated;
}

/** Applies a finished call to the turn: its plan card, seal, question, admission refusal and completion proposal, then the seals it embeds, each counted as the model's own ae_queue_finish. */
export function updateToolControl(context: AgentLoopContext, call: AgentToolCall, result: ToolResult): void {
  if (PLAN_TOOLS.has(call.name)) addPlanCard(context, call, result);
  updateSealControl(context, call, result);
  const seals = result.embeddedSeals;
  if (isToolResults(seals)) for (const seal of seals) updateToolControl(context, { ...call, name: "ae_queue_finish", arguments: {} }, seal);
  if (result.tool === WORKFLOW_ASK_TOOL && result.ok) recordAskedUser(context, result);
  recordAdmissionRefusal(context, result);
  if (workflowCompletionStops(context, call, result)) stopTurn(context, "workflow-completion");
}
