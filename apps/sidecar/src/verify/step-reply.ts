// The decoders for the evidence the host returns per applied step: the step row itself, and the fields each layer operation's read-back verdict re-checks.
import { array, decode, fallback, jsonObject, jsonValue, number, object, optional, refine, string } from "@extynt/decode";
import type { Decoder, Infer, JsonObject } from "@extynt/decode";

type HostStepRow = JsonObject & { readonly operation: string };

function namesOperation(row: JsonObject): row is HostStepRow {
  return typeof row.operation === "string";
}

/** Accepts a step row that names its operation and keeps all of its fields. */
export const hostStepRow: Decoder<HostStepRow> = refine(jsonObject, namesOperation, "a step with an operation");

const effectNames = optional(fallback(array(string()), undefined));

const centerAnchor = object({ contentRect: optional(fallback(jsonObject, undefined)), anchorAfter: optional(fallback(array(number(), { minLength: 1 }), undefined)) });
const measuredRect = object({ left: number(), top: number(), width: number(), height: number() });
const reorderEffect = object({ observedIndex: optional(fallback(number(), undefined)), stackBefore: effectNames, stackAfter: effectNames });
const removeEffect = object({ removedName: optional(fallback(string(), undefined)), stackBefore: effectNames, stackAfter: effectNames });
const resizeSolid = object({ after: optional(fallback(jsonObject, undefined)) });
const textPath = object({ written: optional(fallback(jsonObject, undefined)) });
const replaceSource = object({ sourceId: optional(fallback(string(), undefined)) });
const presetFile = object({ file: optional(fallback(string(), undefined)), bytes: optional(fallback(number(), undefined)), effects: optional(fallback(number(), undefined)) });
const copyEffects = object({ copiedEffects: effectNames, failedEffects: effectNames, skippedProperties: optional(fallback(jsonValue, undefined)) });
const editKeyframes = object({
  beforeTimes: optional(fallback(array(jsonValue), undefined)),
  afterTimes: optional(fallback(array(jsonValue), undefined)),
  selectedKeys: optional(fallback(number(), undefined)),
  movedTo: optional(fallback(array(number(), { minLength: 1 }), undefined)),
});

/** The fields of a step each layer operation reads back, by operation, as one table of decoders. */
export const stepEvidence = { centerAnchor, reorderEffect, removeEffect, resizeSolid, textPath, replaceSource, presetFile, copyEffects, editKeyframes } as const;

type MeasuredRect = Infer<typeof measuredRect>;

/** The step's content rectangle when the host measured all four edges, else null. */
export function measuredRectOf(rect: JsonObject | undefined): MeasuredRect | null {
  const decoded = decode(measuredRect, rect);
  return decoded.ok ? decoded.value : null;
}
