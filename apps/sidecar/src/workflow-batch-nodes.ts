// The queue-time guard for the workflow engine's per-batch JSON-node bound: it refuses an ae_queue_add that cannot fit while the queue is still open and fixable.

import type { JsonValue } from "@extynt/decode";
import { MAX_WORKFLOW_JSON_NODES } from "@extynt/workflow";
import { jsonNodes, planOperations } from "@extynt/mcp-server";
import type { ChatAgentDeps } from "./server-chat-agent-types.js";

type QueueAddArguments = { readonly operations?: readonly JsonValue[] };

type BatchNodeRefusal = {
  readonly ok: false;
  readonly error: { readonly code: "OPERATION_TOO_HEAVY" | "BATCH_FULL"; readonly message: string };
};

/** What one batch's operations may spend; the rest covers the envelope admission wraps them in (operation ids, dimensions, up to 64 postconditions). */
export const BATCH_NODE_BUDGET = MAX_WORKFLOW_JSON_NODES - 1_024;

/** The slice of the chat deps the gate reads: which plan is the open queue and the plans themselves. */
export type QueueHolder = {
  readonly state: { readonly openQueuePlanId: string | null; readonly plans: Pick<ChatAgentDeps["state"]["plans"], "get"> };
};

/** The JSON-node count of any value, as the workflow engine's admission counts it. */
export { jsonNodes };

/** Nodes the open queue already holds. */
export function queuedNodes(deps: QueueHolder): number {
  const planId = deps.state.openQueuePlanId;
  const open = planId ? deps.state.plans.get(planId) : undefined;
  return open ? jsonNodes(planOperations(open)) : 0;
}

function tooHeavy(index: number, nodes: number): BatchNodeRefusal {
  return { ok: false, error: { code: "OPERATION_TOO_HEAVY", message: `Nothing from this call was queued: operation ${index} alone is ${nodes} data nodes, over the ${BATCH_NODE_BUDGET} one batch can hold. Simplify it (fewer shapes or path vertices, or one shape with a repeater instead of many copies) and queue it again.` } };
}

function batchFull(adding: number, held: number): BatchNodeRefusal {
  const advice = held ? "Seal what is queued with ae_queue_finish, then queue these operations in the next batch." : "Split these operations across two ae_queue_add calls with an ae_queue_finish between them.";
  return { ok: false, error: { code: "BATCH_FULL", message: `Nothing from this call was queued: it is ${adding} data nodes and the open queue already holds ${held} of the ${BATCH_NODE_BUDGET} one batch can hold. ${advice}` } };
}

function heaviestOperation(operations: readonly JsonValue[]): { readonly index: number; readonly nodes: number } | undefined {
  return operations.map((operation, index) => ({ index, nodes: jsonNodes(operation) })).sort((a, b) => b.nodes - a.nodes)[0];
}

/** ae_queue_add past the budget is refused before it lands, so the queue stays open: seal what is there and queue the rest next, or simplify the one operation that is too heavy alone. */
export function batchNodeGate(deps: QueueHolder, name: string, args: QueueAddArguments): BatchNodeRefusal | undefined {
  if (name !== "ae_queue_add" || !Array.isArray(args.operations)) return undefined;
  const adding = jsonNodes(args.operations);
  const held = queuedNodes(deps);
  if (held + adding <= BATCH_NODE_BUDGET) return undefined;
  const heaviest = heaviestOperation(args.operations);
  return heaviest && heaviest.nodes > BATCH_NODE_BUDGET ? tooHeavy(heaviest.index, heaviest.nodes) : batchFull(adding, held);
}
