// What a workflow stage lets the model queue: its selected operation types, the one-undo-unit batch bound, and the ids a declaration needs but a user never names.
import { accepts, array, decodeOrThrow, fallback, jsonValue, map, object, skippingInvalid, string, type Decoder } from "@extynt/decode";
import { callTool, operationReference, planOperationCount, PLAN_UNDO_BATCH_SIZE, supplyDeclarationIds, type PlanOperationSource } from "@extynt/mcp-server";
import type { ToolArguments } from "./agent-types.js";
import type { ChatAgentDeps, WorkflowStageSelection } from "./server-chat-agent-types.js";

type ToolResult = ReturnType<typeof callTool>;

/** What counting the open queue reads from the sidecar state. */
export interface QueuedOperationsDeps {
  readonly state: { readonly openQueuePlanId: string | null; readonly plans: { get(planId: string): PlanOperationSource | undefined } };
}

const operationType = object({ type: string() });
const editedOperationType = object({ operation: operationType });
const editKind = object({ op: string() });
const EDIT_DELTA: ReadonlyMap<string, number> = new Map([["insert", 1], ["remove", -1]]);

let referenceCache: Map<string, string> | undefined;

function entriesOf<T>(entry: Decoder<T>): Decoder<ReadonlyArray<T>> {
  return fallback(skippingInvalid(entry), []);
}

const listLength: Decoder<number> = map(entriesOf(fallback(jsonValue, undefined)), (entries) => entries.length);

const jsonList = accepts(array(jsonValue));

function queueOperationTypes(args: ToolArguments): string[] {
  return decodeOrThrow(entriesOf(operationType), args.operations).map((operation) => operation.type);
}

function fixOperationTypes(args: ToolArguments): string[] {
  return decodeOrThrow(entriesOf(editedOperationType), args.edits).map((edit) => edit.operation.type);
}

function scopeBoundary(call: { readonly name: string; readonly args: ToolArguments }, stage: WorkflowStageSelection): ToolResult | undefined {
  if (call.name !== "ae_queue_add" && call.name !== "ae_queue_fix") return undefined;
  const usedTypes = call.name === "ae_queue_add" ? queueOperationTypes(call.args) : fixOperationTypes(call.args);
  const outside = [...new Set(usedTypes.filter((type) => !stage.operationTypes.includes(type)))];
  const known = workflowOperationReferenceIndex();
  if (outside.length && outside.every((type) => known.has(type))) stage.operationTypes.push(...outside);
  const unsupported = outside.filter((type) => !known.has(type));
  return unsupported.length ? { ok: false, error: { code: "WORKFLOW_STAGE_SCOPE", message: `This cycle selected ${stage.operationTypes.join(", ")}; unknown operation types ${unsupported.join(", ")} cannot be mechanically closed into the stage.` } } : undefined;
}

function batchBoundMessage(queued: number, submitted: number): string {
  const left = Math.max(0, PLAN_UNDO_BATCH_SIZE - queued);
  const head = `This workflow batch is one host undo unit: ${queued} operations are queued and ${left} slot${left === 1 ? "" : "s"} remain. Nothing from this ${submitted}-operation call was queued.`;
  if (submitted <= PLAN_UNDO_BATCH_SIZE && queued > 0) return `${head} Seal what is queued with ae_queue_finish, then send this same call unchanged as the next batch, which has room for all ${submitted}.`;
  return `${head} Split it into dependency-complete groups of at most ${PLAN_UNDO_BATCH_SIZE - queued > 0 ? PLAN_UNDO_BATCH_SIZE - queued : PLAN_UNDO_BATCH_SIZE} operations, sealing with ae_queue_finish between them.`;
}

function addBoundary(args: ToolArguments, queued: number): ToolResult | undefined {
  const submitted = decodeOrThrow(listLength, args.operations);
  return queued + submitted > PLAN_UNDO_BATCH_SIZE ? { ok: false, error: { code: "WORKFLOW_BATCH_BOUND", message: batchBoundMessage(queued, submitted) } } : undefined;
}

function fixBoundary(args: ToolArguments, queued: number): ToolResult | undefined {
  if (!Array.isArray(args.edits)) return undefined;
  const delta = decodeOrThrow(entriesOf(editKind), args.edits).reduce((sum, edit) => sum + (EDIT_DELTA.get(edit.op) ?? 0), 0);
  return queued + delta > PLAN_UNDO_BATCH_SIZE
    ? { ok: false, error: { code: "WORKFLOW_BATCH_BOUND", message: `Those edits would grow this one-undo workflow batch past ${PLAN_UNDO_BATCH_SIZE} operations. It currently holds ${queued}; remove or replace operations instead of inserting past the boundary.` } }
    : undefined;
}

/** The reference line of every native operation type, keyed by type, built once. */
export function workflowOperationReferenceIndex(): Map<string, string> {
  referenceCache ??= new Map(operationReference().lines.map((line) => [line.split(" — ", 1)[0] ?? "", line]));
  return referenceCache;
}

/** How many operations the open queue holds. */
export function queuedWorkflowOperations(deps: QueuedOperationsDeps): number {
  const planId = deps.state.openQueuePlanId;
  const open = planId ? deps.state.plans.get(planId) : undefined;
  return open ? planOperationCount(open) : 0;
}

/** Fills a declaration-only id the call left out, in place, before composition, so the provider does not spend another model turn naming a shape item the user never needed to name; the composer fills the same ids for any client that does not come through here. */
export function supplyWorkflowPlaceholders(args: ToolArguments, requestId: string, queued: number): void {
  const operations = args.operations;
  if (jsonList(operations)) supplyDeclarationIds(operations, requestId, queued);
}

/** Refuses a queue call that leaves the stage's operation types or overflows the one-undo-unit batch; an operation type the stage did not select but the reference knows joins the stage. */
export function workflowQueueBoundary(deps: ChatAgentDeps, name: string, args: ToolArguments, stage: WorkflowStageSelection): ToolResult | undefined {
  const scope = scopeBoundary({ name, args }, stage);
  if (scope) return scope;
  const queued = queuedWorkflowOperations(deps);
  if (name === "ae_queue_add") return addBoundary(args, queued);
  return name === "ae_queue_fix" ? fixBoundary(args, queued) : undefined;
}
