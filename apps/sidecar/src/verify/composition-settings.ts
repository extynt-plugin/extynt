// The verdict for set_composition_settings: the fresh read against each requested field, with the fields only the host's own read carries judged by that read.
import type { JsonObject, JsonValue } from "@extynt/decode";
import { EIGHT_BIT_COLOR_TOLERANCE, sameFrameTime, sameRgbColor, withinTolerance } from "./compare-values.js";
import type { HostStep } from "./host-step.js";
import { hostVerification } from "./host-step.js";
import { listOf } from "./json-fields.js";
import type { SnapshotComposition } from "./snapshot-reply.js";
import { exactStep, failedStep, unverifiedStep } from "./verdicts.js";
import type { VerifiedStep } from "./verdicts.js";

const SHUTTER_TOLERANCE = 0.5;

const EXACT_FIELDS = [
  ["width", "width"],
  ["height", "height"],
  ["pixelAspect", "pixelAspect"],
  ["durationSeconds", "duration"],
  ["frameRate", "frameRate"],
  ["motionBlur", "motionBlur"],
  ["motionBlurSamplesPerFrame", "motionBlurSamplesPerFrame"],
  ["motionBlurAdaptiveSampleLimit", "motionBlurAdaptiveSampleLimit"],
  ["frameBlending", "frameBlending"],
  ["draft3d", "draft3d"],
  ["renderer", "renderer"],
] as const satisfies ReadonlyArray<readonly [string, keyof SnapshotComposition]>;

const TIMELINE_FIELDS = ["motionBlur", "shutterAngle", "shutterPhase", "motionBlurSamplesPerFrame", "motionBlurAdaptiveSampleLimit", "frameBlending", "draft3d", "resolutionFactor", "renderer"] as const satisfies ReadonlyArray<keyof SnapshotComposition>;

const HOST_READ_BACK = "composition-settings-read-back";
const HOST_WRITTEN = "composition-settings-written";

function unreadFields(settings: JsonObject, comp: SnapshotComposition): ReadonlyArray<string> {
  return TIMELINE_FIELDS.filter((field) => settings[field] !== undefined && (comp[field] === undefined || comp[field] === null));
}

function settingsMatch(settings: JsonObject, comp: SnapshotComposition, unread: ReadonlyArray<string>): boolean {
  const given = (field: string): JsonValue | undefined => (unread.includes(field) ? undefined : settings[field]);
  if (EXACT_FIELDS.some(([field, observed]) => given(field) !== undefined && comp[observed] !== given(field))) return false;
  const onGrid = sameFrameTime(comp.workAreaStart, settings.workAreaStart, comp.frameRate) && sameFrameTime(comp.workAreaDuration, settings.workAreaDuration, comp.frameRate);
  return onGrid && withinTolerance(comp.shutterAngle, given("shutterAngle"), SHUTTER_TOLERANCE) && withinTolerance(comp.shutterPhase, given("shutterPhase"), SHUTTER_TOLERANCE);
}

function colorVerdict(kind: string, settings: JsonObject, step: HostStep, comp: SnapshotComposition): VerifiedStep {
  const requested = settings.backgroundColor;
  const ids = { compositionId: comp.id };
  if (requested === undefined) return exactStep(kind, "composition-settings", ids);
  if (!Array.isArray(comp.backgroundColor)) return unverifiedStep(kind, "composition-background-color-not-in-snapshot", { ...ids, ...hostVerification(step) });
  return sameRgbColor(comp.backgroundColor, requested, EIGHT_BIT_COLOR_TOLERANCE) ? exactStep(kind, "composition-settings", ids) : failedStep(kind, "composition-background-color-mismatch", ids);
}

function hostReadVerdict(kind: string, step: HostStep, comp: SnapshotComposition, unread: ReadonlyArray<string>): VerifiedStep {
  const ids = { compositionId: comp.id };
  const trusted = step.verification === HOST_READ_BACK || step.verification === HOST_WRITTEN;
  const differing = trusted ? listOf(step.row.differingSettings) : undefined;
  if (!differing) return unverifiedStep(kind, "composition-timeline-not-in-snapshot", { ...ids, fields: unread });
  const wrong = unread.filter((field) => differing.includes(field));
  if (wrong.length > 0) return failedStep(kind, "composition-settings-mismatch", { ...ids, fields: wrong });
  return step.verification === HOST_READ_BACK ? exactStep(kind, "composition-settings-host-read-back", { ...ids, fields: unread }) : unverifiedStep(kind, "composition-timeline-not-in-snapshot", { ...ids, fields: unread });
}

/** The fresh read against every field the settings ask for; timeline fields the read does not carry are judged by the host's own read. */
export function verifyCompositionSettings(kind: string, settings: JsonObject, step: HostStep, comp: SnapshotComposition): VerifiedStep {
  const unread = unreadFields(settings, comp);
  if (!settingsMatch(settings, comp, unread)) return failedStep(kind, "composition-settings-mismatch", { compositionId: comp.id });
  const color = colorVerdict(kind, settings, step, comp);
  return color.verificationState === "exact" && unread.length > 0 ? hostReadVerdict(kind, step, comp, unread) : color;
}
