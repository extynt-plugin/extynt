// Temporal eases for the arc-path solver: per-key speeds that make a speed profile smooth between keys instead of stepping from one segment to the next.
import { round3 } from "./types.js";
import type { SolvedKeyframe, SpeedProfile } from "./types.js";

/** Where the keys sit along the path: `travelled` is the distance at each key from the first (composition pixels), `progress` the same as a fraction of the whole. */
export interface ArcDistances {
  readonly travelled: ReadonlyArray<number>;
  readonly progress: ReadonlyArray<number>;
}

const ONE_THIRD_INFLUENCE = 100 / 3;
const BEZIER_BOTH = { inType: "BEZIER", outType: "BEZIER" } as const;

const SPEED_FACTOR: Readonly<Record<Exclude<SpeedProfile, "constant">, (progress: number) => number>> = {
  accelerate: (progress) => 2 * Math.sqrt(progress),
  decelerate: (progress) => 2 * Math.sqrt(1 - progress),
  "ease-in-out": (progress) => Math.sqrt(8 * Math.min(progress, 1 - progress)),
};

function ease(speed: number): { readonly speed: number; readonly influence: number } {
  return { speed: round3(speed), influence: round3(ONE_THIRD_INFLUENCE) };
}

function pathSpeeds(profile: Exclude<SpeedProfile, "constant">, distances: ArcDistances, duration: number): ReadonlyArray<number> {
  const total = distances.travelled.at(-1) ?? 0;
  return distances.progress.map((progress) => (total / duration) * SPEED_FACTOR[profile](Math.min(1, Math.max(0, progress))));
}

function rotationRate(rotations: ReadonlyArray<number>, distances: ArcDistances, from: number): number {
  const turn = (rotations[from + 1] ?? 0) - (rotations[from] ?? 0);
  const distance = (distances.travelled[from + 1] ?? 0) - (distances.travelled[from] ?? 0);
  return distance > 0 ? turn / distance : 0;
}

/**
 * The Position and Rotation keys with temporal eases that follow the speed profile. Each profile is a quadratic in distance over time, so a
 * one-third influence on both sides (a cubic Hermite curve) with the profile's exact speed at each key reproduces it smoothly between keys.
 * A constant profile is returned unchanged: its linear keys are already exact.
 */
export function easedArcKeys(
  keys: { readonly position: ReadonlyArray<SolvedKeyframe>; readonly rotation?: ReadonlyArray<SolvedKeyframe> },
  timing: { readonly profile: SpeedProfile; readonly distances: ArcDistances; readonly duration: number },
): { readonly position: ReadonlyArray<SolvedKeyframe>; readonly rotation?: ReadonlyArray<SolvedKeyframe> } {
  const { profile, distances, duration } = timing;
  if (profile === "constant") return keys;
  const speeds = pathSpeeds(profile, distances, duration);
  const position = keys.position.map((keyframe, index) => ({ ...keyframe, interpolation: BEZIER_BOTH, ease: { in: ease(speeds[index] ?? 0), out: ease(speeds[index] ?? 0) } }));
  if (!keys.rotation) return { position };
  const rotations = keys.rotation.map((keyframe) => (typeof keyframe.value === "number" ? keyframe.value : 0));
  const last = rotations.length - 1;
  const rotation = keys.rotation.map((keyframe, index) => {
    const incoming = rotationRate(rotations, distances, Math.max(0, index - 1));
    const outgoing = rotationRate(rotations, distances, Math.min(last - 1, index));
    return { ...keyframe, interpolation: BEZIER_BOTH, ease: { in: ease((speeds[index] ?? 0) * incoming), out: ease((speeds[index] ?? 0) * outgoing) } };
  });
  return { position, rotation };
}
