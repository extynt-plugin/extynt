// Where composed plans are held: ids, the clock, storing a draft or a prepared plan, and the card a prepared plan carries.
import { issueApproval, validateActionPlan } from "@extynt/action-plan";
import type { ActionPlan, ActionPlanV2Operation, V2TargetReference } from "@extynt/action-plan";
import type { ProjectSnapshot } from "@extynt/project-graph";
import { AGENT_APPROVAL_TTL_MS } from "./core-constants.js";
import type { PlanPresentation, PlanShown, StoredPlan, ToolContext } from "./contracts.js";
import { jsonOf } from "./json.js";
import { noticesToWarnings } from "./notices.js";
import { composedOperations } from "./operations.js";
import { describeTargetLayer, newObjectNames, presentationExpressions } from "./plan-card-lines.js";
import { planNotHeld } from "./plan-lost.js";
import { planNotices, planVerification } from "./plan-verification.js";
import { planCardTitle } from "./plan-row-title.js";
import { presentPlanRows, type PlanValueRow } from "./plan-rows.js";
import { toolError } from "./tool-result.js";
import type { ToolFailure } from "./tool-result.js";

type StoredComposition = { record: StoredPlan; presentation: PlanPresentation };

/** An id for a job: opaque, so no part of a job's meaning is inferred from a summary, a time window or a fingerprint. */
export function mintJobId(): string {
  return `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** An id for a plan: opaque and unique within a session; the prefix says which path made it. */
export function newPlanId(prefix = "plan"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** The context's clock. */
export function now(context: ToolContext): Date {
  return context.now?.() ?? new Date();
}

/** The plan the id names, or the refusal that says why it is not held. */
export function getPlan(planId: string, context: ToolContext): StoredPlan | ToolFailure {
  if (!planId) return toolError("INVALID_ARGUMENT", "planId is required.");
  return context.plans?.get(planId) ?? planNotHeld(planId, context);
}

function placeholderBindingsOf(bindings: Readonly<Record<string, string>>): Pick<StoredPlan, "placeholderBindings"> {
  return Object.keys(bindings).length ? { placeholderBindings: { ...bindings } } : {};
}

/** A refused plan is kept, not thrown away: it is what the model repairs. */
export function storeDraftPlan(plan: ActionPlan, context: ToolContext, bindings: Readonly<Record<string, string>> = {}): void {
  const existing = context.plans?.get(plan.planId);
  const at = now(context).toISOString();
  context.plans?.set(plan.planId, {
    plan,
    status: "draft",
    jobId: existing?.jobId ?? mintJobId(),
    createdAt: at,
    updatedAt: at,
    ...(existing?.staged ? { staged: existing.staged } : {}),
    ...placeholderBindingsOf(bindings),
  });
}

function firstLayerTarget(operations: readonly ActionPlanV2Operation[]): V2TargetReference | undefined {
  return operations.flatMap((operation) => ("target" in operation && "layerId" in operation.target ? [operation.target] : [])).at(0);
}

function jobCreatedIdsOf(plan: ActionPlan, context: ToolContext): ReadonlySet<string> | undefined {
  return context.jobCreatedIds?.(context.plans?.get(plan.planId)?.jobId);
}

type CardParts = { snapshot: ProjectSnapshot; plan: ActionPlan; summary: string; context: ToolContext };

function shownCard({ snapshot, plan, summary, context }: CardParts, rows: readonly PlanValueRow[]): { shown: PlanShown } | Record<string, never> {
  const { translate } = context;
  if (!translate) return {};
  const operations = composedOperations(plan);
  const validation = validateActionPlan(plan, snapshot);
  const shownRows = presentPlanRows(snapshot, operations, context.hostProfile, translate);
  const notices = planNotices({ operations, verification: planVerification(plan, context), profile: context.hostProfile, warnings: validation.ok ? validation.warnings : [], jobCreatedIds: jobCreatedIdsOf(plan, context), translate });
  return { shown: { title: planCardTitle(summary, shownRows, translate, rows), values: shownRows.map((row) => ({ ...row, before: jsonOf(row.before), after: jsonOf(row.after) })), notices, warnings: noticesToWarnings(notices) } };
}

function cardFor(snapshot: ProjectSnapshot, plan: ActionPlan, summary: string, context: ToolContext): PlanPresentation {
  const operations = composedOperations(plan);
  const first = firstLayerTarget(operations);
  const verification = planVerification(plan, context);
  const validation = validateActionPlan(plan, snapshot);
  const rows = presentPlanRows(snapshot, operations, context.hostProfile);
  const notices = planNotices({ operations, verification, profile: context.hostProfile, warnings: validation.ok ? validation.warnings : [], jobCreatedIds: jobCreatedIdsOf(plan, context) });
  return {
    ...shownCard({ snapshot, plan, summary, context }, rows),
    title: planCardTitle(summary, rows),
    target: first ? { compositionId: first.compositionId, layerId: first.layerId, layerName: describeTargetLayer(snapshot, first, newObjectNames(operations)) } : { compositionId: "", layerId: "", layerName: "New composition" },
    effect: { action: "Composed", name: `${operations.length} operation(s)`, amount: null, controlPath: "" },
    motion: { property: "Multiple", from: null, to: null, durationSeconds: 0 },
    values: rows.map((row) => ({ ...row, before: jsonOf(row.before), after: jsonOf(row.after) })),
    expressions: presentationExpressions(operations),
    notices,
    warnings: noticesToWarnings(notices),
    verification: { hostKey: verification.hostKey, requiresAcknowledgement: verification.requiresAcknowledgement, counts: verification.counts, operations: verification.operations },
    approvalRequired: true,
    actions: { approve: "ae_approve_plan", cancel: "ae_cancel_plan" },
  };
}

/** Stores a plan as prepared for approval, with the capability the approval needs when a panel is connected. */
export function storeComposedPlan(snapshot: ProjectSnapshot, plan: ActionPlan, context: ToolContext, { summary, bindings = {} }: { readonly summary: string; readonly bindings?: Readonly<Record<string, string>> }): StoredComposition | ToolFailure {
  const presentation = cardFor(snapshot, plan, summary, context);
  const at = now(context).toISOString();
  const record: StoredPlan = {
    plan,
    status: "prepared",
    jobId: context.plans?.get(plan.planId)?.jobId ?? mintJobId(),
    presentation,
    createdAt: at,
    updatedAt: at,
    ...placeholderBindingsOf(bindings),
  };
  if (context.panelSessionId) {
    const capability = issueApproval({ plan, snapshot, panelSessionId: context.panelSessionId, now: at, ttlMs: AGENT_APPROVAL_TTL_MS });
    if (!("token" in capability)) return toolError(capability.code, capability.message);
    record.approvalCapability = capability;
  }
  context.plans?.set(plan.planId, record);
  return { record, presentation };
}
