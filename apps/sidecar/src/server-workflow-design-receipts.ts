/**
 * What a job's plans and receipts say about a designed scene: the ids they created, the layers they removed, the names behind those ids. It also brings the
 * owner's open batch forward over the designer's applied plans of the same job: the batch was authored against the project as it was, and those plans moved
 * the project on, which is the one drift the chain of receipts explains (the same notion apply admission rebases over).
 */
import { computePlanDigest } from "@extynt/action-plan";
import { decode, type JsonObject, jsonObject, skippingInvalidRecord, string } from "@extynt/decode";
import { planOperationCount, planOperations, type StoredPlan } from "@extynt/mcp-server";
import type { ChatAgentDeps, ChatAgentInput } from "./server-chat-agent-types.js";
import { stringsIn, targetLayerId, textOf } from "./server-workflow-operation-json.js";
import { recordSeedAction } from "./server-workflow-sidecar-actions.js";
import { specialistWorkflowId } from "./server-workflow-specialist-id.js";

/** What the design build reads of the chat agent's dependencies. */
export type DesignDeps = Pick<ChatAgentDeps, "state" | "planState">;

/** The newest normalized project snapshot. */
export type PlanSnapshot = NonNullable<ReturnType<DesignDeps["planState"]["normalizedLatest"]>>;

const CREATED = skippingInvalidRecord(string());

/** The operations of a stored plan as JSON objects. */
export function operationsOf(stored: StoredPlan): JsonObject[] {
  return planOperations(stored).flatMap((operation) => {
    const decoded = decode(jsonObject, operation);
    return decoded.ok ? [decoded.value] : [];
  });
}

/** The plan the open queue holds, when the queue is open. */
export function openPlanOf(deps: Pick<DesignDeps, "state">): StoredPlan | undefined {
  const planId = deps.state.openQueuePlanId;
  return planId ? deps.state.plans.get(planId) : undefined;
}

/** How many operations the open queue holds. */
export function queuedOperationCount(deps: Pick<DesignDeps, "state">): number {
  const open = openPlanOf(deps);
  return open ? planOperationCount(open) : 0;
}

function createdMap(stored: StoredPlan): Map<string, string> {
  const decoded = decode(CREATED, stored.receipt?.created);
  return new Map(decoded.ok ? Object.entries(decoded.value) : []);
}

function jobPlansNewestFirst(deps: DesignDeps, workflowJobId: string | undefined): StoredPlan[] {
  if (!workflowJobId) return [];
  const coordinator = deps.state.workflowCoordinator;
  return [...deps.state.plans.values()].reverse().filter((stored) => coordinator.jobIdForPlan(stored.plan.planId) === workflowJobId);
}

/** The id a receipt of this job gave a placeholder such as `__new__:scene`, newest plan first: placeholders recur across jobs, so only this job's plans may resolve one. */
export function createdId(deps: DesignDeps, placeholder: string, workflowJobId: string | undefined): string | undefined {
  for (const stored of jobPlansNewestFirst(deps, workflowJobId)) {
    const id = createdMap(stored).get(placeholder);
    if (id !== undefined) return id;
  }
  return undefined;
}

/** Every composition id this job's applied plans created, newest plan first, without repeats. */
export function jobCreatedCompositionIds(deps: DesignDeps, workflowJobId: string | undefined): string[] {
  const ids = jobPlansNewestFirst(deps, workflowJobId).flatMap((stored) => [...createdMap(stored).values()]);
  return [...new Set(ids)];
}

function awaitsReceipt(stored: StoredPlan): boolean {
  return !stored.receipt && stored.status !== "cancelled" && stored.status !== "failed";
}

function layerIdIn(stored: StoredPlan, name: string): string | null | undefined {
  const ids = createdMap(stored);
  for (const operation of operationsOf(stored).reverse()) {
    const placeholder = targetLayerId(operation);
    if (operation.type !== "create_layer" || operation.name !== name || placeholder === undefined) continue;
    const id = ids.get(placeholder);
    if (id !== undefined) return id;
    if (awaitsReceipt(stored)) return null;
  }
  return undefined;
}

/**
 * The id a receipt of this job gave the newest layer of that name its create_layer placeholder (the queue renames placeholders, so the plan is read, not
 * guessed). A newer plan that creates the name and has no receipt yet hides the older ones: its layer replaces them, so their ids are not the answer.
 */
export function createdLayerId(deps: DesignDeps, workflowJobId: string | undefined, name: string): string | undefined {
  for (const stored of jobPlansNewestFirst(deps, workflowJobId)) {
    const id = layerIdIn(stored, name);
    if (id !== undefined) return id ?? undefined;
  }
  return undefined;
}

