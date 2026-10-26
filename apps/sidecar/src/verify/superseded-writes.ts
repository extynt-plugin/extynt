// A failed verdict for a write that a later operation rewrote is not a failure of the plan: it is superseded, keyed by what each operation writes.
import type { Request } from "./plan-request.js";
import type { VerifiedStep } from "./verdicts.js";

function firstOf(...values: ReadonlyArray<string | null | undefined>): string | null {
  return values.find((value) => value) ?? null;
}

function writeKey(request: Request): string {
  const target = request.target ?? request;
  return JSON.stringify([
    request.operation,
    target.compositionId,
    target.layerId,
    target.itemId,
    firstOf(request.propertyPath, target.propertyPath),
    firstOf(request.effectPath, target.effectPath),
    firstOf(request.effectMatchName),
    firstOf(request.role),
    firstOf(request.field),
    firstOf(request.setting),
    firstOf(request.option),
    firstOf(request.maskId),
    firstOf(request.groupId),
  ]);
}

function lastWrites(requests: ReadonlyArray<Request>): ReadonlyMap<string, number> {
  const last = new Map<string, number>();
  requests.forEach((request, index) => last.set(writeKey(request), index));
  return last;
}

/** Turns each failed step into an unverified one when a later step wrote the same thing and did not fail. */
export function supersedeFailedSteps(steps: ReadonlyArray<VerifiedStep>, requests: ReadonlyArray<Request>): ReadonlyArray<VerifiedStep> {
  const last = lastWrites(requests);
  return steps.map((step, index) => {
    const request = requests[index];
    if (step.verificationState !== "failed" || !request) return step;
    const later = last.get(writeKey(request));
    if (later === undefined || later <= index || steps[later]?.verificationState === "failed" || !steps[later]) return step;
    return { ...step, observed: false, verificationState: "applied_unverified", basis: "superseded-by-later-operation", supersededBy: later };
  });
}
