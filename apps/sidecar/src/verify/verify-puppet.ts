// The verdicts for set_puppet_pins: the host reads the Puppet effect, the pin count and every pin's rest position back from the carrier layer; and for the layer the plan created and then pinned.
import { DOLLY_TOLERANCE_PX } from "@extynt/action-plan";
import { array, boolean, decode, fallback, number, object, optional, string } from "@extynt/decode";
import type { Infer } from "@extynt/decode";
import { exactStep, failedStep, unverifiedStep } from "./verdicts.js";
import type { VerifiedStep } from "./verdicts.js";
import { layerIn } from "./verify-context.js";
import type { LayerLookup, LayerState } from "./verify-context.js";

const PIN_TOLERANCE = DOLLY_TOLERANCE_PX;

const point = object({ x: number(), y: number() });
const pinRead = object({ effectPresent: boolean(), carrierLayerId: string(), pins: array(point) });
const pinEvidence = object({ pinReadback: optional(fallback(pinRead, undefined)) });
const requestedPin = object({ x: optional(fallback(number(), undefined)), y: optional(fallback(number(), undefined)), keyframes: optional(fallback(array(fallback(object({ time: optional(fallback(number(), undefined)), x: optional(fallback(number(), undefined)), y: optional(fallback(number(), undefined)) }), undefined)), undefined)) });
const requestedPins = object({ pins: optional(fallback(array(fallback(requestedPin, {})), undefined)) });

type Point = Infer<typeof point>;

type RequestedPin = Infer<typeof requestedPin>;

interface OffPin {
  readonly index: number;
  readonly expected: Point;
  readonly observed: Point;
}

function orNaN(value: number | undefined): number {
  return value ?? Number.NaN;
}

/** Where a pin must sit at time 0: its rest position, unless a key at time 0 replaces it (relative keys are offsets from the rest position). */
export function expectedRest(pin: RequestedPin, relative: boolean): Point {
  const x = orNaN(pin.x);
  const y = orNaN(pin.y);
  const first = pin.keyframes?.[0];
  if (first?.time !== 0) return { x, y };
  const dx = orNaN(first.x);
  const dy = orNaN(first.y);
  return relative ? { x: x + dx, y: y + dy } : { x: dx, y: dy };
}

function firstOffPin(read: Infer<typeof pinRead>, requested: ReadonlyArray<RequestedPin>, relative: boolean): OffPin | undefined {
  for (const [index, pin] of requested.entries()) {
    const expected = expectedRest(pin, relative);
    const observed = read.pins[index];
    if (observed && (Math.abs(observed.x - expected.x) > PIN_TOLERANCE || Math.abs(observed.y - expected.y) > PIN_TOLERANCE)) return { index, expected, observed };
  }
  return undefined;
}

function carrierVerdict(state: LayerState, read: Infer<typeof pinRead>): VerifiedStep {
  const { request, comp } = state;
  const kind = request.operation;
  const decoded = decode(requestedPins, request.row);
  const requested = decoded.ok ? (decoded.value.pins ?? []) : [];
  if (!layerIn(comp, read.carrierLayerId)) return failedStep(kind, "puppet-carrier-layer-absent", { compositionId: comp.id, layerId: state.layer.id, carrierLayerId: read.carrierLayerId });
  const carrier = { compositionId: comp.id, layerId: read.carrierLayerId, requestedLayerId: request.layerId ?? null };
  if (!read.effectPresent) return failedStep(kind, "puppet-effect-absent", carrier);
  if (read.pins.length !== requested.length) return failedStep(kind, "puppet-pin-count-differs", { ...carrier, expectedPins: requested.length, observedPins: read.pins.length });
  const off = firstOffPin(read, requested, request.relative === true);
  if (off) return failedStep(kind, "puppet-pin-position-off", { ...carrier, pin: off.index + 1, expected: off.expected, observedPin: off.observed, tolerance: PIN_TOLERANCE });
  return exactStep(kind, "puppet-pins-read-back", { ...carrier, pins: requested.length });
}

/** The verdict for set_puppet_pins. */
export function verifyPuppetPins(state: LayerState): VerifiedStep {
  const decoded = decode(pinEvidence, state.step.row);
  const read = decoded.ok ? decoded.value.pinReadback : undefined;
  const where = { compositionId: state.comp.id, layerId: state.layer.id };
  return read ? carrierVerdict(state, read) : unverifiedStep(state.request.operation, "puppet-pins-not-reported", where);
}

/** The verdict for a created layer the plan then pinned: the carrier that replaced it in the composition proves it was made. */
export function wrappedInPuppetCarrier(lookup: LayerLookup): VerifiedStep | null {
  const { ctx, request, step, comp } = lookup;
  if (request.operation !== "create_layer" || !comp) return null;
  const pinned = ctx.steps.find((candidate) => candidate.operation === "set_puppet_pins" && candidate.created === true && (candidate.requestedLayerId === lookup.layerId || candidate.requestedLayerId === request.layerId));
  const carrierLayerId = pinned?.carrierLayerId;
  if (!carrierLayerId || !layerIn(comp, carrierLayerId)) return null;
  return exactStep(request.operation, "layer-wrapped-in-puppet-carrier", { compositionId: comp.id, layerId: lookup.layerId ?? step.layerId, carrierLayerId });
}
