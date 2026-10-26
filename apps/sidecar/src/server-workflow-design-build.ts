/**
 * ae_queue_design: the visual-scene designer's compiled drawing, queued as native shape layers a whole layer at a time. The designer calls it for itself
 * (and redraws its own layers in server-workflow-design-redraw.ts); the owner finds the layers built. A call queues whole layers while the batch's operation
 * slots and data nodes last, through the owner's own queue path so the build passes every preflight a hand-authored batch does. The designer builds in a batch
 * of its own: `inOwnBatch` sets the owner's open batch aside, puts it back afterwards and makes the owner's queue calls wait for the designer's seal.
 */
import { PLAN_UNDO_BATCH_SIZE, plannedSceneLayer, sceneLayerLimitProblem, splitHeavyLayers, type CompiledSceneLayer, type PlannedSceneLayer, type SceneBuildTarget } from "@extynt/mcp-server";
import { WORKFLOW_STAGE_TOOL } from "./agent.js";
import type { ToolArguments } from "./agent-types.js";
import type { JsonObject } from "@extynt/decode";
import type { AgentCallState, ChatAgentDeps, ChatAgentInput } from "./server-chat-agent-types.js";
import { clearOwnerBatchAside, designContext, designLayerId, designSession, setOwnerBatchAside, type DesignComposition, type DesignContext } from "./server-workflow-design-context.js";
import { bringOwnerBatchForward, openPlanOf, operationsOf, type DesignDeps } from "./server-workflow-design-receipts.js";
import { argumentJson, listOf, namesOf, payload, payloadOrWrapped, refusal, textOf, type Run, type ToolResult } from "./server-workflow-operation-json.js";
import { queuedWorkflowOperations } from "./server-workflow-queue-boundary.js";
import { BATCH_NODE_BUDGET, jsonNodes, queuedNodes } from "./workflow-batch-nodes.js";

/** The owner's own queue path, so the build passes every preflight a hand-authored batch does. */
export interface DesignBuildPorts {
  readonly queued: () => number;
  readonly hasStage: () => boolean;
  readonly builder: boolean;
  readonly selectStage: (args: ToolArguments) => Promise<ToolResult>;
  readonly queue: (args: ToolArguments) => Promise<ToolResult>;
}

type Packing = { readonly drawing: ReturnType<typeof designSession>; readonly planned: readonly PlannedSceneLayer[]; readonly skipped: readonly string[] };

const BEYOND_DRAWING = "The drawing carries geometry and paint only. Before calling the job done, queue natively with ae_queue_add whatever the request asks beyond it: shape items such as repeaters or trim paths (add_shape_item), effects such as blur, glow or ramps, layer styles, text layers and their animators with their selector keyframes, mattes, expressions, parenting, cameras, markers and template properties.";
const queueLocks = new WeakMap<DesignDeps["state"], Promise<void>>();

function requestedNames(args: ToolArguments): string[] | undefined {
  const layers = argumentJson(args, "layers");
  return Array.isArray(layers) ? namesOf(layers).slice(0, 48) : undefined;
}

function candidateLayers(layers: readonly CompiledSceneLayer[], requested: string[] | undefined, taken: { existing: ReadonlySet<string>; built: ReadonlySet<string> }): { layers: CompiledSceneLayer[]; unknown: string[]; skipped: string[] } {
  const { existing, built } = taken;
  if (requested) return { layers: layers.filter((layer) => requested.includes(layer.name) && !built.has(layer.name)), unknown: requested.filter((name) => !layers.some((layer) => layer.name === name)), skipped: requested.filter((name) => built.has(name)) };
  return { layers: layers.filter((layer) => !existing.has(layer.name)), unknown: [], skipped: layers.filter((layer) => existing.has(layer.name)).map((layer) => layer.name) };
}

function packLayers(planned: readonly PlannedSceneLayer[], budget: { slots: number; nodes: number }): PlannedSceneLayer[] {
  const packed: PlannedSceneLayer[] = [];
  let used = 0, nodes = 0;
  for (const entry of planned) {
    const weight = jsonNodes(entry.operations);
    if (used + entry.operations.length > budget.slots || nodes + weight > budget.nodes) break;
    packed.push(entry);
    used += entry.operations.length;
    nodes += weight;
  }
  return packed;
}

function queuedLayerNames(deps: DesignDeps): string[] {
  const open = openPlanOf(deps);
  return (open ? operationsOf(open) : []).flatMap((operation) => (operation.type === "create_layer" ? textOf(operation.name) ?? [] : []));
}

function rejectedQueue(data: JsonObject | undefined): ToolResult | undefined {
  if (!data || !listOf(data.fix).length) return undefined;
  return refusal("DESIGN_QUEUE_REJECTED", `The compiled scene batch was refused and no layers were queued. ${String(data.next ?? "Review the queue validation findings.")}`);
}