function removedTargets(stored: StoredPlan): string[] {
  return operationsOf(stored).flatMap((operation) => (operation.type === "remove_layer" ? targetLayerId(operation) ?? [] : []));
}

/** Ids this job's applied plans removed, so a project read that has not caught up cannot hand back a layer the designer already replaced. */
export function removedLayerIds(deps: DesignDeps, workflowJobId: string | undefined): Set<string> {
  const removed = new Set<string>();
  for (const stored of jobPlansNewestFirst(deps, workflowJobId)) {
    if (stored.receipt) for (const id of removedTargets(stored)) removed.add(id);
  }
  return removed;
}

function createdLayerNames(deps: DesignDeps, workflowJobId: string): Map<string, string> {
  const names = new Map<string, string>();
  for (const stored of jobPlansNewestFirst(deps, workflowJobId).reverse()) {
    const created = createdMap(stored);
    for (const operation of operationsOf(stored)) {
      const placeholder = targetLayerId(operation);
      const name = operation.type === "create_layer" ? textOf(operation.name) : undefined;
      const id = placeholder === undefined ? undefined : created.get(placeholder);
      if (id !== undefined && name !== undefined) names.set(id, name);
    }
  }
  return names;
}

function staleOwnerBatch(deps: DesignDeps): { stored: StoredPlan; snapshot: PlanSnapshot } | undefined {
  const stored = openPlanOf(deps);
  const snapshot = deps.planState.normalizedLatest();
  if (!stored || !snapshot || stored.status !== "draft" || stored.plan.snapshotFingerprint === snapshot.fingerprint) return undefined;
  return { stored, snapshot };
}

function explainingChain(deps: DesignDeps, workflowJobId: string | undefined, span: { from: string; to: string }): string[] | undefined {
  const chain = workflowJobId ? deps.planState.lineageChain(span.from, span.to) : null;
  if (!chain?.length || !workflowJobId || chain.some((id) => deps.state.workflowCoordinator.jobIdForPlan(id) !== workflowJobId)) return undefined;
  return chain;
}

function removedByChain(deps: DesignDeps, chain: readonly string[]): Set<string> {
  const removed = new Set<string>();
  for (const id of chain) {
    const applied = deps.state.plans.get(id);
    for (const target of applied ? removedTargets(applied) : []) removed.add(target);
  }
  return removed;
}

function rebase(deps: DesignDeps, stored: StoredPlan, snapshot: PlanSnapshot): void {
  stored.plan.snapshotFingerprint = snapshot.fingerprint;
  stored.plan.selectionFingerprint = snapshot.selectionFingerprint;
  stored.plan.freshness = snapshot.freshness;
  stored.plan.digest = computePlanDigest(stored.plan);
  stored.updatedAt = deps.state.now().toISOString();
}

function dropOpenBatch(deps: DesignDeps, stored: StoredPlan): void {
  stored.status = "cancelled";
  stored.updatedAt = deps.state.now().toISOString();
  deps.state.openQueuePlanId = null;
}

function discardNote(count: number, replaced: readonly string[], names: ReadonlyMap<string, string>): string {
  const named = replaced.map((id) => (names.get(id) ? `${names.get(id)} (${id})` : id)).join(", ");
  return `discarded your open batch (${count} operation${count === 1 ? "" : "s"}, none applied) because the visual-scene designer rebuilt layers it pointed at: ${named}. Queue those operations again against the layers that exist now.`;
}

/**
 * The owner's open batch after the designer's work. If the designer's applied plans of the same job moved the project on, the batch is brought forward to the
 * current project. If it points at a layer the designer replaced it is discarded instead, and the model is told once; an empty one is simply dropped.
 */
export function bringOwnerBatchForward(deps: DesignDeps, input: ChatAgentInput): void {
  const workflowJobId = specialistWorkflowId(deps, input);
  const stale = staleOwnerBatch(deps);
  if (!stale) return;
  const { stored, snapshot } = stale;
  const operations = operationsOf(stored);
  if (!operations.length) return dropOpenBatch(deps, stored);
  const chain = explainingChain(deps, workflowJobId, { from: stored.plan.snapshotFingerprint, to: snapshot.fingerprint });
  if (!chain || !workflowJobId) return;
  const removed = removedByChain(deps, chain);
  const replaced = [...new Set(stringsIn(operations).filter((text) => removed.has(text)))];
  if (!replaced.length) return rebase(deps, stored, snapshot);
  const names = createdLayerNames(deps, workflowJobId);
  dropOpenBatch(deps, stored);
  recordSeedAction(deps.state, input.workflowJobId, discardNote(operations.length, replaced, names));
}
