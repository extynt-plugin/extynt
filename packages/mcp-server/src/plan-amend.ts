// Amending a plan by index: the edits apply in the order given, the plan is re-measured, re-checked and stored again.
import { computePlanDigest, validateActionPlan } from "@extynt/action-plan";
import type { ActionPlan, ActionPlanV2Operation } from "@extynt/action-plan";
import type { Infer, JsonArray, JsonValue } from "@extynt/decode";
import type { ProjectSnapshot } from "@extynt/project-graph";
import type { StoredPlan, ToolContext } from "./contracts.js";
import { asObject, jsonItems, jsonOf, objectAt, objectOf } from "./json.js";
import { composedOperations, operationJson, operationOf } from "./operations.js";
import { planPathProblem } from "./path-policy.js";
import { authoredOperations } from "./plan-coherence.js";
import { boundsFor } from "./plan-bounds.js";
import { applyEdits } from "./plan-edit.js";
import type { EditState } from "./plan-edit.js";
import { keyframeTimeBound } from "./plan-bounds.js";
import { planProblemMessage, planProblems } from "./plan-problems.js";
import { getPlan, storeComposedPlan, storeDraftPlan } from "./plan-store.js";
import type { AE_AMEND_PLAN } from "./tool-specs-plan.js";
import { toolError } from "./tool-result.js";
import type { ToolBase, ToolFailure, ToolResult } from "./tool-result.js";

type AmendArgs = Infer<typeof AE_AMEND_PLAN.input.decoder>;

const MAX_AMENDED_SUMMARY_CHARS = 512;

function amendmentGate(record: StoredPlan): ToolFailure | undefined {
  if (record.variantSetId) return toolError("VARIANT_PLAN_FIXED", "This plan is an option the user was shown with its value; changing it would apply something other than what they chose between. Offer a new set of options instead.");
  if (record.status === "approved" || record.status === "applying") return toolError("PLAN_ALREADY_APPROVED", "This plan is approved and queued to apply; cancel it before changing it.");
  if (record.status !== "draft" && record.status !== "prepared" && record.status !== "presented") return toolError("PLAN_NOT_EDITABLE", `A plan in state ${record.status} cannot be edited. Propose a new one instead.`);
  return undefined;
}

function amendedPlan(previous: ActionPlan, summary: string, operations: ActionPlanV2Operation[], snapshot: ProjectSnapshot): ActionPlan {
  const measured = boundsFor(operations);
  const plan: ActionPlan = {
    ...previous,
    summary,
    operations,
    bounds: {
      maxOperations: operations.length,
      maxKeyframes: Math.max(1, measured.totalKeyframes),
      maxKeyframeTimeSeconds: keyframeTimeBound(snapshot, operations),
      maxExpressionLength: Math.max(1, measured.maxExpressionLength),
    },
    digest: "",
  };
  plan.digest = computePlanDigest(plan);
  return plan;
}

function rebasedOperation(operation: ActionPlanV2Operation, snapshot: ProjectSnapshot): ActionPlanV2Operation {
  const written = operationJson(operation);
  const target = objectAt(written, "target");
  const rebased = target && operationOf({ ...written, target: { ...target, snapshotFingerprint: snapshot.fingerprint, selectionFingerprint: snapshot.selectionFingerprint } });
  return rebased ?? operation;
}

function inAuthoring(record: StoredPlan, snapshot: ProjectSnapshot): boolean {
  return record.staged !== undefined && record.plan.snapshotFingerprint === snapshot.fingerprint && record.plan.selectionFingerprint !== snapshot.selectionFingerprint;
}

function amendmentBasis(record: StoredPlan, snapshot: ProjectSnapshot): { basis: ActionPlan; operations: ActionPlanV2Operation[] } {
  const operations = composedOperations(record.plan);
  if (!inAuthoring(record, snapshot)) return { basis: record.plan, operations };
  return { basis: { ...record.plan, selectionFingerprint: snapshot.selectionFingerprint, freshness: snapshot.freshness }, operations: operations.map((operation) => rebasedOperation(operation, snapshot)) };
}

function authoredSpelling(record: StoredPlan, operations: readonly ActionPlanV2Operation[]): JsonValue[] {
  const previous = authoredOperations(record).map((operation) => structuredClone(operation));
  return previous.length === operations.length ? previous : [...jsonItems(operations)];
}

