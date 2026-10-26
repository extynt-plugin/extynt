// The host's own read of each property a structured write set: writes and animations paired with what the plan asked for, each marked as matching, contradicting or unjudged.
import { array, boolean, decode, fallback, jsonValue, number, object, optional } from "@extynt/decode";
import type { Infer } from "@extynt/decode";
import { KEY_TIME_TOLERANCE, sameControlValue } from "./compare-values.js";
import type { HostStep, SpecRow } from "./host-step.js";
import type { Request } from "./plan-request.js";
import { failedStep } from "./verdicts.js";
import type { Details, VerifiedStep } from "./verdicts.js";

const CONTROL_READ_COMPONENTS = 4;

const frame = object({ time: optional(fallback(number(), undefined)), value: optional(fallback(jsonValue, undefined)) });
const requestedSpec = object({ value: optional(fallback(jsonValue, undefined)), keyframes: optional(fallback(array(fallback(frame, undefined)), undefined)) });
const requestedSpecs = object({ writes: optional(fallback(array(fallback(requestedSpec, {})), undefined)), animations: optional(fallback(array(fallback(requestedSpec, {})), undefined)) });
const keyRead = object({ keys: array(fallback(frame, undefined)), truncated: optional(fallback(boolean(), undefined)) });

type RequestedSpec = Infer<typeof requestedSpec>;
type RequestedFrame = Infer<typeof frame>;

/** One property the host re-read after a structured write, and whether that read matches the request. */
export interface CheckedSpec extends SpecRow {
  readonly hostMatched: boolean | null;
}

function writeHostMatch(spec: SpecRow, requested: RequestedSpec | undefined): boolean | null {
  const wanted = requested?.value;
  if (wanted === undefined || spec.value === undefined || spec.value === null) return null;
  if (Array.isArray(wanted) && wanted.length > CONTROL_READ_COMPONENTS) return null;
  return sameControlValue(spec.value, wanted);
}

function frameValueMatch(found: RequestedFrame, wanted: RequestedFrame): boolean | null {
  return found.value === undefined || found.value === null || wanted.value === undefined ? null : sameControlValue(found.value, wanted.value);
}

function frameHostMatch(keys: ReadonlyArray<RequestedFrame | undefined>, wanted: RequestedFrame | undefined, truncated: boolean): boolean | null {
  const time = wanted?.time;
  if (!wanted || time === undefined) return null;
  const found = keys.find((key) => key?.time !== undefined && Math.abs(key.time - time) < KEY_TIME_TOLERANCE);
  if (!found) return truncated ? null : false;
  return frameValueMatch(found, wanted);
}

function keyHostMatch(spec: SpecRow, requested: RequestedSpec | undefined): boolean | null {
  const decoded = decode(keyRead, spec.keys);
  const frames = requested?.keyframes ?? [];
  if (!decoded.ok || frames.length === 0) return null;
  let verdict: boolean | null = true;
  for (const wanted of frames) {
    const outcome = frameHostMatch(decoded.value.keys, wanted, decoded.value.truncated === true);
    if (outcome === false) return false;
    if (outcome === null) verdict = null;
  }
  return verdict;
}

/** The host's spec read-backs, writes then animations, each paired index for index with the request's own list. */
export function hostCheckedSpecs(request: Request, step: HostStep): ReadonlyArray<CheckedSpec> {
  const decoded = decode(requestedSpecs, request.row);
  const requested = decoded.ok ? decoded.value : {};
  const writes = (step.writes ?? []).map((spec, index): CheckedSpec => ({ ...spec, hostMatched: writeHostMatch(spec, requested.writes?.[index]) }));
  const animations = (step.animations ?? []).map((spec, index): CheckedSpec => ({ ...spec, hostMatched: keyHostMatch(spec, requested.animations?.[index]) }));
  return [...writes, ...animations];
}

/** The failure for the first property whose host read contradicts the request, or null. */
export function hostSpecMismatch(kind: string, specs: ReadonlyArray<CheckedSpec>, details: Details): VerifiedStep | null {
  const mismatch = specs.find((spec) => spec.hostMatched === false);
  return mismatch ? failedStep(kind, "spec-host-readback-mismatch", { ...details, propertyPath: mismatch.path ?? null, observedValue: mismatch.value ?? mismatch.keys ?? null }) : null;
}
