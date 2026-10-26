// Sealing a plan that was authored step by step: every authored operation is composed again in order, judged as a whole, and only then digested and made approvable.
import { PLAN_UNDO_BATCH_SIZE } from "@extynt/host-ae";
import { computePlanDigest, validateActionPlan } from "@extynt/action-plan";
import type { ActionPlan, ActionPlanV2Operation } from "@extynt/action-plan";
import type { Infer, JsonArray, JsonObject } from "@extynt/decode";
import type { ProjectSnapshot } from "@extynt/project-graph";
import { verdictFix } from "./batch.js";
import type { OperationVerdict } from "./batch.js";
import { composeIncomingOperations } from "./compose.js";
import type { StoredPlan, ToolContext } from "./contracts.js";
import { jobFields, jobStatus } from "./job-status.js";
import type { JobStatus } from "./job-status.js";
import { jsonItems, jsonOf, objectOf } from "./json.js";
import { compactOperationEcho } from "./operation-echo.js";
import { planPathProblem } from "./path-policy.js";
import { authoredOperations, completenessNotes, crossOperationProblems, notYetResolvable, pinCanonicalIds, resolveSettledBatchNames, vocabulary } from "./plan-coherence.js";
import { authoredShell, authoringRecord, heldOperations } from "./plan-authoring.js";
import { orderExpressionsAfterDependencies } from "./plan-expression-order.js";
import { changesNothing, PLAN_NO_CHANGE } from "./plan-no-change.js";
import { presentPlanRows } from "./plan-rows.js";
import { planProblemMessage, planProblems } from "./plan-problems.js";
import type { PlanProblem } from "./plan-problem.js";
import { now, storeComposedPlan } from "./plan-store.js";
import type { AE_PLAN_COMPLETE } from "./tool-specs-plan.js";
import { toolError, toolSuccess } from "./tool-result.js";
import type { ToolBase, ToolFailure, ToolResult } from "./tool-result.js";

type CompleteArgs = Infer<typeof AE_PLAN_COMPLETE.input.decoder>;

/** A plan that was sealed: what was stored, and the counts the queue reports in its own words. */
export type SealedPlan = { readonly data: JsonObject; readonly operationCount: number; readonly undoGroups: number; readonly notes: JsonArray };

function authoredFrom(record: StoredPlan, context: ToolContext): JsonArray {
  return resolveSettledBatchNames(structuredClone(authoredOperations(record)), context.settledBatchIds ?? {});
}

function unclaimed(problems: readonly PlanProblem[], operations: readonly ActionPlanV2Operation[]): PlanProblem[] {
  const claimed = new Set(problems.map((problem) => problem.index));
  return [...problems, ...crossOperationProblems(operations).filter((problem) => !claimed.has(problem.index))].sort((left, right) => left.index - right.index);
}

/** Everything still standing against the plan as a whole, which is what a checkpoint re-reads: a fault that came into existence only when a later operation arrived is exactly what it is for. */
export function standingProblems(record: StoredPlan, snapshot: ProjectSnapshot, context: ToolContext): PlanProblem[] {
  const authored = authoredFrom(record, context);
  const built = composeIncomingOperations(authored, snapshot, context, { names: vocabulary(record), canonicalAt: pinCanonicalIds(authored), forwardReferences: true });
  if ("error" in built) return [];
  const operations = built.operations.map((entry) => entry.stored);
  const plan = authoredShell({ planId: record.plan.planId, summary: record.plan.summary, createdAt: record.createdAt }, snapshot, operations, built);
  const problems = planProblems(plan, operations, snapshot, context).map((problem) => notYetResolvable(problem, authored));
  return unclaimed(problems, operations);
}

function sealedNext(job: JobStatus | undefined, groups: number, operationCount: number, batchCount: number): string {
  const operations = `${operationCount} operation${operationCount === 1 ? "" : "s"}`;
  const batches = `${operationCount ? batchCount : 0} batch${batchCount === 1 ? "" : "es"}`;
  const undoGroups = groups > 1 ? ` in ${groups} undo groups` : "";
  const jobNote = job ? ` It is batch ${job.batches} of job ${job.id}: undo every batch of that job with ae_undo_plan scope "job" on any of them, or omit jobId on the next ae_plan_create to start a genuinely different job.` : "";
  return `The plan is sealed with ${operations} and cannot be added to any more. It was authored in ${batches} and will be applied as one plan${undoGroups}.${jobNote}`;
}

interface SealFacts {
  readonly snapshot: ProjectSnapshot;
  readonly record: StoredPlan;
  readonly plan: ActionPlan;
  readonly operations: ActionPlanV2Operation[];
  readonly bindings: Readonly<Record<string, string>>;
  readonly context: ToolContext;
}

