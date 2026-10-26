/** A failed read-back that a later operation of the same plan explains is reclassified as superseded rather than failed. */
import { laterInterference } from "./later-operations.js";
import type { ReadBackKind } from "./later-operations.js";
import type { VerifyContext } from "./verify-context.js";
import { unverifiedStep } from "./verdicts.js";
import type { VerifiedStep } from "./verdicts.js";

const FAILED_READBACK = /(mismatch|missing)$/;
const KEY_BASIS = /^(keyframe|shape-key)/;
const MISSING_BASIS = /missing$/;

function readBackKind(basis: string): ReadBackKind {
  if (KEY_BASIS.test(basis)) return "keys";
  return MISSING_BASIS.test(basis) ? "missing" : "value";
}

function canBeSuperseded(verified: VerifiedStep): boolean {
  return verified.verificationState === "failed" && FAILED_READBACK.test(verified.basis) && verified.parentOperationIndex === undefined;
}

function supersededStep(ctx: VerifyContext, index: number, verified: VerifiedStep): VerifiedStep {
  const operation = ctx.requests[index];
  if (!operation || !canBeSuperseded(verified)) return verified;
  const later = laterInterference(ctx.requests, index, readBackKind(verified.basis));
  if (!later) return verified;
  const reason = `operation ${later.index} (${later.operation}) of this plan changed this target afterwards, so the final project cannot confirm or contradict this step`;
  return unverifiedStep(operation.operation, "superseded-by-later-operation", {
    compositionId: verified.compositionId,
    layerId: verified.layerId,
    propertyPath: verified.propertyPath,
    readBackBasis: verified.basis,
    laterOperationIndex: later.index,
    laterOperation: later.operation,
    reason,
  });
}

/** A failed read-back that a later operation of the same plan explains is not a failure of the earlier write: the final snapshot holds the later state. */
export function supersededFailures(ctx: VerifyContext, steps: ReadonlyArray<VerifiedStep>): VerifiedStep[] {
  return steps.map((verified, index) => supersededStep(ctx, index, verified));
}
