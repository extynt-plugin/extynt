// The seal's reply: the plan is queued for the panel, a refusal rides beside the reply, and the turn's apply decision is narrowed by the seal's.
import { toolError } from "@extynt/mcp-server";
import type { AgentRunResult } from "./agent.js";
import { isNothingSealed, isUnchangedSeal } from "./agent-tool-control.js";
import { replyPayload, type ReplyPayload } from "./server-chat-agent-reply.js";
import type { AgentToolReply, AgentToolSuccess, ChatAgentDeps, ChatAgentInput } from "./server-chat-agent-types.js";
import { checklistJob } from "./server-workflow-checklist-tools.js";
import { noteUnchangedQueue, recordSeal } from "./server-workflow-checklist.js";
import { batchTooLargeResult, settleSealedPlan, type SealWait } from "./server-workflow-seal-receipt.js";

type QueuedPlan = ReturnType<ChatAgentDeps["workflowAdmission"]["queueReadyPlan"]>;
type AdmissionRefusal = NonNullable<AgentRunResult["workflowAdmissionRefusal"]>;

const SEAL_TOOLS: ReadonlySet<string> = new Set(["ae_plan_complete", "ae_queue_finish"]);

/** Whether the tool seals the batch being authored. */
export function isSealTool(name: string): boolean {
  return SEAL_TOOLS.has(name);
}

/** Rides beside the reply, never in it: the plan card reads it, the model does not. */
export function markApplyDecision(reply: AgentToolSuccess, autoApply: boolean): void {
  Object.assign(reply, { autoApply });
}

interface SealedReply {
  readonly deps: ChatAgentDeps;
  readonly reply: AgentToolSuccess;
  readonly name: string;
  readonly wait: SealWait;
  readonly openQueuePlanId: string | null;
  readonly input: ChatAgentInput;
  readonly autoApply: boolean;
}

function queueSealedPlan({ deps, openQueuePlanId, input, autoApply }: SealedReply, payload: ReplyPayload | undefined): QueuedPlan {
  const planData = openQueuePlanId ? { ...payload, planId: openQueuePlanId } : payload;
  return deps.workflowAdmission.queueReadyPlan(planData, { requestId: input.requestId, autoApply }, input.workflowJobId, input.workflowGoalSummary ?? input.message);
}

function refusalBeside(queued: QueuedPlan): AdmissionRefusal | undefined {
  return !queued.queued && queued.refusal ? { ...queued.refusal, planId: queued.planId } : undefined;
}

function eventLogFullReply(queued: QueuedPlan): AgentToolReply | undefined {
  if (queued.queued || queued.refusal?.code !== "EVENT_LOG_FULL") return undefined;
  const message = "Nothing was applied: the workflow event log is full, so extynt cannot record this batch and did not send it to After Effects (EVENT_LOG_FULL). Do not queue it again. Tell the user plainly what is already built and that the rest needs a new request.";
  return Object.assign(toolError("EVENT_LOG_FULL", message), { workflowAdmissionRefusal: { code: "EVENT_LOG_FULL", message: queued.refusal.message, planId: queued.planId ?? "" } });
}

function recordSealedChecklistBatch(deps: ChatAgentDeps, input: ChatAgentInput, queued: QueuedPlan): void {
  const jobId = checklistJob(deps, input);
  if (!jobId) return;
  recordSeal(deps.state, jobId, { batchId: queued.queued && queued.planId ? deps.state.workflowCoordinator.batchIdForPlan(queued.planId) : null }, deps.state.workflowCoordinator.workflowStore.getState());
}

function narrowedDecision(reply: AgentToolSuccess, turnDecision: boolean, sealDecision: boolean | undefined): boolean {
  const effective = turnDecision && sealDecision !== false;
  if (effective !== turnDecision) markApplyDecision(reply, effective);
  return effective;
}

function sealedNothing(deps: ChatAgentDeps, input: ChatAgentInput, reply: AgentToolSuccess): boolean {
  if (isUnchangedSeal(reply.data)) noteUnchangedQueue(deps.state, checklistJob(deps, input));
  return isNothingSealed(reply.data);
}

function sealRefusal(queued: QueuedPlan): AgentToolReply | undefined {
  return eventLogFullReply(queued) ?? batchTooLargeResult(queued);
}

/** Queues what a seal tool sealed under the queue handle the turn had open, and settles it. A seal the workflow event log could not record is a failure, never "sealed, queued to the panel", since nothing was sent to After Effects; its refusal still rides beside the reply for the cycle. A sealed batch belongs to the checklist items the queue's stage labels named, and a seal the admission refused is an attempt for them. The seal narrows the turn's decision with the ask-before-applying policy, so a risky plan waits for the user whatever the turn allows, and a narrowed card says so. Answers with a replacement reply when the admission refused the batch outright, and with nothing when the seal's own reply stands. A finish that found nothing open is no seal at all and touches nothing; one whose every value was already in After Effects is an attempt for the queue's items. */
export async function handleSealResult(sealed: SealedReply): Promise<AgentToolReply | undefined> {
  const { deps, reply, name, wait, openQueuePlanId, input, autoApply } = sealed;
  if (!isSealTool(name) || sealedNothing(deps, input, reply)) return undefined;
  const payload = replyPayload(reply);
  const queued = queueSealedPlan(sealed, payload);
  recordSealedChecklistBatch(deps, input, queued);
  const refused = sealRefusal(queued);
  if (refused) return refused;
  if (payload && !queued.queued) Object.assign(payload, { queueFull: queued });
  const refusal = refusalBeside(queued);
  if (refusal) Object.assign(reply, { workflowAdmissionRefusal: refusal });
  deps.delivery.attachSealedCard(reply, openQueuePlanId);
  if (narrowedDecision(reply, autoApply, queued.autoApply)) await settleSealedPlan({ deps, result: reply, data: payload, queued, wait, input });
  return undefined;
}
