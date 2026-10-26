// Which host ids a workflow job itself created, so removing them is the job tidying its own work rather than deleting the user's.
import type { StoredPlan } from "@extynt/mcp-server";
import type { SidecarState } from "../server-state.js";
import { verifiedCreatedBindings } from "../server-created-bindings.js";
import { appliedCreatedBindings } from "../server-contracts.js";

interface CreatingBatch { execution: { receipt?: { createdBindings?: ReadonlyArray<{ createdId: string }> } | null } }

/** The created ids in the receipts of these batches (a batch that has no receipt yet contributes nothing). */
export function receiptCreatedIds(batches: Iterable<CreatingBatch | null | undefined>): string[] {
  return [...batches].flatMap((batch) => (batch?.execution.receipt?.createdBindings ?? []).map((binding) => binding.createdId));
}

/**
 * The real host ids this job's earlier batches created: the created bindings of every batch in the workflow job, and of every plan the
 * plan store stamped with the job (a legacy plan contributes its verified receipt). Empty for no job, so a delete that cannot be tied to
 * a job's own work is never proven owned.
 */
export function jobCreatedIds(state: Pick<SidecarState, "plans" | "workflowCoordinator">, jobId: string | undefined): ReadonlySet<string> {
  if (!jobId) return new Set();
  const coordinator = state.workflowCoordinator, store = coordinator.workflowStore.getState();
  const stamped = [...state.plans.values()].filter((record) => record.jobId === jobId);
  const legacy = stamped.filter((record) => !coordinator.batchForPlan(record.plan.planId)).flatMap((record) => Object.values(verifiedCreatedBindings(record)));
  return new Set([
    ...receiptCreatedIds((store.jobs[jobId]?.batchIds ?? []).map((batchId) => store.batches[batchId])),
    ...receiptCreatedIds(stamped.map((record) => coordinator.batchForPlan(record.plan.planId))),
    ...legacy,
  ]);
}

const STANDING: ReadonlySet<string> = new Set(["applied", "applied_unverified", "verified"]);

interface CreatorPlans {
  plans: ReadonlyMap<string, StoredPlan>;
  batchForPlan: (planId: string) => CreatingBatch | null | undefined;
}

interface CallerWork {
  own: ReadonlySet<string>;
  caller: "panel" | "external";
  held: CreatorPlans;
  sources: ReadonlyMap<string, string>;
  jobId: string | undefined;
}

/**
 * What the caller's own work created: the job's ids, and for an external client also the ids its applied plans (plan source "agent") created
 * within this same job. An external client continues a job by passing its jobId to ae_plan_create; a plan that names none starts a job of
 * its own, so plans of other jobs are never counted and a new job never owns a previous job's layers.
 */
export function callerCreatedIds(work: CallerWork): ReadonlySet<string> {
  const { own, caller, held, sources, jobId } = work;
  if (caller !== "external" || !jobId) return own;
  const applied = [...held.plans.values()].filter((record) => record.jobId === jobId && sources.get(record.plan.planId) === "agent" && STANDING.has(record.status));
  const batched = receiptCreatedIds(applied.map((record) => held.batchForPlan(record.plan.planId)));
  return new Set([...own, ...batched, ...applied.flatMap((record) => Object.values(appliedCreatedBindings(record)))]);
}
