/**
 * Verification helpers for the moved verify suites. Every snapshot they verify against is an adapter envelope: probe-shaped layers are
 * turned into what the plugin and the details call return, then back through `toProbeEnvelope`, so the suites exercise the real path.
 */
import type { JsonObject, JsonValue } from "@extynt/decode";
import { decodeOrThrow } from "@extynt/decode";
import { jsonFieldsOf } from "@extynt/mcp-server";
import type { Opaque } from "../src/snapshot-view.js";
import { toProbeEnvelope, type NativeReadSet } from "../src/native-snapshot/index.js";
import type { ProbeSnapshot } from "../src/server-types.js";
import { rowList } from "../src/verify/json-fields.js";
import type { SnapshotComposition, SnapshotReply } from "../src/verify/snapshot-reply.js";
import type { VerifiedStep } from "../src/verify/verdicts.js";
import { foundLayer, lookupLayer, makeVerifyContext } from "../src/verify/verify-context.js";
import type { LayerState } from "../src/verify/verify-context.js";
import { verifyApply, type VerificationOutcome, type VerifyApplyOptions } from "../src/verify/verify-ops.js";
import { PROPERTY_PATH, entry, makeLayer, readSetOf, type Row } from "./native-fixtures.js";

export { PROPERTY_PATH };
export const COMP = "comp-1";
export const LAYER = "layer-1";

/** A fixture row that may hold undefined members: a case that leaves a field unset states it, and the helpers drop it before the row reaches the verifier. */
export type Loose = Record<string, Opaque>;

function wireRow(row: Loose): JsonObject {
  return jsonFieldsOf(Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined)));
}

export interface VerifyInput {
  operations: Loose[];
  hostSteps?: Loose[];
  layers?: Row[];
  comp?: Loose;
  before?: ProbeSnapshot | string;
  warnings?: string[];
}

export function positionLayer(value: Opaque, extra: Loose = {}): Row {
  const property = entry(PROPERTY_PATH, { valueType: "vector", keyframeCount: 0 });
  if (value === undefined) delete property.value; else property.value = value;
  return makeLayer(LAYER, 1, { propertyPaths: [property], ...wireRow(extra) });
}

export const keyedPosition = (extra: Row = {}): Row => entry(PROPERTY_PATH, { valueType: "vector", value: [960, 540], keyframeCount: 2, keyDigest: "2:2:beef", expressionEnabled: false, ...extra });

export const animateEvidence = (extra: Row = {}): Row => ({ operation: "animate_property", compositionId: COMP, layerId: LAYER, propertyPath: PROPERTY_PATH, afterKeys: 2, afterDigest: "2:2:beef", ...extra });

export const expressionEvidence = (extra: Row = {}): Row => ({ operation: "set_expression", compositionId: COMP, layerId: LAYER, propertyPath: PROPERTY_PATH, verification: "expression-enabled", observedSource: "value + [0, -10]", ...extra });

export const animateOperation: Row = { operation: "animate_property", propertyPath: PROPERTY_PATH };

/** The envelope the adapter builds for a composition holding `layers` (probe-shaped rows), as a read made after an apply would return it. */
export function envelopeOf(layers: Row[], comp: Row = {}, scope?: NativeReadSet["scope"], noBackground = false): ProbeSnapshot {
  return toProbeEnvelope(readSetOf({ compId: COMP, layers, comp, ...(noBackground ? { noBackground } : {}), ...(scope ? { scope } : {}) }), null);
}

/** The read made before the apply, in the form the runner keeps as `preApplySnapshot`. */
export const beforeSnapshot = (value: JsonValue | undefined): ProbeSnapshot => envelopeOf([positionLayer(value)]);

/** `verifyApply` over a plan given as plain rows, against any envelope or text. */
export function runVerify(plan: { operations: Row[]; hostSteps: Row[]; before?: ProbeSnapshot | string }, envelope: ProbeSnapshot | string, options?: VerifyApplyOptions): VerificationOutcome {
  const operations = decodeOrThrow(rowList, plan.operations);
  const hostSteps = decodeOrThrow(rowList, plan.hostSteps);
  return verifyApply({ receipt: {}, command: { operations }, hostSteps, preApplySnapshot: plan.before }, envelope, options);
}

/** Runs the verify step over one plan against an adapter envelope; operations and host steps default to the fixture composition and layer. */
export function verification(input: VerifyInput): VerificationOutcome {
  const read = envelopeOf(input.layers ?? [positionLayer([960, 540])], input.comp ? wireRow(input.comp) : {}, undefined, input.comp !== undefined && "backgroundColor" in input.comp && input.comp.backgroundColor === undefined);
  const envelope = input.warnings ? { ...read, warnings: input.warnings } : read;
  const operations = input.operations.map((operation) => wireRow({ compositionId: COMP, layerId: LAYER, ...operation }));
  const hostSteps = (input.hostSteps ?? input.operations.map(() => ({}))).map((step) => wireRow({ compositionId: COMP, layerId: LAYER, ...step }));
  return runVerify({ operations, hostSteps, ...(input.before === undefined ? {} : { before: input.before }) }, envelope);
}

export function stepsOf(outcome: VerificationOutcome): ReadonlyArray<VerifiedStep> {
  return outcome.receipt.verification?.steps ?? [];
}

/** The verdict of one step of the plan (the first by default). */
export function verdict(input: VerifyInput, index = 0): VerifiedStep {
  const step = stepsOf(verification(input))[index];
  if (!step) throw new Error(`no verdict at ${index}`);
  return step;
}

/** A property write verified against `observed`, with an optional before-value for the merge checks. */
export function writeVerdict(requested: JsonValue, before: JsonValue | undefined, observed: JsonValue): VerifiedStep {
  const operation = { operation: "set_layer_property", propertyPath: PROPERTY_PATH, value: requested };
  return verdict({ operations: [operation], layers: [positionLayer(observed)], before: beforeSnapshot(before) });
}

/** The state of a plan's first operation against a fresh read holding `compositions`, as a layer verifier receives it. */
export function layerStateOf(input: { readonly operation: JsonObject; readonly step: JsonObject; readonly compositions: ReadonlyArray<SnapshotComposition> }): LayerState {
  const reply: SnapshotReply = { ok: true, result: { compositions: input.compositions } };
  const context = makeVerifyContext({ operations: [input.operation], hostSteps: [input.step], before: { ok: false } }, reply);
  const state = foundLayer(lookupLayer(context, 0));
  if (!state) throw new Error("the fixture does not hold the addressed layer");
  return state;
}
