// The decoders for the plan envelope's own shapes, a plan's bounds and an operation's layer target; their types are what the decoders produce.
import { number, optional, string, strictObject, type Infer } from "@extynt/decode";

const POSITIVE_INTEGER = number({ int: true, min: 1 });

/** A plan's declared bounds: a positive operation count and optional positive keyframe, keyframe-time and expression ceilings; no other field. */
export const planBounds = strictObject({
  maxOperations: POSITIVE_INTEGER,
  maxKeyframes: optional(POSITIVE_INTEGER),
  maxKeyframeTimeSeconds: optional(POSITIVE_INTEGER),
  maxExpressionLength: optional(POSITIVE_INTEGER),
});

/** A layer target: composition and layer ids with the plan identity it was made against, and optional effect and property paths; no other field. */
export const v2Target = strictObject({
  compositionId: string(),
  layerId: string(),
  snapshotFingerprint: string(),
  selectionFingerprint: string(),
  effectPath: optional(string()),
  propertyPath: optional(string()),
});

export type PlanBounds = Infer<typeof planBounds>;
export type V2TargetReference = Infer<typeof v2Target>;
