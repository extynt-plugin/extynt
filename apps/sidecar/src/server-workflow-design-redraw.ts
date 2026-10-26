/**
 * The designer's one fix: layers it built, drawn again. Each layer is removed and rebuilt in its place, put back just below the layer that was above it, which
 * may itself be one of the redrawn. A layer the designer did not build is refused, so a redraw can never reach the owner's or the user's layers; a layer with a
 * gradient cannot be redrawn in place, and a redraw that does not fit the batch's operation slots and data nodes is refused whole. The placeholder of a redrawn
 * layer is offset by 100 so it never repeats one the first build used.
 */
import { PLAN_UNDO_BATCH_SIZE, plannedSceneLayer, sceneLayerLimitProblem, splitHeavyLayers, type CompiledScene, type CompiledSceneLayer, type PlannedSceneLayer, type SceneBuildTarget } from "@extynt/mcp-server";
import type { WorkflowSpecialistSession } from "./workflow-orchestration.js";
import type { ChatAgentInput } from "./server-chat-agent-types.js";
import { buildTargetOf, designProgress, ensureDesignStage, type DesignBuildPorts } from "./server-workflow-design-build.js";
import { designContext, designLayerId, designSession, type DesignComposition } from "./server-workflow-design-context.js";
import type { DesignDeps } from "./server-workflow-design-receipts.js";
import { refusal, type ToolResult } from "./server-workflow-operation-json.js";
import { BATCH_NODE_BUDGET, jsonNodes, queuedNodes } from "./workflow-batch-nodes.js";
import { compileDesign } from "./workflow-design-compile.js";

type Operations = PlannedSceneLayer["operations"];
type PlacedLayer = { readonly layer: CompiledSceneLayer; readonly index: number; readonly id: string };
type Draft = { readonly session: WorkflowSpecialistSession; readonly scene: CompiledScene; readonly composition: DesignComposition };
type Rebuild = { readonly composition: DesignComposition; readonly build: SceneBuildTarget; readonly placeholders: Map<string, string> };

const REDRAW_PLACEHOLDER_OFFSET = 100;

function quoted(names: readonly string[]): string {
  return names.map((name) => `"${name}"`).join(", ");
}

function foreignRefusal(layers: readonly CompiledSceneLayer[], built: ReadonlySet<string>): ToolResult | undefined {
  const foreign = layers.filter((layer) => !built.has(layer.name));
  if (!foreign.length) return undefined;
  return refusal("DESIGN_LAYER_FOREIGN", `${quoted(foreign.map((layer) => layer.name))} ${foreign.length === 1 ? "is" : "are"} not ${foreign.length === 1 ? "a layer" : "layers"} you built, so nothing was redrawn. You may redraw only: ${[...built].join(", ") || "(none yet)"}.`);
}

function unplacedRefusal(found: ReadonlyArray<{ layer: CompiledSceneLayer; id: string | null }>): ToolResult | undefined {
  const unplaced = found.filter((entry) => !entry.id);
  if (!unplaced.length) return undefined;
  return refusal("DESIGN_LAYER_NOT_FOUND", `${quoted(unplaced.map((entry) => entry.layer.name))} ${unplaced.length === 1 ? "is" : "are"} not exactly once in the composition (a build that has not applied yet, or a duplicate name), so nothing was redrawn.`);
}

function rampRefusal(layers: readonly CompiledSceneLayer[]): ToolResult | undefined {
  const ramped = layers.filter((layer) => layer.ramp);
  if (!ramped.length) return undefined;
  return refusal("DESIGN_LAYER_TOO_COMPLEX", `${quoted(ramped.map((layer) => layer.name))} ${ramped.length === 1 ? "has" : "have"} a gradient and cannot be redrawn in place. Leave ${ramped.length === 1 ? "it" : "them"} as built and say so in your report.`);
}

function stackedAt(composition: DesignComposition, id: string): number {
  return composition.layers.find((item) => item.id === id)?.index ?? 0;
}

function rebuildLayer(rebuild: Rebuild, entry: PlacedLayer): Operations | ToolResult {
  const { composition, build, placeholders } = rebuild;
  const planned = plannedSceneLayer(entry.layer, REDRAW_PLACEHOLDER_OFFSET + entry.index, build);
  const problem = sceneLayerLimitProblem(planned);
  if (problem) return refusal("DESIGN_LAYER_TOO_COMPLEX", problem);
  placeholders.set(entry.id, planned.placeholder);
  const position = stackedAt(composition, entry.id);
  const aboveId = position > 1 ? composition.layers.find((item) => item.index === position - 1 && item.id)?.id : undefined;
  const removal = { type: "remove_layer", destructive: true, target: { compositionId: composition.id, layerId: entry.id } };
  if (aboveId === undefined) return [removal, ...planned.operations];
  const reorder = { type: "reorder_layer", target: { compositionId: composition.id, layerId: planned.placeholder }, placement: "after", referenceLayerId: placeholders.get(aboveId) ?? aboveId };
  return [removal, ...planned.operations, reorder];
}

