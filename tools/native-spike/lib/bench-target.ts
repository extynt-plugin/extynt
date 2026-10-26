/** Chooses which composition path a benchmark targets. */
import { isJsonObject } from "@extynt/decode";
import type { JsonObject, JsonValue } from "@extynt/decode";
import { SpikeError } from "./errors.ts";
import { rowsAt, textAt } from "./json-access.ts";

/** The path read when none is given. */
export const DEFAULT_PATH = "ADBE Transform Group/ADBE Position";

/** The options that steer the choice; everything not given is undefined. */
export interface TargetOptions {
  readonly compId?: string | undefined;
  readonly compName?: string | undefined;
  readonly layerName?: string | undefined;
  readonly layerId?: string | undefined;
  readonly path?: string | undefined;
}

/** The composition, layer and property path the read_comp and read_paths benchmarks aim at. */
export interface BenchTarget {
  readonly compId: string;
  readonly compName: string;
  readonly layerCount: number;
  readonly layerId: string;
  readonly layerName: string;
  readonly path: string;
}

function layerCountOf(comp: JsonObject): number {
  return rowsAt(comp, "layers").length;
}

function pickComposition(compositions: ReadonlyArray<JsonObject>, options: TargetOptions): JsonObject | undefined {
  if (options.compId) return compositions.find((comp) => textAt(comp, "id") === options.compId);
  if (options.compName) return compositions.find((comp) => textAt(comp, "name") === options.compName);
  return compositions.reduce<JsonObject | undefined>((best, comp) => (!best || layerCountOf(comp) > layerCountOf(best) ? comp : best), undefined);
}

function pickLayer(comp: JsonObject, options: TargetOptions): JsonObject | undefined {
  const layers = rowsAt(comp, "layers");
  const { layerName, layerId } = options;
  if (layerId) return layers.find((layer) => textAt(layer, "id") === layerId);
  if (layerName) return layers.find((layer) => textAt(layer, "name") === layerName);
  return layers[0];
}

function missingLayerMessage(comp: JsonObject, { layerId, layerName }: TargetOptions): string {
  const name = textAt(comp, "name");
  if (layerId) return `Composition "${name}" has no layer with id ${layerId}.`;
  if (layerName) return `Composition "${name}" has no layer named "${layerName}".`;
  return `Composition "${name}" has no layers to benchmark.`;
}

function compositionsOf(structureResult: JsonValue | undefined): ReadonlyArray<JsonObject> {
  return isJsonObject(structureResult) ? rowsAt(structureResult, "compositions") : [];
}

function requireComposition(compositions: ReadonlyArray<JsonObject>, options: TargetOptions): JsonObject {
  if (!compositions.length) throw new SpikeError("NO_COMPOSITIONS", "The open project has no compositions to benchmark. Open a project with a composition in After Effects.");
  const comp = pickComposition(compositions, options);
  if (comp) return comp;
  const wanted = options.compId ? `id ${options.compId}` : `name "${options.compName}"`;
  throw new SpikeError("COMP_NOT_FOUND", `No composition with ${wanted} in the project.`);
}

/** Chooses the composition, layer and property path the read_comp / read_paths benchmarks aim at. */
export function chooseTarget(structureResult: JsonValue | undefined, options: TargetOptions): BenchTarget {
  const comp = requireComposition(compositionsOf(structureResult), options);
  const layer = pickLayer(comp, options);
  if (!layer) throw new SpikeError("LAYER_NOT_FOUND", missingLayerMessage(comp, options));
  return {
    compId: textAt(comp, "id") ?? "",
    compName: textAt(comp, "name") ?? "",
    layerCount: layerCountOf(comp),
    layerId: textAt(layer, "id") ?? "",
    layerName: textAt(layer, "name") ?? "",
    path: options.path ?? DEFAULT_PATH,
  };
}
