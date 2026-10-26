// Adding a batch of operations to a plan being authored; the verdicts are the product: what was kept, what was rewritten and what to fix.
import { PLAN_UNDO_BATCH_SIZE } from "@extynt/host-ae";
import type { ActionPlan, ActionPlanV2Operation } from "@extynt/action-plan";
import type { Infer, JsonArray, JsonObject } from "@extynt/decode";
import type { ProjectSnapshot } from "@extynt/project-graph";
import type { OperationVerdict } from "./batch.js";
import { acceptedVerdicts } from "./batch-verdicts.js";
import { correctionReport, correctOperations, withCorrectionRefusals } from "./compose-corrections.js";
import { composeIncomingOperations } from "./compose.js";
import type { IncomingOperation } from "./compose.js";
import type { StoredPlan, ToolContext } from "./contracts.js";
import { jsonOf } from "./json.js";
import { declaredBindings } from "./placeholders.js";
import { authoredOperations, crossOperationProblems, notYetResolvable, parentingCompensationNotes, pinCanonicalIds, resolveSettledBatchNames, submittedOperation, unresolvedReferences, vocabulary } from "./plan-coherence.js";
import { authoredShell, authoringRecord, heldOperations, MAX_AUTHORING_BATCHES } from "./plan-authoring.js";
import type { PlanSizes } from "./plan-bounds.js";
import { planProblems } from "./plan-problems.js";
import type { PlanProblem } from "./plan-problem.js";
import { batchReport } from "./plan-report.js";
import { now } from "./plan-store.js";
import type { AE_PLAN_ADD } from "./tool-specs-plan.js";
import { toolError, toolSuccess } from "./tool-result.js";
import type { ToolBase, ToolFailure, ToolResult } from "./tool-result.js";

type AddArgs = Infer<typeof AE_PLAN_ADD.input.decoder>;
type StagedBatch = { readonly data: JsonObject; readonly verdicts: OperationVerdict[]; readonly notes: string[] };

interface BatchScope {
  readonly record: StoredPlan;
  readonly snapshot: ProjectSnapshot;
  readonly context: ToolContext;
}

function batchSizeProblem(incoming: JsonArray): ToolFailure | undefined {
  if (incoming.length > 0 && incoming.length <= PLAN_UNDO_BATCH_SIZE) return undefined;
  return toolError("INVALID_ARGUMENT", `operations must contain 1–${PLAN_UNDO_BATCH_SIZE} entries per call; add the rest in another call.`);
}

function batchAdmissionProblem(record: StoredPlan, snapshot: ProjectSnapshot): ToolFailure | undefined {
  if ((record.staged ?? []).length >= MAX_AUTHORING_BATCHES) return toolError("PLAN_TOO_MANY_BATCHES", `This plan has been authored in ${MAX_AUTHORING_BATCHES} batches already. Seal it with ae_plan_complete and start another plan for the rest of the work.`);
  if (record.plan.snapshotFingerprint !== snapshot.fingerprint) return toolError("STALE_SNAPSHOT", "The project changed while this plan was being authored, so the values it was written against may no longer be what is there. Read it back with ae_recall_plan, then start a new plan against the current project.");
  return undefined;
}

interface BatchProblemScope {
  readonly plan: ActionPlan;
  readonly operations: ActionPlanV2Operation[];
  readonly accumulated: JsonArray;
  readonly prior: number;
}

function batchProblems(scope: BatchProblemScope, world: Pick<BatchScope, "snapshot" | "context">): PlanProblem[] {
  const { plan, operations, accumulated, prior } = scope;
  return planProblems(plan, operations, world.snapshot, world.context)
    .filter((problem) => problem.index >= prior)
    .map((problem) => notYetResolvable(problem, accumulated))
    .map((problem) => ({ ...problem, index: problem.index - prior }));
}

interface Composition {
  readonly submitted: JsonArray;
  readonly accumulated: JsonArray;
  readonly prior: number;
  readonly pairs: IncomingOperation[];
  readonly operations: ActionPlanV2Operation[];
  readonly sizes: PlanSizes;
  readonly verdicts: OperationVerdict[];
  readonly bindings: Readonly<Record<string, string>>;
}

