// The verdicts for operations whose proof is the host's own targeted read: remove_mask and add_essential_property counts, and the time remap switch.
import { array, decode, fallback, jsonValue, number, object, optional } from "@extynt/decode";
import type { Infer } from "@extynt/decode";
import { hostVerification } from "./host-step.js";
import { exactStep, failedStep, unverifiedStep } from "./verdicts.js";
import type { Details, VerifiedStep } from "./verdicts.js";
import { layerWhere } from "./verify-context.js";
import type { LayerState } from "./verify-context.js";

const MAX_NAME = 256;

const maskCounts = object({ maskCountBefore: optional(fallback(number(), undefined)), maskCountAfter: optional(fallback(number(), undefined)) });
const essentialRead = object({ essential: optional(fallback(object({ before: optional(fallback(number(), undefined)), after: optional(fallback(number(), undefined)), names: optional(fallback(array(jsonValue), undefined)) }), undefined)), named: optional(fallback(jsonValue, undefined)) });

/** The verdict for remove_mask: the host counted the mask parade either side of the removal, and exactly one fewer is the absence. */
export function verifyRemoveMask(state: LayerState): VerifiedStep {
  const decoded = decode(maskCounts, state.step.row);
  const { maskCountBefore: before, maskCountAfter: after } = decoded.ok ? decoded.value : { maskCountBefore: undefined, maskCountAfter: undefined };
  const kind = state.request.operation;
  const details = { ...layerWhere(state), maskCountBefore: before ?? null, maskCountAfter: after ?? null };
  if (before === undefined || after === undefined) return unverifiedStep(kind, "mask-count-not-read", details);
  return after === before - 1 ? exactStep(kind, "mask-absent-host-readback", details) : failedStep(kind, "mask-count-mismatch", details);
}

/** The verdict for set_time_remap: the layer's time remap switch as the host read it right after the write. */
export function verifyTimeRemap(state: LayerState): VerifiedStep {
  const { request, step } = state;
  const kind = request.operation;
  const observed = step.observedEnabled ?? null;
  const details = { ...layerWhere(state), requestedEnabled: request.enabled ?? null, observedEnabled: observed };
  if (observed === null) return unverifiedStep(kind, "time-remap-state-not-read", details);
  return observed === request.enabled ? exactStep(kind, "time-remap-host-readback", details) : failedStep(kind, "time-remap-state-mismatch", details);
}

function absentName(request: LayerState["request"], read: Infer<typeof essentialRead>): string | null {
  const wanted = read.named === true && typeof request.name === "string" ? request.name.slice(0, MAX_NAME) : null;
  return wanted !== null && !(read.essential?.names ?? []).includes(wanted) ? wanted : null;
}

function essentialDetails(state: LayerState, before: number | undefined, after: number | undefined): Details {
  return { ...layerWhere(state), propertyPath: state.request.propertyPath, controllersBefore: before ?? null, controllersAfter: after ?? null };
}

/** The verdict for add_essential_property: one more Essential Graphics controller, carrying the requested name when the host could name it. */
export function verifyEssentialProperty(state: LayerState): VerifiedStep {
  const { request, step } = state;
  const kind = request.operation;
  const decoded = decode(essentialRead, step.row);
  const read = decoded.ok ? decoded.value : {};
  const before = read.essential?.before;
  const after = read.essential?.after;
  const details = essentialDetails(state, before, after);
  if (before === undefined || after === undefined) return unverifiedStep(kind, "essential-graphics-not-readable", { ...details, ...hostVerification(step) });
  if (after !== before + 1) return failedStep(kind, "essential-controller-count-mismatch", details);
  const absent = absentName(request, read);
  if (absent !== null) return failedStep(kind, "essential-controller-name-missing", { ...details, requestedName: absent });
  return exactStep(kind, "essential-graphics-host-readback", details);
}
