// The verdict for add_mask and update_mask: the host's read of the mask against the snapshot's mask row and the requested path and settings.
import type { JsonObject, JsonValue } from "@extynt/decode";
import { decode, fallback, jsonObject, object, optional } from "@extynt/decode";
import { objectOf } from "./json-fields.js";
import { sameControlValue } from "./compare-values.js";
import type { Reading } from "./compare-values.js";
import { pathMismatchField } from "./shape-path.js";
import { boundedValueText } from "./value-text.js";
import { exactStep, failedStep, unverifiedStep } from "./verdicts.js";
import type { VerifiedStep } from "./verdicts.js";
import { layerWhere } from "./verify-context.js";
import type { LayerState } from "./verify-context.js";

const MASK_ATOM = /^ADBE Mask Parade\/ADBE Mask Atom(?:#[1-9][0-9]*)?$/;
const MASK_SETTINGS = ["opacity", "feather", "expansion", "mode", "inverted", "rotoBezier"];
const STRICT_SETTINGS = new Set(["mode", "inverted", "rotoBezier"]);

const maskRead = object({ readback: optional(fallback(jsonObject, undefined)) });

function maskPathVerdict(state: LayerState, readback: JsonObject, expected: JsonObject): VerifiedStep | null {
  const wanted = objectOf(expected.path);
  if (!wanted) return null;
  const kind = state.request.operation;
  const seen = objectOf(readback.path);
  if (!seen) return failedStep(kind, "mask-path-not-read", layerWhere(state));
  const field = pathMismatchField(seen, wanted);
  return field ? failedStep(kind, "mask-path-mismatch", { ...layerWhere(state), field, observedValue: boundedValueText(seen[field]), expectedValue: boundedValueText(wanted[field]) }) : null;
}

function sameSetting(field: string, observed: Reading, expected: Reading): boolean {
  return STRICT_SETTINGS.has(field) ? observed === expected : sameControlValue(observed, expected);
}

function maskValueVerdict(state: LayerState, readback: JsonObject, expected: JsonObject): VerifiedStep | null {
  const field = MASK_SETTINGS.find((name) => expected[name] !== undefined && !sameSetting(name, readback[name], expected[name]));
  return field ? failedStep(state.request.operation, "mask-value-mismatch", { ...layerWhere(state), field }) : null;
}

function maskInSnapshot(state: LayerState, name: JsonValue | undefined): boolean {
  return (state.layer.propertyPaths ?? []).some((row) => row.path !== undefined && MASK_ATOM.test(row.path) && row.displayName === name);
}

function maskFault(state: LayerState, name: JsonValue | undefined): VerifiedStep | null {
  const kind = state.request.operation;
  if (!maskInSnapshot(state, name)) return state.layer.propertyPathsTruncated === true ? unverifiedStep(kind, "mask-not-in-truncated-snapshot", layerWhere(state)) : failedStep(kind, "mask-not-in-snapshot", layerWhere(state));
  return kind === "add_mask" && name !== state.request.name ? failedStep(kind, "mask-name-mismatch", layerWhere(state)) : null;
}

/** The verdict for add_mask and update_mask. */
export function verifyMaskReadback(state: LayerState): VerifiedStep {
  const { request } = state;
  const kind = request.operation;
  const decoded = decode(maskRead, state.step.row);
  const readback = decoded.ok ? decoded.value.readback : undefined;
  if (!readback) return unverifiedStep(kind, "mask-host-readback-unavailable", layerWhere(state));
  const expected = request.values ?? {};
  return maskFault(state, readback.name) ?? maskPathVerdict(state, readback, expected) ?? maskValueVerdict(state, readback, expected) ?? exactStep(kind, "mask-host-and-snapshot-readback", layerWhere(state));
}
