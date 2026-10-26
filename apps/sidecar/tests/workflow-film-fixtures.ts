// Snapshot builders shared by the film gate and free-run tests: a layer, a composition and a shot layer that places a comp.
import type { CompositionSnapshot } from "@extynt/project-graph";

type Layer = CompositionSnapshot["layers"][number];

/** A drawn, enabled layer of 3 seconds starting at 0, with fields overridden by extra. */
export const layer = (id: string, name: string, extra: Partial<Layer> = {}): Layer => ({ id, index: 1, name, type: "av", enabled: true, shy: false, solo: false, locked: false, startTime: 0, inPoint: 0, outPoint: 3, stretch: 100, parentId: null, matteLayerId: null, matteType: "none", isSelected: false, sourceId: null, properties: [], ...extra });

/** A 1920x1080 25 fps composition holding the layers. */
export const comp = (id: string, name: string, duration: number, layers: Layer[]): CompositionSnapshot => ({ id, name, width: 1920, height: 1080, pixelAspect: 1, duration, frameRate: 25, workAreaStart: 0, workAreaDuration: duration, layers });

/** A 3 second layer starting at `at` that places the composition `source`. */
export const shot = (n: number, at: number, source: string): Layer => layer(`s${n}`, `BAR_${n}`, { compositionSourceId: source, startTime: at, inPoint: at, outPoint: at + 3 });
