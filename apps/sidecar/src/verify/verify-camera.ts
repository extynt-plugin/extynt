// The verdict for dolly_camera: each Position key the host read back sits at the requested distance from the Point of Interest, on the camera's original axis.
import { DOLLY_POSITION_PATH, DOLLY_TOLERANCE_PX } from "@extynt/action-plan";
import { array, boolean, decode, fallback, number, object, optional } from "@extynt/decode";
import type { Infer } from "@extynt/decode";
import { exactStep, failedStep, unverifiedStep } from "./verdicts.js";
import type { Details, VerifiedStep } from "./verdicts.js";
import { layerWhere } from "./verify-context.js";
import type { LayerState } from "./verify-context.js";

const hostKey = object({ time: number(), distance: number(), offAxis: number() });
const hostEvidence = object({ dollyKeys: optional(fallback(array(fallback(hostKey, undefined)), undefined)), hasPointOfInterest: optional(fallback(boolean(), undefined)) });
const requestedKeys = object({ keyframes: optional(fallback(array(fallback(object({ distance: optional(fallback(number(), undefined)) }), {})), undefined)) });

type HostKey = Infer<typeof hostKey>;

interface Finding {
  readonly basis: string;
  readonly details: Details;
}

function reportedKeys(state: LayerState): ReadonlyArray<HostKey> | undefined {
  const decoded = decode(hostEvidence, state.step.row);
  const keys = decoded.ok ? decoded.value.dollyKeys : undefined;
  const present = keys?.flatMap((key) => (key ? [key] : []));
  return present?.length === keys?.length ? present : undefined;
}

function keyFinding(keys: ReadonlyArray<HostKey>, wanted: ReadonlyArray<{ readonly distance?: number | undefined }>): Finding | undefined {
  for (const [index, want] of wanted.entries()) {
    const got = keys[index];
    if (!got) return undefined;
    if (got.offAxis > DOLLY_TOLERANCE_PX) return { basis: "camera-dolly-off-axis", details: { keyIndex: index, time: got.time, offAxisPixels: got.offAxis, hint: "this Position key left the camera's original viewing axis; dolly_camera derives keys on that axis" } };
    if (want.distance !== undefined && Math.abs(got.distance - want.distance) > DOLLY_TOLERANCE_PX) return { basis: "camera-dolly-distance-mismatch", details: { keyIndex: index, time: got.time, expectedDistance: want.distance, observedDistance: got.distance } };
  }
  return undefined;
}

function snapshotCountFault(state: LayerState, wanted: number): VerifiedStep | null {
  const position = state.layer.propertyPaths?.find((property) => property.path === DOLLY_POSITION_PATH);
  if (!position || position.keyframeCount === wanted) return null;
  return failedStep(state.request.operation, "camera-dolly-snapshot-key-count-mismatch", { ...layerWhere(state), expectedKeys: wanted, observedKeys: position.keyframeCount ?? null });
}

/** The verdict for dolly_camera. */
export function verifyDollyCamera(state: LayerState): VerifiedStep {
  const kind = state.request.operation;
  const where = layerWhere(state);
  const keys = reportedKeys(state);
  if (!keys) return unverifiedStep(kind, "camera-dolly-keys-not-reported", where);
  const decoded = decode(requestedKeys, state.request.row);
  const wanted = decoded.ok ? (decoded.value.keyframes ?? []) : [];
  if (keys.length !== wanted.length) return failedStep(kind, "camera-dolly-key-count-mismatch", { ...where, expectedKeys: wanted.length, observedKeys: keys.length });
  const finding = keyFinding(keys, wanted);
  if (finding) return failedStep(kind, finding.basis, { ...where, ...finding.details });
  const countFault = snapshotCountFault(state, wanted.length);
  if (countFault) return countFault;
  const evidence = decode(hostEvidence, state.step.row);
  return exactStep(kind, "camera-dolly-axis", { ...where, keys: keys.length, hasPointOfInterest: evidence.ok && evidence.value.hasPointOfInterest === true });
}
