// The request side of a native collection: the target a caller names, validated once, and the host function and request that carry it.
import { decode, decodeOrCode, fallback, literal, object } from "@extynt/decode";
import type { Infer, JsonValue } from "@extynt/decode";
import { boundedText, ordinal, ordinalList } from "./native-field-decoders.js";

const COMPOSITION_KEYS = ["itemIndex", "compositionId"] as const;
const LAYER_KEYS = ["layerIndex", "layerId"] as const;
const targetKind = literal("index", "layers", "properties", "values", "blur", "effect-create");
const targetFacts = object({
  kind: targetKind,
  itemIndex: fallback(ordinal, undefined), compositionId: fallback(boundedText(256), undefined),
  layerIndex: fallback(ordinal, undefined), layerId: fallback(boundedText(256), undefined),
  propertyIndices: fallback(ordinalList({ minLength: 1, maxLength: 16 }), undefined),
  expectedStamp: fallback(object({ epoch: ordinal, revision: ordinal }), undefined),
});

/** What a caller wants read: one kind of page, bound to the composition, layer and property it names. */
export type CollectionTarget = Infer<typeof targetFacts>;

type TargetKind = CollectionTarget["kind"];
type TargetKey = keyof CollectionTarget;

const REQUIRED: { readonly [Kind in TargetKind]: readonly TargetKey[] } = {
  index: [], layers: COMPOSITION_KEYS, properties: [...COMPOSITION_KEYS, ...LAYER_KEYS],
  values: [...COMPOSITION_KEYS, ...LAYER_KEYS, "propertyIndices"], blur: [...COMPOSITION_KEYS, ...LAYER_KEYS], "effect-create": [...COMPOSITION_KEYS, ...LAYER_KEYS],
};
const STAMPED: ReadonlySet<TargetKind> = new Set<TargetKind>(["values", "blur", "effect-create"]);
const HOST_FUNCTIONS: { readonly [Kind in TargetKind]: string } = {
  "effect-create": "aeCollectEffectCreation", blur: "aeCollectBlurControl", index: "aeCollectIndexPage", values: "aeCollectValuePage",
  layers: "aeCollectDetailPage", properties: "aeCollectDetailPage",
};

interface StartRequest { target: JsonValue | undefined; startCursor: JsonValue | undefined }

/** Validates the target of a new read and the cursor it starts at. */
export function collectionStart(request: StartRequest): { target: CollectionTarget; cursor: number } {
  const target = decodeOrCode(targetFacts, request.target, "INVALID_COLLECTION_TARGET");
  if (REQUIRED[target.kind].some((key) => target[key] === undefined)) throw Error("INVALID_COLLECTION_TARGET");
  if (STAMPED.has(target.kind) && target.expectedStamp === undefined) throw Error("INVALID_COLLECTION_STAMP");
  const cursor = target.kind === "index" && request.startCursor !== undefined ? request.startCursor : 1;
  return { target, cursor: decodeOrCode(ordinal, cursor, "INVALID_CURSOR") };
}

/** The ExtendScript function that reads this kind of page. */
export function collectionHostFunction(kind: CollectionTarget["kind"]): string {
  return HOST_FUNCTIONS[kind];
}

/** The target of an already observed page, read without the requirements of a new read; undefined when it names no kind. */
export function observedTarget(input: JsonValue): CollectionTarget | undefined {
  const parsed = decode(targetFacts, input);
  return parsed.ok ? parsed.value : undefined;
}
