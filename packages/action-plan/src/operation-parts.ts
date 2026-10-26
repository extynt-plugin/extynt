// The small decoders every operation family reuses: colours, keyframe lists, expressions and the target forms that are not layer targets.
import { Failure, array, boolean, literal, nullable, number, record, string, strictObject, tuple, type Decoder, type Infer } from "@extynt/decode";
import { keyframeSpec } from "./keyframe-decoder.js";

/** A colour as three channel numbers. */
export const rgbColor = tuple(number(), number(), number());

/** A folder reference: a folder id, or null for the project root. */
export const folderReference = nullable(string());

/** What to do with keyframes a property already has. */
export const keyframeModeDecoder = literal("reject", "merge", "replace");

/** Keyframe lists keyed by the property they animate. */
export const keyframeLists = record(string(), array(keyframeSpec));

/** An expression and whether it is switched on. */
export const expressionSpec = strictObject({ source: string(), enabled: boolean() });

/** A project item target: the item and the plan identity it was made against. */
export const v2ItemTarget = strictObject({ itemId: string(), snapshotFingerprint: string(), selectionFingerprint: string() });

/** A composition target: the composition and the plan identity it was made against. */
export const v2CompositionTarget = strictObject({ compositionId: string(), snapshotFingerprint: string(), selectionFingerprint: string() });

/** The plan identity an operation without a target carries at its top level. */
export const planIdentity = { snapshotFingerprint: string(), selectionFingerprint: string() } as const;

type Fields<Shape> = { readonly [Key in keyof Shape]: Shape[Key] } & Readonly<Record<string, Shape[keyof Shape]>>;

/** Accepts what both decoders accept and joins their outputs, so one object can be read as a fixed part and an open part. */
export function both<First extends Fields<First>, Second extends Fields<Second>>(first: Decoder<First>, second: Decoder<Second>): Decoder<First & Second> {
  return {
    run(input) {
      const head = first.run(input);
      if (head instanceof Failure) return head;
      const rest = second.run(input);
      return rest instanceof Failure ? rest : { ...head, ...rest };
    },
  };
}

export type KeyframeMode = Infer<typeof keyframeModeDecoder>;
export type ExpressionSpec = Infer<typeof expressionSpec>;
export type V2ItemTarget = Infer<typeof v2ItemTarget>;
export type V2CompositionTarget = Infer<typeof v2CompositionTarget>;
