// How the verdicts of a plan become the receipt's outcome: the summary of every step, the postcondition it implies, and the repair packet naming what failed.
import { boundedValueText } from "./value-text.js";
import type { Detail, VerifiedStep } from "./verdicts.js";

const MAX_REPAIR_ENTRIES = 8;
const FIELD_NAMES = ["field", "option", "setting", "attribute", "propertyPath"];
const EXPECTED_NAMES = ["expectedValue", "expectedKeys", "expectedDigest"];
const OBSERVED_NAMES = ["observedValue", "observedEnabled", "observedKeys", "observedDigest", "mismatches"];

interface VerificationSummary {
  readonly allObserved: boolean;
  readonly anyUnverified: boolean;
  readonly anyFailed: boolean;
  readonly anyExpressionMotionUnverified: boolean;
  readonly allVerified: boolean;
}

interface RepairEntry {
  readonly index: number;
  readonly operation: string;
  readonly basis: string;
  readonly field?: string;
  readonly expected?: string;
  readonly observed?: string;
  readonly compositionId?: string;
  readonly layerId?: string;
}

/** The failed steps of a receipt, at most eight, with the total. */
export interface RepairPacket {
  readonly failedCount: number;
  readonly operations: ReadonlyArray<RepairEntry>;
}

/** Adds up the verdicts of a plan, one per operation. */
export function summarizeVerification(steps: ReadonlyArray<VerifiedStep>): VerificationSummary {
  const allObserved = steps.every((step) => step.observed);
  const anyExpressionMotionUnverified = steps.some((step) => step.expressionMotionUnverified === true);
  return {
    allObserved,
    anyUnverified: steps.some((step) => step.verificationState === "applied_unverified"),
    anyFailed: steps.some((step) => step.verificationState === "failed"),
    anyExpressionMotionUnverified,
    allVerified: allObserved && !anyExpressionMotionUnverified,
  };
}

/** The postcondition a verification implies: unavailable, passed, applied but unverified, or failed. */
export function postconditionOf(readOk: boolean, summary: VerificationSummary): string {
  if (!readOk) return "verification_unavailable";
  if (summary.anyFailed) return "failed";
  if (summary.allVerified) return "passed";
  return summary.anyUnverified || summary.anyExpressionMotionUnverified ? "applied_unverified" : "failed";
}

function firstDefined(step: VerifiedStep, names: ReadonlyArray<string>): Detail {
  const name = names.find((candidate) => step[candidate] !== undefined);
  return name === undefined ? undefined : step[name];
}

function textField(step: VerifiedStep, name: string): { readonly [key: string]: string } {
  const value = step[name];
  return typeof value === "string" ? { [name]: value.slice(0, 64) } : {};
}

function repairEntryFor(step: VerifiedStep, index: number): RepairEntry {
  const field = firstDefined(step, FIELD_NAMES);
  const expected = boundedValueText(firstDefined(step, EXPECTED_NAMES));
  const observed = boundedValueText(firstDefined(step, OBSERVED_NAMES));
  return {
    index,
    operation: (step.operation || "unknown").slice(0, 64),
    basis: (step.basis || "unknown").slice(0, 96),
    ...(field === undefined || field === null ? {} : { field: String(field).slice(0, 160) }),
    ...(expected === null ? {} : { expected }),
    ...(observed === null ? {} : { observed }),
    ...textField(step, "compositionId"),
    ...textField(step, "layerId"),
  };
}

/** The packet of failed steps, or null when none failed. */
export function repairPacket(steps: ReadonlyArray<VerifiedStep>): RepairPacket | null {
  const failed = steps.flatMap((step, index) => (step.verificationState === "failed" ? [repairEntryFor(step, index)] : []));
  return failed.length > 0 ? { failedCount: failed.length, operations: failed.slice(0, MAX_REPAIR_ENTRIES) } : null;
}
