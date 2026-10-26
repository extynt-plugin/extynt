// A queue call that overflows the open batch but fits an empty one: the sidecar seals the open batch and queues the call into the next, instead of sending the model to do both.
import { decode, jsonObject, type JsonObject } from "@extynt/decode";
import { PLAN_UNDO_BATCH_SIZE, type callTool } from "@extynt/mcp-server";
import type { ToolArguments } from "./agent-types.js";
import type { ChatAgentDeps, ChatAgentInput } from "./server-chat-agent-types.js";
import { queuedWorkflowOperations, type QueuedOperationsDeps } from "./server-workflow-queue-boundary.js";

type ToolResult = ReturnType<typeof callTool>;
type Run = (name: string, args: ToolArguments) => Promise<ToolResult>;

interface Rollover {
  readonly answer?: ToolResult;
  readonly note?: string;
}

interface RolloverDeps { readonly state: QueuedOperationsDeps["state"] & Partial<Pick<ChatAgentDeps["state"], "workflowCoordinator">> }
interface RolloverCall { readonly name: string; readonly args: ToolArguments; readonly input: Pick<ChatAgentInput, "workflowJobId"> }

function sealedBatchCount(deps: RolloverDeps, input: Pick<ChatAgentInput, "workflowJobId">): number {
  const coordinator = deps.state.workflowCoordinator;
  const jobId = input.workflowJobId && coordinator ? coordinator.jobIdForSeed(input.workflowJobId) : undefined;
  return (jobId && coordinator ? coordinator.workflowStore.getState().jobs[jobId]?.batchIds.length : undefined) ?? 0;
}

function overflows(queued: number, submitted: number): boolean {
  return queued > 0 && submitted > 0 && submitted <= PLAN_UNDO_BATCH_SIZE && queued + submitted > PLAN_UNDO_BATCH_SIZE;
}

function withFields(result: ToolResult, fields: (data: JsonObject) => JsonObject): ToolResult {
  const data = result.ok ? decode(jsonObject, result.data) : undefined;
  return result.ok && data?.ok ? { ...result, data: fields(data.value) } : result;
}

function withAside(result: ToolResult, text: string): ToolResult {
  return withFields(result, (data) => ({ ...data, rollover: text }));
}

function submittedOperations(call: RolloverCall): number | undefined {
  const operations = call.args.operations;
  return call.name === "ae_queue_add" && call.input.workflowJobId && Array.isArray(operations) ? operations.length : undefined;
}

/** Seals the open batch exactly as ae_queue_finish would, when the call needs the next batch. A refused seal leaves the batch-bound refusal to stand, and a seal that reopened the queue for repair, or held the batch, is the answer to this call: the model must see it before adding more. */
export async function rollOverFullBatch(deps: RolloverDeps, call: RolloverCall, run: Run): Promise<Rollover> {
  const submitted = submittedOperations(call);
  const queued = queuedWorkflowOperations(deps);
  if (submitted === undefined || !overflows(queued, submitted)) return {};
  const sealed = await run("ae_queue_finish", {});
  if (!sealed.ok) return {};
  if (queuedWorkflowOperations(deps) > 0) return { answer: withAside(sealed, `Your ae_queue_add call of ${submitted} operations was not queued: sealing the ${queued} already queued came back with work to do first.`) };
  const batch = sealedBatchCount(deps, call.input);
  const label = batch > 0 ? `batch ${batch}` : "a batch";
  const next = batch > 0 ? `batch ${batch + 1}` : "the next batch";
  return { note: `Sealed the ${queued} queued operations as ${label} (applying); queued these ${submitted} as ${next}.` };
}

/** Puts the rollover note before the queue answer's own "next" so one sentence says what happened. */
export function withRolloverNote(result: ToolResult, note: string | undefined): ToolResult {
  if (!note) return result;
  return withFields(result, (data) => {
    const next = typeof data.next === "string" ? data.next : "";
    return { ...data, next: next ? `${note} ${next}` : note, rolledOver: true };
  });
}
