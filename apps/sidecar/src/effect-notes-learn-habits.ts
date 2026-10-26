// Reads the keyframe span and easing a verified animate step spelled out, as one habit sample per animated property.
import { CURVE_PRESETS } from "@extynt/action-plan";
import type { Operation } from "@extynt/action-plan";
import { decode, decodeOrThrow, type JsonValue } from "@extynt/decode";
import { mostCommon } from "./effect-notes-habits.js";
import { keyframeOrNone, stepFacts, type KeyframeFacts, type StepFacts } from "./effect-notes-plan-facts.js";
import type { HabitSampleInput } from "./effect-notes-types.js";

interface AppliedStep { operation: Operation; layerId: string; propertyPath: string | undefined }

interface Easing { label: string; influence: number | null }

const PARADE = "ADBE Effect Parade";
const MAX_KIND_LENGTH = 64;
const EASY_INFLUENCE = 33.33;
const INFLUENCE_SLACK = 1;
const CURVE_SLACK = 0.01;
const INFLUENCE_RANGE = { min: 0.1, max: 100 } as const;
const NONE: Easing = { label: "default", influence: null };
const EASE_NAMES = /^EASE(_IN)?(_OUT)?$/;
const SIBLING_SUFFIX = /#\d+$/;
const HOST_PREFIX = /^ADBE\s+/;

function present(values: ReadonlyArray<number | undefined>): number[] {
  return values.flatMap((value) => value ?? []);
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clampInfluence(value: number): number {
  return Math.min(INFLUENCE_RANGE.max, Math.max(INFLUENCE_RANGE.min, value));
}

function lastSegment(propertyPath: string | undefined, role: string | undefined): string | undefined {
  return propertyPath?.split("/").filter(Boolean).pop() ?? role?.split(".").pop();
}

/** The kind of property an animation drives, read from its path and nothing else: effect controls are one kind; any other property is its own last path segment, the host's `ADBE ` prefix and `#N` sibling suffix dropped. No list of effects or properties is kept. */
export function propertyKindOf(propertyPath: string | undefined, role: string | undefined): string | undefined {
  if (propertyPath?.split("/")[0] === PARADE) return "effect control";
  const kind = lastSegment(propertyPath, role)?.replace(SIBLING_SUFFIX, "").replace(HOST_PREFIX, "").replace(/\s+/g, " ").trim().toLowerCase();
  return kind && kind.length <= MAX_KIND_LENGTH ? kind : undefined;
}

type Ease = NonNullable<KeyframeFacts["ease"]>;

function explicitEase(ease: Ease): Easing | undefined {
  const specs = [...ease.in, ...ease.out], influences = present(specs.map((spec) => spec.influence)), speeds = present(specs.map((spec) => spec.speed));
  if (influences.length === 0) return undefined;
  const easy = speeds.length === specs.length && speeds.every((speed) => Math.abs(speed) < 1e-6) && influences.every((value) => Math.abs(value - EASY_INFLUENCE) <= INFLUENCE_SLACK);
  return easy ? { label: "easy-ease", influence: null } : { label: "bezier", influence: clampInfluence(mean(influences)) };
}

type Points = { x1: number | undefined; y1: number | undefined; x2: number | undefined; y2: number | undefined };

function sameCurve(points: Points, preset: { x1: number; y1: number; x2: number; y2: number }): boolean {
  return (["x1", "y1", "x2", "y2"] as const).every((key) => { const value = points[key]; return value !== undefined && Math.abs(value - preset[key]) <= CURVE_SLACK; });
}

function pointsEasing(points: Points): Easing | undefined {
  if (points.x1 === undefined || points.x2 === undefined) return undefined;
  const named = Object.entries(CURVE_PRESETS).find(([, preset]) => sameCurve(points, preset));
  return named ? { label: named[0], influence: null } : { label: "bezier", influence: clampInfluence((points.x1 + (1 - points.x2)) * 50) };
}

function curveEasing(curve: NonNullable<KeyframeFacts["curve"]>): Easing | undefined {
  if (typeof curve === "string") return Object.hasOwn(CURVE_PRESETS, curve) ? { label: curve, influence: null } : undefined;
  return pointsEasing(curve);
}

function interpolationEasing(interpolation: NonNullable<KeyframeFacts["interpolation"]>): Easing | undefined {
  const raw = interpolation.outType ?? interpolation.inType;
  if (raw === undefined) return undefined;
  const name = raw.toUpperCase().trim().replace(/[-\s]+/g, "_");
  if (name === "LINEAR" || name === "HOLD" || name === "BEZIER") return { label: name.toLowerCase(), influence: null };
  return EASE_NAMES.test(name) ? { label: "ease", influence: null } : undefined;
}

function keyframeEasing(keyframe: KeyframeFacts): Easing | undefined {
  const explicit = keyframe.ease ? explicitEase(keyframe.ease) : undefined;
  if (explicit) return explicit;
  const curve = keyframe.curve ? curveEasing(keyframe.curve) : undefined;
  return curve ?? (keyframe.interpolation ? interpolationEasing(keyframe.interpolation) : undefined);
}

function easingFromFacts(keyframes: readonly KeyframeFacts[]): Easing {
  const spelled = keyframes.slice(0, -1).flatMap((keyframe, index) => { const easing = keyframeEasing(keyframe); return easing ? [{ easing, at: index }] : []; });
  const label = mostCommon(spelled.map((entry) => ({ value: entry.easing.label, at: entry.at })));
  if (label === undefined) return NONE;
  const influences = spelled.filter((entry) => entry.easing.label === label).flatMap((entry) => entry.easing.influence ?? []);
  return { label, influence: influences.length ? mean(influences) : null };
}

/** The easing the plan spelled out on most of its segments (the last keyframe starts no segment), or `default` when it spelled none out. */
export function easingOf(keyframes: readonly JsonValue[]): Easing {
  return easingFromFacts(keyframes.map((keyframe) => decodeOrThrow(keyframeOrNone, keyframe)));
}

function sampleFrom(planId: string, step: { operation: StepFacts; layerId: string; propertyPath: string | undefined }): HabitSampleInput | undefined {
  const { operation } = step, type = operation.type;
  if (type !== "animate_property" && type !== "animate_control") return undefined;
  const timed = operation.keyframes.filter((keyframe) => keyframe.time !== undefined), times = present(timed.map((keyframe) => keyframe.time)), propertyKind = propertyKindOf(step.propertyPath, operation.role);
  if (timed.length < 2 || propertyKind === undefined) return undefined;
  const duration = Math.round((Math.max(...times) - Math.min(...times)) * 1000) / 1000, easing = easingFromFacts(timed);
  if (!(duration > 0)) return undefined;
  return { planId, slot: `${step.layerId}|${step.propertyPath ?? propertyKind}`, propertyKind, duration, keyframes: timed.length, easing: easing.label, influence: easing.influence };
}

/** One sample per applied animate_property / animate_control step with at least two keyframes: its property kind, first-to-last keyframe span in seconds, keyframe count and easing. */
export function habitSampleOf(planId: string, step: AppliedStep): HabitSampleInput | undefined {
  const operation = decode(stepFacts, step.operation);
  return operation.ok ? sampleFrom(planId, { ...step, operation: operation.value }) : undefined;
}