function composeBatch(incoming: JsonArray, scope: BatchScope): Composition | ToolFailure {
  const { record, snapshot, context } = scope;
  const fixed = correctOperations(incoming.map(submittedOperation), snapshot, context.jobCreatedIds?.(record.jobId));
  const accumulated = resolveSettledBatchNames(structuredClone([...authoredOperations(record), ...fixed.operations]), context.settledBatchIds ?? {});
  const names = { ...vocabulary(record), ...declaredBindings(accumulated.map((operation) => ({ raw: operation, stored: operation }))) };
  const built = composeIncomingOperations(accumulated, snapshot, context, { names, canonicalAt: pinCanonicalIds(accumulated), forwardReferences: true });
  if ("error" in built) return built;
  const prior = accumulated.length - fixed.operations.length;
  const operations = built.operations.map((entry) => entry.stored);
  const sizes = { totalKeyframes: built.totalKeyframes, maxExpressionLength: built.maxExpressionLength };
  const plan = authoredShell({ planId: record.plan.planId, summary: record.plan.summary, createdAt: record.createdAt }, snapshot, operations, sizes);
  const problems = withCorrectionRefusals(batchProblems({ plan, operations, accumulated, prior }, scope), fixed.refusals);
  const pairs = built.operations.slice(prior).map((entry, offset) => ({ raw: fixed.operations[offset] ?? entry.raw, stored: entry.stored, corrections: fixed.changes[offset] ?? [] }));
  const verdicts = acceptedVerdicts({ submitted: fixed.operations, stored: pairs.map((pair) => jsonOf(pair.stored)), bindings: built.bindings, problems, corrections: fixed.changes });
  return { submitted: fixed.operations, accumulated, prior, pairs, operations, sizes, verdicts, bindings: built.bindings };
}

function refusedBatch(composition: Composition, scope: BatchScope): StagedBatch {
  const { record, snapshot, context } = scope;
  const { verdicts, submitted } = composition;
  const rejected = verdicts.filter((verdict) => verdict.status === "rejected").length;
  const accepted = submitted.length - rejected;
  const rest = accepted
    ? ` A batch is staged whole or not at all, so the ${accepted} operation${accepted === 1 ? "" : "s"} that ${accepted === 1 ? "was" : "were"} accepted ${accepted === 1 ? "is" : "are"} not in the plan either — send the whole batch again with the fix applied, not only the refused ${rejected === 1 ? "operation" : "operations"}.`
    : " Fix what the verdict names and send the batch again.";
  const held = heldOperations(record);
  const plan = authoredShell({ planId: record.plan.planId, summary: record.plan.summary, createdAt: record.createdAt }, snapshot, held, composition.sizes);
  const notes = [`Nothing was staged: ${rejected} of ${submitted.length} operation${submitted.length === 1 ? "" : "s"} in this batch cannot be accepted, and the plan still holds ${held.length} operation${held.length === 1 ? "" : "s"}.${rest}`];
  return { data: batchReport({ record, plan, verdicts, notes, context, snapshot }), verdicts, notes };
}

function interactionNotes(operations: readonly ActionPlanV2Operation[], plan: ActionPlan, prior: number): string[] {
  const unresolved = unresolvedReferences(plan);
  const unresolvedNote = unresolved.length ? [`Accepted, and not yet resolvable — which is not an error at this stage: ${unresolved.join("; ")}. Add the operations that create them, then ae_plan_complete judges the whole plan.`] : [];
  const interactions = [
    ...crossOperationProblems(operations).filter((problem) => problem.index >= prior).map((problem) => `Noted now and decided at complete — it is not a refusal and the batch was accepted: ${problem.message}`),
    ...parentingCompensationNotes(operations).filter((note) => Math.max(...note.operationIndexes) >= prior).map((note) => note.message),
  ];
  return [...unresolvedNote, ...interactions];
}

function acceptedBatch(composition: Composition, scope: BatchScope): StagedBatch {
  const { record, snapshot, context } = scope;
  const { pairs, operations, sizes, verdicts, prior } = composition;
  const batches = record.staged ?? [];
  batches.push({ batch: batches.length + 1, operations: pairs.map((pair) => pair.stored), authored: pairs.map((pair) => pair.raw) });
  record.staged = batches;
  record.placeholderBindings = { ...(record.placeholderBindings ?? {}), ...declaredBindings(pairs) };
  record.updatedAt = now(context).toISOString();
  const plan = authoredShell({ planId: record.plan.planId, summary: record.plan.summary, createdAt: record.createdAt }, snapshot, operations, sizes);
  record.plan = plan;
  const notes = [...correctionReport(pairs).notes, ...interactionNotes(operations, plan, prior)];
  return { data: batchReport({ record, plan, verdicts, notes, context, snapshot }), verdicts, notes };
}

/** Takes the batch into the plan whole, or refuses it whole: the staged batch carries the verdict of every operation either way. */
export function stageBatch(snapshot: ProjectSnapshot, call: { readonly planId: string; readonly operations: JsonArray }, context: ToolContext): StagedBatch | ToolFailure {
  const record = authoringRecord(call.planId, context);
  if ("error" in record) return record;
  const incoming = call.operations;
  const problem = batchSizeProblem(incoming) ?? batchAdmissionProblem(record, snapshot);
  if (problem) return problem;
  const scope = { record, snapshot, context };
  const composition = composeBatch(incoming, scope);
  if ("error" in composition) return composition;
  return composition.verdicts.some((verdict) => verdict.status === "rejected") ? refusedBatch(composition, scope) : acceptedBatch(composition, scope);
}

/** Add operations to a plan the sidecar owns. */
export function addToPlan(base: ToolBase, snapshot: ProjectSnapshot, args: AddArgs, context: ToolContext): ToolResult {
  const staged = stageBatch(snapshot, args, context);
  return "error" in staged ? staged : toolSuccess(base, staged.data);
}
