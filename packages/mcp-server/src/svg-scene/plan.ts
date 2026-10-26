// A compiled scene as plan operations: the layer splitting, per-layer operation lists and size limits the panel's ae_queue_design and an MCP client's ae_propose_plan {svg} share.
import { PLAN_UNDO_BATCH_SIZE } from "@extynt/host-ae";
import { jsonOf } from "../json.js";
import { isJsonArray, isJsonObject } from "@extynt/decode";
import type { JsonObject, JsonValue } from "@extynt/decode";
import { companionSolidPlaceholder, designPlaceholder, sceneLayerOperations, type SceneBuildTarget } from "./operations.js";
import type { CompiledSceneLayer } from "./scene.js";

function nodesOf(value: JsonValue): number {
  if (isJsonArray(value)) return 1 + value.reduce<number>((sum, child) => sum + nodesOf(child), 0);
  if (isJsonObject(value)) return 1 + Object.values(value).reduce<number>((sum, child) => sum + nodesOf(child), 0);
  return 1;
}

/** Nodes as the workflow engine counts them: every value, container or scalar, is one. */
export function jsonNodes<T>(value: T): number {
  return nodesOf(jsonOf(value));
}

/** What one batch's operations may spend: the workflow engine's admission bound (4096 nodes) less its envelope (1024). The sidecar test pins this to its BATCH_NODE_BUDGET. */
export const SCENE_BATCH_NODE_BUDGET = 3_072;

/** Room one drawn layer's shapes may take, leaving the rest of the batch budget for its create, transform and effect operations. */
export const LAYER_SHAPE_NODES = SCENE_BATCH_NODE_BUDGET - 512;

/** A drawn layer too heavy for one batch becomes sibling layers ("Stars", "Stars 2", …) with the same placement, so each fits; the picture is the same. A gradient layer is left whole: its companion solid cannot be split, and the build refuses it instead. */
export function splitHeavyLayers(layers: readonly CompiledSceneLayer[]): CompiledSceneLayer[] {
  return layers.flatMap((layer) => {
    const nodes = nodesOf(jsonOf(layer.shapes));
    if (nodes <= LAYER_SHAPE_NODES || layer.ramp || layer.shapes.length < 2) return [layer];
    const parts = Math.min(layer.shapes.length, Math.ceil(nodes / LAYER_SHAPE_NODES)), size = Math.ceil(layer.shapes.length / parts);
    return Array.from({ length: Math.ceil(layer.shapes.length / size) }, (_, part) => ({ ...layer, name: part ? `${layer.name} ${part + 1}` : layer.name, shapes: layer.shapes.slice(part * size, (part + 1) * size) }));
  });
}

/** A layer with the placeholder it is built under and the operations that build it. */
export type PlannedSceneLayer = { readonly layer: CompiledSceneLayer; readonly placeholder: string; readonly operations: JsonObject[] };

/** One layer's operations; `index` is its place in the split layer list, which makes its placeholder unique. */
export function plannedSceneLayer(layer: CompiledSceneLayer, index: number, build: SceneBuildTarget): PlannedSceneLayer {
  const placeholder = designPlaceholder(layer.name, index);
  const solid = layer.ramp ? companionSolidPlaceholder(layer.name, index) : undefined;
  return { layer, placeholder, operations: sceneLayerOperations(layer, placeholder, build, solid) };
}

/** Why one layer cannot be built whole, in the compiler's voice; undefined when it fits a batch. */
export function sceneLayerLimitProblem(entry: PlannedSceneLayer): string | undefined {
  if (entry.operations.length > PLAN_UNDO_BATCH_SIZE) return `"${entry.layer.name}" needs ${entry.operations.length} native operations, but one layer must fit in a ${PLAN_UNDO_BATCH_SIZE}-operation batch. Simplify its clip path subpaths or effects and revise the drawing.`;
  const nodes = nodesOf(entry.operations);
  if (nodes > SCENE_BATCH_NODE_BUDGET) return `"${entry.layer.name}" is ${nodes} data nodes, but one layer must fit in a batch of ${SCENE_BATCH_NODE_BUDGET}. Ask the designer to redraw it with fewer shapes or path vertices (for many identical marks, one shape with a repeater).`;
  return undefined;
}
