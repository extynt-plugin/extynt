// The verdicts for the operations that set one field of a layer: its name, parent, timing, switches, and the layer a plan creates.
import { sameFrameTime } from "./compare-values.js";
import { hiddenAsLaterMatte } from "./later-steps.js";
import type { SnapshotLayer } from "./snapshot-reply.js";
import { lastLaterIndex, layerWhere, realLayerId } from "./verify-context.js";
import type { LayerState } from "./verify-context.js";
import { exactStep, failedStep, unverifiedStep } from "./verdicts.js";
import type { Details, VerifiedStep } from "./verdicts.js";

interface FieldCheck {
  readonly matches: (state: LayerState) => boolean;
  readonly pass: string | ((state: LayerState) => string);
  readonly fail: string;
  readonly failDetails?: (state: LayerState) => Details;
}

type AttributeName = Extract<keyof SnapshotLayer, "enabled" | "shy" | "solo" | "label" | "locked" | "threeD">;

const ATTRIBUTES: ReadonlyMap<string, AttributeName> = new Map([
  ["enabled", "enabled"],
  ["shy", "shy"],
  ["solo", "solo"],
  ["label", "label"],
  ["locked", "locked"],
  ["three-d", "threeD"],
]);

const TIMING_HINT = "A layer cannot show more than its source: move a clip later with startTime (in and out follow it), and a time-remapped or precomp layer cannot extend past its source comp unless that comp or the remap is extended first.";

const MATTE_HIDDEN_REASON = "a later set_track_matte in this batch made this layer a matte, and After Effects switches a matte layer's video off; the earlier visibility write is not disproved";

function expectedLayerName(state: LayerState): string | undefined {
  const { ctx, request, layer, comp } = state;
  const renamed = lastLaterIndex(ctx, state.index, ({ step }) => {
    const renames = step.operation === "set_layer_name" && step.compositionId === comp.id && realLayerId(ctx, step.compositionId, step.layerId) === layer.id;
    return renames && typeof step.afterValue === "string";
  });
  const afterValue = ctx.steps[renamed]?.afterValue;
  return typeof afterValue === "string" ? afterValue : request.name;
}

function createdMatches(state: LayerState): boolean {
  const { request, layer } = state;
  const wanted = request.layerType === "solid" || request.layerType === "footage" ? "av" : request.layerType;
  return layer.name === expectedLayerName(state) && layer.type === wanted;
}

function parentMatches(state: LayerState): boolean {
  const { ctx, request, layer, compId } = state;
  const wanted = request.parentLayerId === null ? null : realLayerId(ctx, compId, request.parentLayerId);
  return layer.parentId === wanted;
}

function timingMatches(state: LayerState): boolean {
  const { request, layer, comp } = state;
  const rate = comp.frameRate;
  const onGrid = sameFrameTime(layer.inPoint, request.inPoint, rate) && sameFrameTime(layer.outPoint, request.outPoint, rate) && sameFrameTime(layer.startTime, request.startTime, rate);
  return onGrid && (request.stretch === undefined || layer.stretch === request.stretch);
}

function givenTiming(timing: { readonly inPoint?: number | undefined; readonly outPoint?: number | undefined; readonly startTime?: number | undefined }): Readonly<Record<string, number>> {
  const { inPoint, outPoint, startTime } = timing;
  return Object.fromEntries(Object.entries({ inPoint, outPoint, startTime }).filter((entry): entry is [string, number] => entry[1] !== undefined));
}

function timingDetails(state: LayerState): Details {
  return { expected: givenTiming(state.request), observedTiming: givenTiming(state.layer), hint: TIMING_HINT };
}

function fieldVerifier(check: FieldCheck): (state: LayerState) => VerifiedStep {
  return (state) => {
    const kind = state.request.operation;
    const where = layerWhere(state);
    if (check.matches(state)) return exactStep(kind, typeof check.pass === "string" ? check.pass : check.pass(state), where);
    return failedStep(kind, check.fail, { ...where, ...check.failDetails?.(state) });
  };
}

/** The verdict for create_layer: the layer exists with its name (as renamed later in the batch) and type. */
export const verifyCreateLayer = fieldVerifier({
  matches: createdMatches,
  pass: (state) => (expectedLayerName(state) === state.request.name ? "layer-exists-name-type" : "layer-exists-type-renamed-later"),
  fail: "layer-create-state-mismatch",
});

/** The verdict for set_layer_name. */
export const verifyLayerName = fieldVerifier({ matches: (state) => state.layer.name === state.request.name, pass: "layer-name", fail: "layer-name-mismatch" });

/** The verdict for set_layer_parent. */
export const verifyLayerParent = fieldVerifier({ matches: parentMatches, pass: "layer-parent", fail: "layer-parent-mismatch" });

/** The verdict for set_layer_timing, naming the expected and observed timing when they differ. */
export const verifyLayerTiming = fieldVerifier({ matches: timingMatches, pass: "layer-timing", fail: "layer-timing-mismatch", failDetails: timingDetails });

function verifyNamedAttribute(state: LayerState, attribute: AttributeName): VerifiedStep {
  const kind = state.request.operation;
  const where = layerWhere(state);
  if (state.layer[attribute] === state.request.value) return exactStep(kind, "layer-attribute", { ...where, attribute });
  if (attribute === "enabled" && hiddenAsLaterMatte(state)) return unverifiedStep(kind, "layer-hidden-as-track-matte", { ...where, reason: MATTE_HIDDEN_REASON });
  return failedStep(kind, "layer-attribute-mismatch", where);
}

/** The verdict for set_layer_attribute: a named switch read from the layer, any other switch from its switch table. */
export function verifyLayerAttribute(state: LayerState): VerifiedStep {
  const { request, layer, step } = state;
  const kind = request.operation;
  const role = request.role ?? "";
  const attribute = ATTRIBUTES.get(role);
  if (attribute) return verifyNamedAttribute(state, attribute);
  const seen = layer.switches?.[role];
  const where = layerWhere(state);
  if (seen === undefined || seen === null) return unverifiedStep(kind, "host-layer-attribute-not-in-snapshot", { ...where, hostVerification: step.verification ?? null });
  return seen === request.value ? exactStep(kind, "layer-switch", { ...where, attribute: role }) : failedStep(kind, "layer-switch-mismatch", where);
}
