// Composing a plan is where placeholder binding, text normalization and the declared bounds meet.
import { computePlanDigest, MAX_EXPRESSION_LENGTH, validateActionPlan } from "@extynt/action-plan";
import type { ActionPlan, ActionPlanV2Operation, ApprovalCapability } from "@extynt/action-plan";
import type { ProjectSnapshot } from "@extynt/project-graph";
import type { PlanPresentation, StoredPlan, ToolContext } from "./contracts.js";
import type { OperationChange } from "./batch.js";
import { compactOperationEcho } from "./operation-echo.js";
import { normalizeTextLineBreaks } from "./operation-fields.js";
import { planPathProblem } from "./path-policy.js";
import { expressionSources } from "./plan-bounds.js";
import { newPlanId, storeComposedPlan } from "./plan-store.js";
import { toolError } from "./tool-result.js";
import type { ToolFailure } from "./tool-result.js";
import type { JsonArray, JsonObject, JsonValue } from "@extynt/decode";
import { composedOperations } from "./operations.js";
import { orderExpressionsAfterDependencies } from "./plan-expression-order.js";
import { planProblems } from "./plan-problems.js";
import { declaredBindings } from "./placeholders.js";
import { beginComposePass, refusal } from "./compose-pass.js";
import type { ComposePass, ComposeSeed, Resolved } from "./compose-pass.js";
import { dispatchOperation } from "./compose-families.js";
import { correctionReport, correctOperations, withCorrectionRefusals } from "./compose-corrections.js";
import type { OperationRefusal } from "./compose-corrections.js";
import { buildComposedPlan, openSiblingPlans, problemRefusal, proposalRequest, unactedEquivalent } from "./compose-proposal.js";
import type { PlanProblemRefusal, SiblingPlans } from "./compose-proposal.js";
import { fieldsOf } from "./operation-fields.js";

/** `raw` is the caller's operation after deterministic corrections (what the plan records as authored); `corrections` lists what was fixed. */
export interface IncomingOperation {
  raw: JsonValue;
  stored: ActionPlanV2Operation;
  corrections?: OperationChange[];
}

interface ComposedBatch {
  ok: true;
  operations: IncomingOperation[];
  bindings: Record<string, string>;
  totalKeyframes: number;
  maxExpressionLength: number;
  refusals: OperationRefusal[];
}

function boundedExpressionLength(sources: ReadonlyArray<JsonValue | undefined>, current: number): Resolved<number> {
  let maxLength = current;
  for (const source of sources) {
    if (source === undefined) continue;
    if (typeof source !== "string" || source.length > MAX_EXPRESSION_LENGTH) return refusal("INVALID_ARGUMENT", `Expression source must be a string of at most ${MAX_EXPRESSION_LENGTH} characters.`);
    maxLength = Math.max(maxLength, source.length);
  }
  return { ok: true, value: maxLength };
}

function composeOne(pass: ComposePass, raw: JsonValue, index: number): ToolFailure | undefined {
  const candidate = fieldsOf(raw);
  if (!candidate) return toolError("INVALID_ARGUMENT", "Each operation must be an object.");
  normalizeTextLineBreaks(candidate);
  const expressions = boundedExpressionLength(expressionSources(candidate), pass.maxExpressionLength);
  if (!expressions.ok) return toolError(expressions.refusal.code, expressions.refusal.message);
  pass.maxExpressionLength = expressions.value;
  const outcome = dispatchOperation(pass, candidate, index);
  return outcome.kind === "error" ? toolError(outcome.error.code, outcome.error.message) : undefined;
}

function walkOperations(pass: ComposePass, operations: readonly JsonValue[]): ToolFailure | undefined {
  for (const [index, raw] of operations.entries()) {
    const failure = composeOne(pass, raw, index);
    if (failure) return failure;
  }
  return undefined;
}

/** Composes a caller's raw operations against a snapshot: binds every declared placeholder, normalizes
 *  text, bounds the expressions and hands each operation to the family that owns it. */
export function composeIncomingOperations(rawOperations: JsonArray, snapshot: ProjectSnapshot, context: ToolContext, seed: ComposeSeed = {}): ComposedBatch | ToolFailure {
  const corrected = correctOperations(rawOperations, snapshot, context.jobCreatedIds?.(seed.jobId));
  const authored = corrected.operations.map((operation) => structuredClone(operation));
  const pass = beginComposePass(corrected.operations, snapshot, seed);
  const failure = walkOperations(pass, corrected.operations);
  if (failure) return failure;
  const pairs = pass.operations.map((stored, index) => ({ raw: authored[index] ?? null, stored, corrections: corrected.changes[index] ?? [] }));
  return { ok: true, operations: pairs, bindings: { ...seed.names, ...declaredBindings(pairs) }, totalKeyframes: pass.totalKeyframes, maxExpressionLength: pass.maxExpressionLength, refusals: corrected.refusals };
}

type ProposalBase = {
  ok: true;
  tool: string;
  snapshotFingerprint: string;
};

type ProposalData = {
  planId: string;
  status: string;
  plan: ActionPlan;
  presentation: PlanPresentation;
  renamedPlaceholders: Record<string, string>;
  approvalCapability: ApprovalCapability | null;
  submittedOperations: JsonArray;
  bindings: Record<string, string>;
  reused?: true;
  corrected?: number;
  notes?: string[];
  otherWaitingPlans?: SiblingPlans;
};