function redrawOperations(composition: DesignComposition, found: readonly PlacedLayer[]): Operations | ToolResult {
  const rebuild: Rebuild = { composition, build: buildTargetOf(composition), placeholders: new Map() };
  const operations: Operations = [];
  for (const entry of [...found].sort((a, b) => stackedAt(composition, a.id) - stackedAt(composition, b.id))) {
    const rebuilt = rebuildLayer(rebuild, entry);
    if (!Array.isArray(rebuilt)) return rebuilt;
    operations.push(...rebuilt);
  }
  return operations;
}

function redrawDraft(deps: DesignDeps, input: ChatAgentInput, svg: string): Draft | ToolResult {
  const session = designSession(deps, input);
  const snapshot = deps.planState.normalizedLatest();
  if (!session?.design || !snapshot) return refusal("DESIGN_UNAVAILABLE", "Build a drawing first: there is nothing of yours to redraw.");
  const compiled = compileDesign(svg, snapshot, deps.state.now, session.target);
  if (!compiled.ok) return refusal("DRAWING_INVALID", compiled.message);
  const context = designContext(deps, input, true);
  if ("ok" in context) return context;
  const { composition } = context, { scene } = compiled.design;
  if (scene.width !== composition.width || scene.height !== composition.height) return refusal("COMPOSITION_SIZE_MISMATCH", `The redraw is ${scene.width}×${scene.height} but the composition is ${composition.width}×${composition.height}. Use the same viewBox as the drawing.`);
  return { session, scene, composition };
}

function budgetRefusal(deps: DesignDeps, ports: DesignBuildPorts, operations: Operations): ToolResult | undefined {
  const slots = PLAN_UNDO_BATCH_SIZE - ports.queued(), nodes = BATCH_NODE_BUDGET - queuedNodes(deps);
  if (operations.length <= slots && jsonNodes(operations) <= nodes) return undefined;
  return refusal("WORKFLOW_BATCH_BOUND", `The redraw needs ${operations.length} operations and does not fit in what this batch has left (${slots} operation slots, ${nodes} data nodes). Redraw fewer layers.`);
}

function placedLayers(found: ReadonlyArray<{ layer: CompiledSceneLayer; index: number; id: string | null }>): PlacedLayer[] {
  return found.flatMap((entry) => (entry.id === null ? [] : [{ layer: entry.layer, index: entry.index, id: entry.id }]));
}

interface RedrawPlan { readonly names: string[]; readonly operations: Operations }

function planRedraw(deps: DesignDeps, input: ChatAgentInput, work: { svg: string; ports: DesignBuildPorts }): RedrawPlan | ToolResult {
  const draft = redrawDraft(deps, input, work.svg);
  if ("ok" in draft) return draft;
  const { composition, scene, session } = draft;
  const layers = splitHeavyLayers(scene.layers);
  const found = layers.map((layer, index) => ({ layer, index, id: designLayerId(deps, input, { composition, name: layer.name }) }));
  const blocked = foreignRefusal(layers, new Set(session.designBuilt ?? [])) ?? unplacedRefusal(found) ?? rampRefusal(layers);
  if (blocked) return blocked;
  const operations = redrawOperations(composition, placedLayers(found));
  if (!Array.isArray(operations)) return operations;
  return budgetRefusal(deps, work.ports, operations) ?? { names: layers.map((layer) => layer.name), operations };
}

/** Redraws the designer's own layers from the SVG of the revised groups, each in place; the refusal when a layer is not the designer's, not exactly once in the composition, has a gradient, or does not fit the batch. */
export async function redrawDesignTool(deps: DesignDeps, input: ChatAgentInput, svg: string, ports: DesignBuildPorts): Promise<ToolResult> {
  const plan = planRedraw(deps, input, { svg, ports });
  if ("ok" in plan) return plan;
  const staged = await ensureDesignStage(ports, plan.names, plan.operations);
  if (staged) return staged;
  return designProgress(await ports.queue({ summary: `Redraw the designed layers: ${plan.names.join(", ")}`.slice(0, 240), operations: plan.operations, finish: true }), { redrawn: plan.names });
}
