// The created-object ids a plan queue has proved: workflow batches that settled verified and legacy plans whose verified receipt read the ids back, with any placeholder or id claimed twice dropped.
import type { StoredPlan } from "@extynt/mcp-server";

import { verifiedCreatedBindings } from "./server-created-bindings.js";
import type { SidecarState } from "./server-state.js";

type BindingsState = Pick<SidecarState, "plans" | "workflowCoordinator">;
type Coordinator = BindingsState["workflowCoordinator"];
type Bindings = { created: Map<string, string>; createdIdOwners: Map<string, string>; conflictedPlaceholders: Set<string>; conflictedIds: Set<string> };
type Candidate = { bindings: Bindings; placeholder: string; createdId: string };
type Conflict = Candidate & { priorId: string | undefined; priorPlaceholder: string | undefined };

function findBindingConflict({ bindings, placeholder, createdId }: Candidate): Conflict | undefined {
  const priorId = bindings.created.get(placeholder);
  const priorPlaceholder = bindings.createdIdOwners.get(createdId);
  const claimedTwice = priorId !== undefined || (priorPlaceholder !== undefined && priorPlaceholder !== placeholder);
  if (bindings.conflictedPlaceholders.has(placeholder) || bindings.conflictedIds.has(createdId) || claimedTwice) return { bindings, placeholder, createdId, priorId, priorPlaceholder };
  return undefined;
}

function removeConflictedBindings(bindings: Bindings): void {
  for (const [placeholder, createdId] of bindings.created) if (bindings.conflictedPlaceholders.has(placeholder) || bindings.conflictedIds.has(createdId)) bindings.created.delete(placeholder);
}

function markBindingConflict({ bindings, placeholder, createdId, priorId, priorPlaceholder }: Conflict): void {
  bindings.conflictedPlaceholders.add(placeholder);
  bindings.conflictedIds.add(createdId);
  if (priorId !== undefined) bindings.conflictedIds.add(priorId);
  if (priorPlaceholder !== undefined) bindings.conflictedPlaceholders.add(priorPlaceholder);
  removeConflictedBindings(bindings);
}

function addAuthoritativeBinding(candidate: Candidate): void {
  const conflict = findBindingConflict(candidate);
  if (conflict) { markBindingConflict(conflict); return; }
  candidate.bindings.created.set(candidate.placeholder, candidate.createdId);
  candidate.bindings.createdIdOwners.set(candidate.createdId, candidate.placeholder);
}

function collectWorkflowBindings(coordinator: Coordinator, record: StoredPlan, bindings: Bindings): void {
  const batch = coordinator.batchForPlan(record.plan.planId);
  if (batch?.lifecycle !== "settled" || batch.verification.state !== "verified") return;
  for (const binding of batch.execution.receipt?.createdBindings ?? []) addAuthoritativeBinding({ bindings, placeholder: binding.placeholder, createdId: binding.createdId });
}

function collectReceiptBindings(record: StoredPlan, bindings: Bindings): void {
  if (record.status !== "verified") return;
  for (const [placeholder, createdId] of Object.entries(verifiedCreatedBindings(record))) addAuthoritativeBinding({ bindings, placeholder, createdId });
}

/** Placeholder to created id for every binding the queue's settled plans proved; in a workflow the plan status is only a compatibility projection, so the batch decides. */
export function settledCreatedBindings(state: BindingsState): Record<string, string> {
  const bindings: Bindings = { created: new Map<string, string>(), createdIdOwners: new Map<string, string>(), conflictedPlaceholders: new Set<string>(), conflictedIds: new Set<string>() };
  for (const record of state.plans.values()) {
    if (state.workflowCoordinator.hasPlan(record.plan.planId)) collectWorkflowBindings(state.workflowCoordinator, record, bindings);
    else collectReceiptBindings(record, bindings);
  }
  return Object.fromEntries(bindings.created);
}