type ProposalResult = (ProposalBase & { data: ProposalData }) | ToolFailure | PlanProblemRefusal;

type CorrectionReport = ReturnType<typeof correctionReport>;

function correctionFields(report: CorrectionReport): { corrected?: number; notes?: string[] } {
  return report.corrected ? { corrected: report.corrected, notes: report.notes } : {};
}

function reusedProposal(base: ProposalBase, prior: StoredPlan, submitted: JsonArray, report: CorrectionReport): ProposalResult | undefined {
  if (!prior.presentation) return undefined;
  const bindings = { ...prior.placeholderBindings };
  const plan = { ...prior.plan, operations: compactOperationEcho(composedOperations(prior.plan)) };
  return {
    ...base,
    data: {
      planId: prior.plan.planId, status: prior.status, plan, presentation: prior.presentation, renamedPlaceholders: bindings, submittedOperations: submitted,
      bindings, approvalCapability: prior.approvalCapability ?? null, reused: true, ...correctionFields(report),
    },
  };
}

function waitingPlans(plan: ActionPlan, context: ToolContext, retainDraft: boolean): { otherWaitingPlans?: SiblingPlans } {
  const waiting = retainDraft ? openSiblingPlans(plan, context) : undefined;
  return waiting ? { otherWaitingPlans: waiting } : {};
}

interface ProposalScope {
  snapshot: ProjectSnapshot;
  context: ToolContext;
  retainDraft: boolean;
}

interface ProposalInput extends ProposalScope {
  summary: string;
  submitted: JsonArray;
}

function refusedProblems(plan: ActionPlan, batch: ComposedBatch, scope: ProposalScope): PlanProblemRefusal | undefined {
  const stored = batch.operations.map((entry) => entry.stored);
  const problems = withCorrectionRefusals(planProblems(plan, stored, scope.snapshot, scope.context), batch.refusals);
  const [first] = problems;
  if (!first) return undefined;
  return problemRefusal({ plan, first, problems, bindings: batch.bindings, snapshot: scope.snapshot, context: scope.context, retainDraft: scope.retainDraft });
}

function orderedOperations(plan: ActionPlan, snapshot: ProjectSnapshot): ActionPlanV2Operation[] | ToolFailure {
  const ordered = orderExpressionsAfterDependencies(composedOperations(plan));
  plan.operations = ordered;
  plan.digest = computePlanDigest(plan);
  const validation = validateActionPlan(plan, snapshot);
  return validation.ok ? ordered : toolError(validation.code, validation.message);
}

function storedProposal(base: ProposalBase, plan: ActionPlan, batch: ComposedBatch, scope: ProposalInput): ProposalResult {
  const stored = storeComposedPlan(scope.snapshot, plan, scope.context, { summary: scope.summary, bindings: batch.bindings });
  if ("error" in stored) return stored;
  const { record, presentation } = stored;
  return {
    ...base,
    data: {
      planId: plan.planId, status: record.status, plan: { ...plan, operations: compactOperationEcho(composedOperations(plan)) }, presentation, renamedPlaceholders: batch.bindings,
      submittedOperations: scope.submitted, bindings: batch.bindings, approvalCapability: record.approvalCapability ?? null,
      ...waitingPlans(plan, scope.context, scope.retainDraft), ...correctionFields(correctionReport(batch.operations)),
    },
  };
}

function finishedProposal(base: ProposalBase, plan: ActionPlan, batch: ComposedBatch, scope: ProposalInput): ProposalResult {
  const prior = scope.retainDraft ? unactedEquivalent(plan, scope.context) : undefined;
  const reused = prior ? reusedProposal(base, prior, scope.submitted, correctionReport(batch.operations)) : undefined;
  return reused ?? storedProposal(base, plan, batch, scope);
}

/** The composer every whole-plan tool calls. `retainDraft` is the one behavioral difference between
 *  callers: a refused whole-plan call keeps its draft because that draft is what `ae_amend_plan`
 *  edits, while a refused incremental step is sent again and would only litter the plan store. */
export function composeProposal(base: ProposalBase, snapshot: ProjectSnapshot, call: { args: JsonObject; limit: number; retainDraft: boolean }, context: ToolContext): ProposalResult {
  const request = proposalRequest(call.args, call.limit);
  if (!request.ok) return toolError(request.refusal.code, request.refusal.message);
  const batch = composeIncomingOperations(request.value.rawOperations, snapshot, context);
  if (!batch.ok) return batch;
  const pathProblem = planPathProblem(batch.operations.map((entry) => entry.stored));
  if (pathProblem) return toolError(pathProblem.code, pathProblem.message);
  const scope = { snapshot, context, retainDraft: call.retainDraft };
  const plan = buildComposedPlan({ planId: newPlanId(), summary: request.value.summary, snapshot, operations: batch.operations, totalKeyframes: batch.totalKeyframes, maxExpressionLength: batch.maxExpressionLength, context });
  const refused = refusedProblems(plan, batch, scope);
  if (refused) return refused;
  const ordered = orderedOperations(plan, snapshot);
  if (!Array.isArray(ordered)) return ordered;
  return finishedProposal(base, plan, batch, { ...scope, summary: request.value.summary, submitted: request.value.rawOperations });
}
