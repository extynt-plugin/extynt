// A tool context that holds an open ae_queue_* batch, and a reader for the plan that batch is building.
import assert from "node:assert/strict";
import { representativeSnapshot } from "@extynt/project-graph";
import type { StoredPlan, ToolContext } from "../../src/index.js";

/** A tool context whose queue pointer is readable, so a test can find the plan the queue is building. */
export type QueueContext = ToolContext & { plans: Map<string, StoredPlan>; queue: { planId: string | null; set: (id: string | null) => void } };

/** A fresh context over the representative snapshot with an empty plan store and no open queue; `extra` overrides context fields. */
export function queueContext(extra: Partial<ToolContext> = {}): QueueContext {
  const context: QueueContext = { snapshot: representativeSnapshot, plans: new Map<string, StoredPlan>(), queue: { planId: null, set: (id) => { context.queue.planId = id; } }, ...extra };
  return context;
}

/** The plan the open queue is building; fails the test when no queue is open or the plan is missing. */
export function queuedPlan(context: QueueContext): StoredPlan {
  const planId = context.queue.planId;
  assert.ok(planId, "a queue is open");
  const plan = context.plans.get(planId);
  assert.ok(plan, "the queue's plan is stored");
  return plan;
}
