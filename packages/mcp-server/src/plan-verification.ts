// What a plan reads back about itself: verification coverage for its operation types, and the classified notices.
import { PLAN_UNDO_BATCH_SIZE } from "@extynt/host-ae";
import { planVerificationReport } from "@extynt/capability-catalogue";
import type { HostCapabilityProfile } from "@extynt/capability-catalogue";
import type { ActionPlan, ActionPlanV2Operation, PlanWarning } from "@extynt/action-plan";
import type { PlanVerificationSummary, ToolContext } from "./contracts.js";
import { readLocalHostLedger } from "./local-ledger.js";
import { effectUnitNotices, largePlanNotice, sortNotices, undoNotices, userAssistedNotices, verificationNotices } from "./notices.js";
import type { PlanNotice } from "./notices.js";
import type { Translate } from "@extynt/ui-text";
import { ENGLISH_TEXT } from "./plan-text.js";

/** The evidence a verification judges operation types against. */
export function verificationOptions(context: ToolContext) {
  return { hostKey: context.hostKey ?? null, ledger: context.ledger ?? readLocalHostLedger(), ...(context.runtimeEvidence ? { runtimeEvidence: context.runtimeEvidence } : {}) };
}

/** The verification summary for the plan's operation types, with its warnings. */
export function planVerification(plan: ActionPlan, context: ToolContext): PlanVerificationSummary & { warnings: string[] } {
  const report = planVerificationReport(plan.operations.map((operation) => operation.type), verificationOptions(context));
  return { hostKey: context.hostKey ?? null, requiresAcknowledgement: report.requiresAcknowledgement, counts: report.counts, operations: report.operations, warnings: report.warnings };
}

function rampWarningNotices(warnings: readonly PlanWarning[], translate: Translate): PlanNotice[] {
  return warnings.filter((warning) => warning.code === "RAMP_ON_SHAPE_LAYER").map((warning) => ({
    severity: "note" as const,
    code: warning.code,
    title: translate("plan.notice.rampTitle"),
    detail: warning.message.replace(`${warning.code}: `, ""),
    ...(warning.operationIndex === undefined ? {} : { operationIndexes: [warning.operationIndex] }),
  }));
}

interface NoticeInput {
  readonly operations: readonly ActionPlanV2Operation[];
  readonly verification: PlanVerificationSummary & { warnings: string[] };
  readonly profile: HostCapabilityProfile | undefined;
  readonly warnings?: readonly PlanWarning[];
  readonly jobCreatedIds?: ReadonlySet<string> | undefined;
  readonly translate?: Translate;
}

/** Everything this plan wants the reader to know; the flat `warnings` list is derived from these. */
export function planNotices({ operations, verification, profile, warnings = [], jobCreatedIds, translate = ENGLISH_TEXT }: NoticeInput): PlanNotice[] {
  const large = largePlanNotice(operations.length, PLAN_UNDO_BATCH_SIZE, translate);
  return sortNotices([
    ...verificationNotices(verification, translate),
    ...undoNotices(operations, jobCreatedIds, translate),
    ...effectUnitNotices(operations, profile, translate),
    ...userAssistedNotices(operations, profile, translate),
    ...rampWarningNotices(warnings, translate),
    ...(large ? [large] : []),
  ]);
}
