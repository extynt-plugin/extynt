// The receipt step a verifier returns, and the three builders that make one: exact, applied but unverified, and failed.

import type { JsonValue } from "@extynt/decode";

/** A value a verdict row carries as evidence. */
export type Detail = JsonValue | undefined;

/** The evidence fields a verdict row carries besides its fixed ones. */
export type Details = { readonly [name: string]: Detail };

type VerificationState = "exact" | "applied_unverified" | "failed";

/** The verdict for one operation: its fixed fields, plus whatever evidence names the mismatch. */
export interface VerifiedStep {
  readonly [name: string]: Detail;
  readonly operation: string;
  readonly observed: boolean;
  readonly verificationState: VerificationState;
  readonly basis: string;
  readonly expressionMotionUnverified?: boolean;
  readonly supersededBy?: number;
}

function stepOf(operation: string, state: VerificationState, basis: string, details: Details): VerifiedStep {
  return { ...details, operation, observed: state === "exact", verificationState: state, basis };
}

/** The operation read back exactly as requested. */
export function exactStep(operation: string, basis: string, details: Details = {}): VerifiedStep {
  return stepOf(operation, "exact", basis, details);
}

/** The operation was applied but the fresh read cannot confirm it. */
export function unverifiedStep(operation: string, basis: string, details: Details = {}): VerifiedStep {
  return stepOf(operation, "applied_unverified", basis, details);
}

/** The fresh read contradicts the operation. */
export function failedStep(operation: string, basis: string, details: Details = {}): VerifiedStep {
  return stepOf(operation, "failed", basis, details);
}

/** An exact verdict when `matches`, else a failed one; the two bases name which. */
export function judged(matches: boolean, operation: string, bases: { readonly pass: string; readonly fail: string }, details: Details = {}): VerifiedStep {
  return matches ? exactStep(operation, bases.pass, details) : failedStep(operation, bases.fail, details);
}