/** The queue's answer with the design's progress added, or the refusal when the queue named operations to fix. */
export function designProgress(result: ToolResult, detail: JsonObject): ToolResult {
  if (!result.ok) return result;
  return rejectedQueue(payload(result)) ?? { ...result, data: { ...payloadOrWrapped(result), design: detail } };
}

/** Selects the build's stage unless the call already runs under one; the refusal when the stage is refused. */
export async function ensureDesignStage(ports: DesignBuildPorts, names: readonly string[], operations: PlannedSceneLayer["operations"]): Promise<ToolResult | undefined> {
  if (ports.hasStage()) return undefined;
  const staged = await ports.selectStage({ summary: `Build the designed scene: ${names.join(", ")}`.slice(0, 240), operationTypes: [...new Set(operations.map((operation) => String(operation.type)))] });
  return staged.ok ? undefined : staged;
}

/** Where a scene is built: the composition, its centre and its size. */
export function buildTargetOf(composition: DesignComposition): SceneBuildTarget {
  return { compositionId: composition.id, center: [composition.width / 2, composition.height / 2], size: [composition.width, composition.height] };
}

function nothingLeft(context: DesignContext, skipped: string[], built: readonly string[]): ToolResult {
  const named = skipped.length ? skipped : context.layers.map((layer) => layer.name);
  const why = built.length ? "were built by the designer" : "already exist in the composition or are queued in this batch";
  return { ok: true, tool: "ae_queue_design", snapshotFingerprint: context.fingerprint, data: { queued: 0, design: { built: [], remaining: [], skipped, next: `Nothing was queued: ${named.join(", ")} ${why}. Animate them by these names. Seal what is queued, then capture a frame and compare it with the design. ${BEYOND_DRAWING}` } } };
}

function nextStep(remaining: readonly string[]): string {
  return remaining.length ? `Seal this batch with ae_queue_finish. Once it has applied, the sidecar queues and seals the rest of the drawing itself (${remaining.join(", ")}); do not call ae_queue_design for them.` : `Seal with ae_queue_finish, then capture a frame and compare it with the design. ${BEYOND_DRAWING}`;
}

function unknownLayers(unknown: readonly string[], layers: readonly CompiledSceneLayer[]): ToolResult {
  return refusal("DESIGN_LAYER_UNKNOWN", `The drawing has no layer named ${unknown.map((name) => `"${name}"`).join(", ")}. Its layers, bottom to top: ${layers.map((layer) => layer.name).join(", ")}.`);
}

function layerLimitRefusal(planned: readonly PlannedSceneLayer[]): ToolResult | undefined {
  for (const entry of planned) {
    const problem = sceneLayerLimitProblem(entry);
    if (problem) return refusal("DESIGN_LAYER_TOO_COMPLEX", problem);
  }
  return undefined;
}

async function packAndQueue(deps: DesignDeps, scope: Packing, ports: DesignBuildPorts): Promise<ToolResult> {
  const { drawing, planned, skipped } = scope;
  const budget = { slots: PLAN_UNDO_BATCH_SIZE - ports.queued(), nodes: BATCH_NODE_BUDGET - queuedNodes(deps) };
  const packed = packLayers(planned, budget);
  if (!packed.length) return refusal("WORKFLOW_BATCH_BOUND", `The next layer, "${planned[0]?.layer.name}", does not fit in what this batch has left (${budget.slots} operation slots, ${budget.nodes} data nodes). Seal this batch with ae_queue_finish, then call ae_queue_design in the next cycle.`);
  const names = packed.map((entry) => entry.layer.name), operations = packed.flatMap((entry) => entry.operations);
  const staged = await ensureDesignStage(ports, names, operations);
  if (staged) return staged;
  const remaining = planned.slice(packed.length).map((entry) => entry.layer.name);
  const result = await ports.queue({ summary: `Build the designed scene: ${names.join(", ")}`.slice(0, 240), operations });
  const answered = designProgress(result, { built: names, remaining, skipped: [...skipped], next: nextStep(remaining) });
  if (answered.ok && drawing) drawing.designBuilt = [...(drawing.designBuilt ?? []), ...names];
  return answered;
}

function planDesign(deps: DesignDeps, input: ChatAgentInput, work: { args: ToolArguments; builder: boolean }): Packing | ToolResult {
  const drawing = designSession(deps, input);
  const context = designContext(deps, input, work.builder);
  if ("ok" in context) return context;
  const { layers, composition } = context;
  const builtNames = drawing?.designBuilt ?? [];
  const built = new Set(builtNames);
  const existing = new Set([...composition.layers.map((layer) => layer.name), ...queuedLayerNames(deps), ...built]);
  const choice = candidateLayers(layers, requestedNames(work.args), { existing, built });
  if (choice.unknown.length) return unknownLayers(choice.unknown, layers);
  if (!choice.layers.length) return nothingLeft(context, choice.skipped, builtNames);
  const build = buildTargetOf(composition);
  const planned = choice.layers.map((layer) => plannedSceneLayer(layer, layers.indexOf(layer), build));
  return layerLimitRefusal(planned) ?? { drawing, planned, skipped: choice.skipped };
}

