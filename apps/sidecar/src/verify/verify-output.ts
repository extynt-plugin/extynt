// Verdicts for render output settings and project cleanup: what After Effects refused or adjusted is named per field, and each item a cleanup reports removed must be absent from the fresh read.
import { boolean, decode, fallback, jsonValue, object, optional, skippingInvalid, string } from "@extynt/decode";
import type { Infer, JsonObject } from "@extynt/decode";
import { findById } from "./snapshot-index.js";
import type { HostStep } from "./host-step.js";
import type { VerifyContext } from "./verify-context.js";
import { failedStep, unverifiedStep } from "./verdicts.js";
import type { Details, VerifiedStep } from "./verdicts.js";

const REFUSAL_DETAIL_LENGTH = 600;

const settingReport = object({ field: optional(fallback(string(), undefined)), status: optional(fallback(string(), undefined)), key: optional(fallback(jsonValue, undefined)), requested: optional(fallback(jsonValue, undefined)), detail: optional(fallback(string(), undefined)) });
const renderEvidence = object({ settings: optional(fallback(skippingInvalid(settingReport), undefined)) });
const cleanupEvidence = object({
  removed: optional(fallback(skippingInvalid(object({ id: optional(fallback(string(), undefined)) })), undefined)),
  removedCount: optional(fallback(jsonValue, undefined)),
  hostReportedCount: optional(fallback(jsonValue, undefined)),
  removedTruncated: optional(fallback(boolean(), undefined)),
});

type SettingReport = Infer<typeof settingReport>;

function reportsWith(reports: ReadonlyArray<SettingReport>, status: string): ReadonlyArray<SettingReport> {
  return reports.filter((report) => report.status === status);
}

function refusal(report: SettingReport): JsonObject {
  return { field: report.field ?? "", key: report.key ?? null, requested: report.requested ?? null, detail: report.detail?.slice(0, REFUSAL_DETAIL_LENGTH) ?? null };
}

/** A refused setting fails the step; an adjusted one is reported as applied but unverified; null means nothing to say. */
export function verifyRenderSettings(kind: string, step: HostStep, compositionId: string | null): VerifiedStep | null {
  const decoded = decode(renderEvidence, step.row);
  const reports = decoded.ok ? (decoded.value.settings ?? []) : [];
  const refused = reportsWith(reports, "refused");
  if (refused.length > 0) return failedStep(kind, "render-settings-refused", { compositionId, fields: refused.map((report) => report.field ?? ""), refused: refused.map(refusal) });
  const adjusted = reportsWith(reports, "adjusted");
  if (adjusted.length === 0) return null;
  return unverifiedStep(kind, "render-settings-adjusted", { compositionId, fields: adjusted.map((report) => report.field ?? ""), settings: step.row.settings });
}

function removedStillPresent(ctx: VerifyContext, removed: ReadonlyArray<{ readonly id?: string | undefined }>): string[] {
  return removed.flatMap((entry) => (entry.id !== undefined && findById(ctx.items, entry.id) ? [entry.id] : []));
}

function cleanupBasis(ctx: VerifyContext, evidence: Infer<typeof cleanupEvidence>): string {
  return ctx.snapshotTruncated || evidence.removedTruncated === true ? "cleanup-list-truncated" : "project-cleanup-host-diff";
}

function cleanupDetails(step: HostStep, evidence: Infer<typeof cleanupEvidence>): Details {
  return { mode: step.mode ?? null, removedCount: evidence.removedCount ?? null, hostReportedCount: evidence.hostReportedCount ?? null, hostVerification: step.verification ?? null };
}

/** Every item the host lists as removed must be gone from the read taken after the plan. */
export function verifyProjectCleanup(kind: string, step: HostStep, ctx: VerifyContext): VerifiedStep {
  const decoded = decode(cleanupEvidence, step.row);
  const evidence = decoded.ok ? decoded.value : {};
  const stillPresent = removedStillPresent(ctx, evidence.removed ?? []);
  if (stillPresent.length > 0) return failedStep(kind, "cleanup-item-still-present", { itemIds: stillPresent });
  return unverifiedStep(kind, cleanupBasis(ctx, evidence), cleanupDetails(step, evidence));
}
