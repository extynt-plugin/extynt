// The decoders for a metadata read-set plan: the approved command and its targets, the snapshot taken before it, and the readbacks the host answers with.
import { array, boolean, decode, fallback, jsonObject, jsonValue, literal, map, nullable, number, object, optional, refine, string, taggedUnion } from "@extynt/decode";
import type { Decoder, Infer, JsonObject } from "@extynt/decode";
import { rowDecoder } from "./json-fields.js";

/** A row decoded to the fields one check reads, with the whole row kept for the fields it passes through. */
export interface Held<T> {
  readonly view: T;
  readonly row: JsonObject;
}

/** The epoch and revision the host stamps a read with, and whatever else it sent. */
export type HostStamp = JsonObject & { readonly epoch: number; readonly revision: number };

function isStamp(row: JsonObject): row is HostStamp {
  return Number.isSafeInteger(row.epoch) && Number.isSafeInteger(row.revision);
}

function isMetadataCoverage(row: JsonObject): row is JsonObject {
  return row.kind === "composition-metadata";
}

function present<T>(value: Held<T> | null): value is Held<T> {
  return value !== null;
}

function held<T>(view: Decoder<T>): Decoder<Held<T>> {
  const pair = map(rowDecoder, (row) => {
    const decoded = decode(view, row);
    return decoded.ok ? { view: decoded.value, row } : null;
  });
  return refine(pair, present, "a row of the expected shape");
}

const count = number({ int: true });
const stamp = refine(jsonObject, isStamp, "a host stamp");

const targetFields = { operationIndex: number(), compositionId: string(), layerId: string(), itemIndex: count, layerIndex: count, name: string() };
const readSetFields = { digest: string(), stamp };

const renameTarget = object({ ...targetFields, desiredName: optional(fallback(string(), undefined)) });
const blurTarget = object({ ...targetFields, desiredValue: number(), localEffect: jsonObject });
const createTarget = object({ ...targetFields, enabled: optional(fallback(boolean(), undefined)), initialization: optional(fallback(jsonValue, undefined)), localCreation: optional(fallback(jsonValue, undefined)) });

const readSet = taggedUnion("schemaVersion", {
  "metadata-read-set/1": object({ schemaVersion: literal("metadata-read-set/1"), ...readSetFields, targets: array(renameTarget) }),
  "blur-control-read-set/1": object({ schemaVersion: literal("blur-control-read-set/1"), ...readSetFields, targets: array(blurTarget) }),
  "gaussian-create-read-set/1": object({ schemaVersion: literal("gaussian-create-read-set/1"), ...readSetFields, targets: array(createTarget) }),
});

const approvedCommand = object({ planId: optional(fallback(string(), undefined)), operations: array(rowDecoder), readSet });

/** The approved command of a read-set plan: its operations and the read set bound to the observation it was prepared from. */
export type ApprovedCommand = Infer<typeof approvedCommand>;
/** The fields every kind of target names. */
export type TargetBase = Infer<typeof renameTarget>;
/** The target of a blur-control plan. */
export type BlurTarget = Infer<typeof blurTarget>;
/** The target of a Gaussian-blur creation plan. */
export type CreateTarget = Infer<typeof createTarget>;

const layerView = object({ id: optional(fallback(string(), undefined)), index: optional(fallback(number(), undefined)), name: optional(fallback(string(), undefined)), locked: optional(fallback(boolean(), undefined)) });
const compositionView = object({ id: string(), width: number(), height: number(), itemIndex: optional(fallback(number(), undefined)), layers: array(held(layerView)) });

const beforeResult = object({
  hostStamp: optional(jsonValue),
  coverage: refine(jsonObject, isMetadataCoverage, "metadata coverage"),
  compositions: array(held(compositionView)),
  activeCompositionId: optional(nullable(string())),
  currentTime: optional(number()),
});

const failure = object({ code: optional(string()), message: optional(string()), retryable: optional(boolean()), details: optional(jsonObject) });

const beforeEnvelope = object({
  ok: literal(true),
  requestId: optional(string()),
  error: optional(nullable(failure)),
  warnings: optional(array(jsonValue)),
  result: held(beforeResult),
});

/** One composition of the snapshot the plan was prepared from. */
export type CompositionView = Infer<typeof compositionView>;
/** The snapshot the plan was prepared from. */
export type BeforeEnvelope = Infer<typeof beforeEnvelope>;

/** The metadata snapshot taken before the plan, with its rows kept whole. */
export const beforeSnapshot: Decoder<Held<BeforeEnvelope>> = held(beforeEnvelope);

/** The approved command of a read-set plan. */
export const commandShape: Decoder<ApprovedCommand> = approvedCommand;

const freshComposition = object({ id: string(), itemIndex: count, name: string(), width: number(), height: number(), duration: number(), frameRate: number() });

type FreshComposition = Infer<typeof freshComposition>;
/** A fresh composition row, kept whole. */
export const heldComposition: Decoder<Held<FreshComposition>> = held(freshComposition);

const layerRow = object({
  operationIndex: number(),
  compositionId: string(),
  layerId: string(),
  layerIndex: count,
  name: string(),
  locked: boolean(),
  selected: boolean(),
  expectedName: optional(fallback(string(), undefined)),
  value: optional(fallback(number(), undefined)),
  created: optional(fallback(boolean(), undefined)),
});

/** One layer the host read back after the write. */
export type LayerRowView = Infer<typeof layerRow>;

const boundFields = { planId: string(), readSetDigest: string(), complete: literal(true), stamp, rows: array(layerRow) };

/** The readback of a rename plan. */
export const renameReadback = object({ ...boundFields, compositions: array(rowDecoder), activeCompositionId: nullable(string()) });

const localMetadata = object({
  composition: heldComposition,
  layer: held(object({ id: string(), index: number(), name: string(), locked: boolean(), selected: boolean() })),
  activeCompositionId: nullable(string()),
});

/** The local metadata a single-layer readback carries beside its row. */
export type LocalMetadata = Infer<typeof localMetadata>;

/** The readback of a blur-control plan. */
export const blurReadback = object({ ...boundFields, metadata: localMetadata, localEffect: held(object({ effectEnabled: optional(fallback(boolean(), undefined)) })) });

const createdControl = object({
  matchName: string(),
  value: number(),
  minimum: number(),
  maximum: number(),
  keyframeCount: optional(fallback(number(), undefined)),
  expressionEnabled: optional(fallback(boolean(), undefined)),
  expression: optional(fallback(string(), undefined)),
});

/** One control of the effect a creation plan added. */
export type CreatedControl = Infer<typeof createdControl>;

/** The readback of a Gaussian-blur creation plan. */
export const creationReadback = object({
  ...boundFields,
  metadata: localMetadata,
  createdEffect: held(object({ effectMatchName: string(), effectIndex: number(), enabled: optional(fallback(boolean(), undefined)), dependencyPolicy: string(), controls: array(createdControl) })),
});

/** The values a Gaussian-blur creation asks the new effect to start with. */
export const initializationShape = object({ blurriness: number(), dimensions: number(), repeatEdgePixels: boolean() });

/** The effects the layer held before a Gaussian-blur creation. */
export const creationInventory = object({ inventory: array(jsonValue) });

/** The fields every readback shares: the plan and read set it answers, when it was taken, and the layers it read. */
export interface BoundReadback {
  readonly planId: string;
  readonly readSetDigest: string;
  readonly stamp: HostStamp;
  readonly rows: ReadonlyArray<LayerRowView>;
}