interface Amendment {
  readonly base: ToolBase;
  readonly snapshot: ProjectSnapshot;
  readonly context: ToolContext;
  readonly record: StoredPlan;
  readonly plan: ActionPlan;
  readonly state: EditState;
  readonly bindings: Readonly<Record<string, string>>;
  readonly editedIndexes: ReadonlyArray<JsonValue>;
  readonly summary: string;
}

function commitAmendment(amendment: Amendment): ToolResult {
  const { base, snapshot, context, record, plan, state, bindings, summary } = amendment;
  const problems = planProblems(plan, state.operations, snapshot, context);
  const [first] = problems;
  if (first) {
    storeDraftPlan(plan, context, bindings);
    return toolError(first.code, planProblemMessage(plan.planId, problems));
  }
  const validation = validateActionPlan(plan, snapshot);
  if (!validation.ok) return toolError(validation.code, validation.message);
  const stored = storeComposedPlan(snapshot, plan, context, { summary, bindings });
  if ("error" in stored) return stored;
  const { record: amended, presentation } = stored;
  amended.createdAt = record.createdAt;
  if (record.staged) amended.staged = [{ batch: 1, operations: [...state.operations], authored: state.authored }];
  const data = objectOf({ planId: plan.planId, status: amended.status, amended: true, operationCount: state.operations.length, editedIndexes: amendment.editedIndexes, presentation: jsonOf(presentation), approvalCapability: jsonOf(amended.approvalCapability ?? null) });
  return { ok: true, tool: base.tool, snapshotFingerprint: base.snapshotFingerprint, data };
}

interface PreparedEdits {
  readonly basis: ActionPlan;
  readonly state: EditState;
  readonly bindings: Readonly<Record<string, string>>;
  readonly edits: JsonArray;
}

function prepareEdits(record: StoredPlan, edits: JsonArray, snapshot: ProjectSnapshot): ToolFailure | PreparedEdits {
  const gate = amendmentGate(record);
  if (gate) return gate;
  if (!edits.length) return toolError("INVALID_ARGUMENT", "edits must be a non-empty array of {op, index, operation} changes.");
  const { basis, operations } = amendmentBasis(record, snapshot);
  const bindings = record.placeholderBindings ?? {};
  const state: EditState = { operations, authored: authoredSpelling(record, operations) };
  const failure = applyEdits(state, edits, { snapshot, bindings });
  if (failure) return failure;
  if (!operations.length) return toolError("INVALID_ARGUMENT", "That leaves the plan with no operations. Cancel it instead, or keep at least one.");
  return { basis, state, bindings, edits };
}

/** The edits as the plain objects the edit engine reads. */
export function editsJson(edits: AmendArgs["edits"]): JsonArray {
  return edits.map((edit) => objectOf({ op: edit.op, index: edit.index, operation: edit.operation }));
}

interface AmendmentRequest {
  readonly planId: string;
  readonly summary?: string | undefined;
  readonly edits: JsonArray;
}

/** Amending a plan by index: edits apply in the order given, each index addressing the plan as the previous edits left it. */
export function amendPlanEdits(base: ToolBase, call: AmendmentRequest, context: ToolContext): ToolResult {
  const snapshot = context.snapshot;
  if (!snapshot) return toolError("NO_SNAPSHOT", "No project snapshot is available; refresh the panel and try again.");
  const record = getPlan(call.planId, context);
  if ("error" in record) return record;
  const prepared = prepareEdits(record, call.edits, snapshot);
  if ("ok" in prepared) return prepared;
  const { basis, state, bindings, edits } = prepared;
  const summary = call.summary?.slice(0, MAX_AMENDED_SUMMARY_CHARS) || record.plan.summary;
  const plan = amendedPlan(basis, summary, state.operations, snapshot);
  const pathProblem = planPathProblem(state.operations);
  if (pathProblem) return toolError(pathProblem.code, pathProblem.message);
  return commitAmendment({ base, snapshot, context, record, plan, state, bindings, editedIndexes: edits.map((edit) => Number(asObject(edit)?.index)), summary });
}

/** Amending a plan by index, as the tool is called. */
export function amendPlan(base: ToolBase, args: AmendArgs, context: ToolContext): ToolResult {
  return amendPlanEdits(base, { planId: args.planId, summary: args.summary, edits: editsJson(args.edits) }, context);
}
