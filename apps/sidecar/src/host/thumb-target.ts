// What a before or after thumbnail is a picture of: the first composition a plan's operations name, at its current time, from
// the snapshot the sidecar already holds. Pure; nothing here asks After Effects anything.
import { array, decode, decodeOrThrow, fallback, map, number, object, string, union } from "@extynt/decode";
import type { Decoder, Infer } from "@extynt/decode";
import type { Background } from "../capture/png-fit.js";
import { reachOf } from "../apply-read-spec.js";
import type { ProbeSnapshot } from "../server-types.js";
import type { Opaque } from "../snapshot-view.js";

/** The frame a thumbnail shows: which composition, how large the host captures it, when, and the background to flatten it over. */
export interface ThumbTarget { compositionId: string; name: string; width: number; height: number; time: number; background: Background | null }

interface Clock { activeCompositionId: string | null; currentTime: number | null }

const seconds = fallback(number({ min: 0 }), null);
const dimension = fallback(number({ int: true, min: 16, max: 4096 }), 0);
const channel = fallback(map(number(), (level) => Math.max(0, Math.min(1, level))), -1);

function backgroundFrom(channels: readonly number[]): Background | null {
  const [red, green, blue] = channels;
  return red === undefined || green === undefined || blue === undefined || Math.min(red, green, blue) < 0 ? null : [red, green, blue];
}

const background: Decoder<Background | null> = fallback(map(array(channel), backgroundFrom), null);
const compositionShape = object({
  id: map(union(string(), number()), String),
  name: fallback(map(string(), (name) => name.slice(0, 120)), ""),
  width: dimension,
  height: dimension,
  currentTime: seconds,
  duration: fallback(number(), null),
  frameRate: fallback(number(), null),
  backgroundColor: background,
});
type Composition = Infer<typeof compositionShape>;

const NO_CLOCK: Clock = { activeCompositionId: null, currentTime: null };
const clockShape: Decoder<Clock> = fallback(object({ activeCompositionId: fallback(string(), null), currentTime: seconds }), NO_CLOCK);

function withinComposition(time: number, composition: Composition): number {
  const { duration, frameRate } = composition;
  if (duration === null || duration <= 0) return time;
  const frame = frameRate !== null && frameRate > 0 ? 1 / frameRate : 0.001;
  return Math.max(0, Math.min(time, duration - frame));
}

function timeOf(composition: Composition, clock: Clock): number {
  const active = clock.activeCompositionId === composition.id ? clock.currentTime : null;
  return withinComposition(composition.currentTime ?? active ?? 0, composition);
}

function compositionNamed(compositions: ReadonlyArray<Opaque>, id: string): Composition | undefined {
  for (const entry of compositions) {
    const decoded = decode(compositionShape, entry);
    if (decoded.ok && decoded.value.id === id) return decoded.value;
  }
  return undefined;
}

/** The frame worth showing for `operations`, or null when they change nothing a frame shows, reframe it, or name no composition the snapshot holds. */
export function thumbTargetFor(operations: Opaque, snapshot: ProbeSnapshot): ThumbTarget | null {
  const reach = reachOf(operations, snapshot), id = reach.compositionIds[0];
  const composition = reach.picture && id !== undefined ? compositionNamed(snapshot.result.compositions, id) : undefined;
  if (!composition || !composition.width || !composition.height) return null;
  const time = timeOf(composition, decodeOrThrow(clockShape, snapshot.result));
  return { compositionId: composition.id, name: composition.name, width: composition.width, height: composition.height, time, background: composition.backgroundColor };
}
