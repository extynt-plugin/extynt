// The record of an apply that never returned, as a probe snapshot carries it: bounded, and read as absent when it is not well formed.
import { fallback, map, number, object, refine, string } from "@extynt/decode";
import type { Decoder, Infer } from "@extynt/decode";

const PLAN_ID = /^[A-Za-z0-9._:-]{1,256}$/;
const OPERATION = /^[a-z_]{1,64}$/;
const LAYER_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const STARTED_AT = /^[0-9]{1,16}$/;

function matching(pattern: RegExp): Decoder<string | null> {
  return map(fallback(string(), undefined), (given) => given !== undefined && pattern.test(given) ? given : null);
}

const reportedApply = object({
  planId: refine(string(), (given): given is string => PLAN_ID.test(given), "a plan id"),
  index: refine(number(), (given): given is number => Number.isInteger(given) && given >= 0, "a step index"),
  operationCount: map(fallback(number(), undefined), (given) => given !== undefined && Number.isInteger(given) && given > 0 ? given : null),
  operation: matching(OPERATION),
  layerId: matching(LAYER_ID),
  startedAt: matching(STARTED_AT),
});

/** The apply After Effects quit during: its plan, the step it was on and, where the host named them, the operation and layer. */
export type InterruptedApply = Infer<typeof reportedApply>;

/** Decodes the interrupted apply a snapshot reports; a record that is not well formed reads as not given, so a bad breadcrumb never rejects the snapshot. */
export const interruptedApply: Decoder<InterruptedApply | undefined> = fallback(reportedApply, undefined);