function sealedPlan({ snapshot, record, plan, operations, bindings, context }: SealFacts): SealedPlan | ToolFailure {
  const stored = storeComposedPlan(snapshot, plan, context, { summary: record.plan.summary, bindings });
  if ("error" in stored) return stored;
  stored.record.createdAt = record.createdAt;
  delete stored.record.staged;
  stored.record.sealedAt = now(context).toISOString();
  const groups = Math.max(1, Math.ceil(operations.length / PLAN_UNDO_BATCH_SIZE));
  const job = stored.record.jobId ? jobStatus(context, stored.record.jobId) : undefined;
  const authoredBatches = (record.staged ?? []).length;
  const noteList = jsonItems(completenessNotes(operations));
  const data = objectOf({
    planId: plan.planId,
    status: stored.record.status,
    authored: operations.length,
    batches: authoredBatches,
    sealed: true,
    notes: noteList.length ? noteList : undefined,
    operationCount: operations.length,
    undoGroups: groups,
    jobId: job?.id,
    job: job && jsonOf(job),
    approvalCapability: jsonOf(stored.record.approvalCapability ?? null),
    presentation: jsonOf(stored.presentation),
    plan: jsonOf({ ...plan, operations: compactOperationEcho(operations) }),
    renamedPlaceholders: { ...bindings },
    next: sealedNext(job, groups, operations.length, authoredBatches),
  });
  return { data, operationCount: operations.length, undoGroups: groups, notes: noteList };
}

function completeProblems(plan: ActionPlan, operations: ActionPlanV2Operation[], scope: Pick<SealFacts, "snapshot" | "context">): PlanProblem[] {
  return unclaimed(planProblems(plan, operations, scope.snapshot, scope.context), operations);
}

type UnsealedPlan = ToolFailure & { readonly data: JsonObject };

function problemVerdicts(operations: readonly ActionPlanV2Operation[], problems: readonly PlanProblem[]): OperationVerdict[] {
  return problems.map((problem) => ({ index: problem.index, type: operations[problem.index]?.type ?? problem.type, status: "rejected", detail: problem.message, code: problem.code, fix: verdictFix(problem.code) }));
}

function unsealed(facts: SealFacts, first: PlanProblem, problems: PlanProblem[]): UnsealedPlan {
  const { record, plan, operations, context } = facts;
  return {
    ...toolError(first.code, planProblemMessage(plan.planId, problems)),
    data: objectOf({
      planId: plan.planId,
      status: record.status,
      authored: operations.length,
      sealed: false,
      ...jobFields(record, context),
      problems: jsonOf(problems),
      verdicts: jsonOf(problemVerdicts(operations, problems)),
      next: "Nothing was sealed. Fix the operations named above and call ae_plan_complete again; the plan keeps everything already accepted.",
    }),
  };
}

function stalePlan(record: StoredPlan, snapshot: ProjectSnapshot): ToolFailure | undefined {
  return record.plan.snapshotFingerprint === snapshot.fingerprint ? undefined : toolError("STALE_SNAPSHOT", "The project changed while this plan was being authored. Read it back with ae_recall_plan and start a new plan against the current project.");
}

function sealRefusal(plan: ActionPlan, snapshot: ProjectSnapshot, context: ToolContext): ToolFailure | undefined {
  const validation = validateActionPlan(plan, snapshot);
  if (!validation.ok) return toolError(validation.code, validation.message);
  if (!changesNothing(presentPlanRows(snapshot, plan.operations, context.hostProfile))) return undefined;
  return toolError(PLAN_NO_CHANGE, "Every value in this plan is already what it asks for, so there is nothing to apply.");
}

/** Seals the plan: the digest is computed only once the whole plan is judged, because a digest over an incomplete plan would cover something nobody approved. */
export function sealPlan(snapshot: ProjectSnapshot, planId: string, context: ToolContext): SealedPlan | ToolFailure {
  const record = authoringRecord(planId, context);
  if ("error" in record) return record;
  if (!heldOperations(record).length) return toolError("PLAN_EMPTY", "This plan has no operations yet. Add some with ae_plan_add, then complete it.");
  const stale = stalePlan(record, snapshot);
  if (stale) return stale;
  const authored = authoredFrom(record, context);
  const built = composeIncomingOperations(authored, snapshot, context, { names: vocabulary(record), canonicalAt: pinCanonicalIds(authored), forwardReferences: false });
  if ("error" in built) return built;
  const operations = built.operations.map((entry) => entry.stored);
  const plan = authoredShell({ planId: record.plan.planId, summary: record.plan.summary, createdAt: record.createdAt }, snapshot, operations, built);
  const pathProblem = planPathProblem(operations);
  if (pathProblem) return toolError(pathProblem.code, pathProblem.message);
  const problems = completeProblems(plan, operations, { snapshot, context });
  const [first] = problems;
  if (first) return unsealed({ snapshot, record, plan, operations, bindings: built.bindings, context }, first, problems);
  const ordered = orderExpressionsAfterDependencies(operations);
  plan.operations = ordered;
  plan.digest = computePlanDigest(plan);
  const refused = sealRefusal(plan, snapshot, context);
  if (refused) return refused;
  return sealedPlan({ snapshot, record, plan, operations: ordered, bindings: built.bindings, context });
}

/** Seal the plan so it can be approved. */
export function completePlan(base: ToolBase, snapshot: ProjectSnapshot, args: CompleteArgs, context: ToolContext): ToolResult {
  const sealed = sealPlan(snapshot, args.planId, context);
  return "error" in sealed ? sealed : toolSuccess(base, sealed.data);
}