/** Queues the drawing's layers (those named in `layers`, else those not yet in the composition or the batch) as whole layers in one call, or says why none can be. */
export async function queueDesignTool(deps: DesignDeps, input: ChatAgentInput, args: ToolArguments, ports: DesignBuildPorts): Promise<ToolResult> {
  const plan = planDesign(deps, input, { args, builder: ports.builder });
  return "ok" in plan ? plan : packAndQueue(deps, plan, ports);
}

/** Names of the drawing's layers that are neither in the composition nor queued: what the sidecar still has to build once ae_queue_design has begun building it. Empty otherwise, and empty for an owner that drew the scene by hand. */
export function remainingDesignLayers(deps: DesignDeps, input: ChatAgentInput): string[] {
  const session = designSession(deps, input);
  if (!session?.design || session.pending || !session.designBuilt?.length) return [];
  const context = designContext(deps, input);
  if ("ok" in context) return [];
  const existing = new Set([...context.composition.layers.map((layer) => layer.name), ...queuedLayerNames(deps), ...session.designBuilt]);
  return context.layers.filter((layer) => !existing.has(layer.name)).map((layer) => layer.name);
}

/** The ports the designer's build and redraw queue through: the owner's own queue path, run with the designer's call state. */
export function designPorts(deps: ChatAgentDeps, state: Pick<AgentCallState, "workflowStage" | "designer">, run: Run): DesignBuildPorts {
  return { queued: () => queuedWorkflowOperations(deps), hasStage: () => !!state.workflowStage, builder: state.designer === true, selectStage: (stage) => run(WORKFLOW_STAGE_TOOL, stage), queue: (queued) => run("ae_queue_add", queued) };
}

/** What the designer built, bottom to top, with the id each layer has in the composition now (null until it applies), and the composition they sit in. */
export function builtDesignLayers(deps: DesignDeps, input: ChatAgentInput): { composition?: { id: string; name: string }; layers: Array<{ name: string; id: string | null }> } {
  const session = designSession(deps, input);
  if (!session?.design) return { layers: [] };
  const context = designContext(deps, input, true);
  const composition = "ok" in context ? undefined : context.composition;
  const built = new Set(session.designBuilt ?? []);
  const layers = splitHeavyLayers(session.design.scene.layers).filter((layer) => built.has(layer.name)).map((layer) => ({ name: layer.name, id: designLayerId(deps, input, { composition, name: layer.name }) }));
  return { ...(composition ? { composition: { id: composition.id, name: composition.name } } : {}), layers };
}

function lockQueue(deps: DesignDeps, before: Promise<void>): () => void {
  let release: () => void = () => undefined;
  queueLocks.set(deps.state, before.then(() => new Promise<void>((resolve) => { release = resolve; })));
  return () => release();
}

function restoreOwnerBatch(deps: DesignDeps, owners: string | null): void {
  const held = owners ? deps.state.plans.get(owners)?.status : undefined;
  deps.state.openQueuePlanId = held === "draft" || held === "prepared" || held === "presented" ? owners : null;
  clearOwnerBatchAside(deps);
}

/**
 * Runs the designer's queue work in a batch of its own: the owner's open batch is set aside (untouched, its operations still queued) and put back
 * afterwards, and the owner's own queue calls wait for the designer's seal, so no seal ever mixes the two. Designer sections run one at a time. The owner's
 * batch comes back only if it can still be added to: one sealed, approved or cancelled meanwhile is closed, and the pointer must not name it.
 */
export async function inOwnBatch<T>(deps: DesignDeps, work: () => Promise<T>, input: ChatAgentInput): Promise<T> {
  const before = queueLocks.get(deps.state) ?? Promise.resolve();
  const release = lockQueue(deps, before);
  await before;
  const owners = deps.state.openQueuePlanId;
  deps.state.openQueuePlanId = null;
  setOwnerBatchAside(deps, owners);
  try {
    return await work();
  } finally {
    restoreOwnerBatch(deps, owners);
    try {
      bringOwnerBatchForward(deps, input);
    } finally {
      release();
    }
  }
}

/** The owner's queue calls wait here while a designer's batch is being built and sealed; a project read that caught up since is reconciled before they run. */
export async function afterDesignerBatch(deps: DesignDeps, input: ChatAgentInput): Promise<void> {
  await queueLocks.get(deps.state);
  bringOwnerBatchForward(deps, input);
}
