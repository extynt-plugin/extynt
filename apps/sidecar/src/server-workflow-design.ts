/**
 * The design gates of a workflow job. Rule 1: artwork is not queued by hand before the job has a scene design (the visual-scene designer draws and builds it).
 * Rule 3: motion is not queued before a frame of the built scene was checked; the sidecar takes the missing frame itself and refuses only when it could not.
 * Rule 2, design first and animate later, splits a mixed call instead of refusing it (see server-workflow-design-hold.ts).
 */
import type { JsonObject } from "@extynt/decode";
import type { AgentCallState, ChatAgentDeps, ChatAgentInput } from "./server-chat-agent-types.js";
import type { ToolArguments } from "./agent-types.js";
import { takeJobFrame, type RunTool } from "./server-workflow-completion-evidence.js";
import { visualSceneSession } from "./server-workflow-design-context.js";
import { checklistOf } from "./server-workflow-sidecar-actions.js";
import { argumentJson, listOf, objectOf, objectsOf, PLACEHOLDER_PREFIX, queueStaged, targetLayerId, textOf, type ToolResult } from "./server-workflow-operation-json.js";
import { awaitRunningSpecialist } from "./server-workflow-specialists.js";

/** The slice of workflow state the frame check reads; WorkflowState satisfies it structurally. */
export interface BuildHistory {
  readonly jobs: Readonly<Record<string, { readonly batchIds: readonly string[] } | undefined>>;
  readonly batches: Readonly<Record<string, { readonly execution: { readonly state: string }; readonly updatedAt: string; readonly operationIds: readonly string[] } | undefined>>;
  readonly operations: Readonly<Record<string, { readonly type: string } | undefined>>;
  readonly observations: Readonly<Record<string, { readonly jobId: string; readonly kind: string; readonly recordedAt: string } | undefined>>;
}

type DesignState = "ready" | "pending" | "failed" | "missing";
type GateCall = { name: string; args: ToolArguments; run?: RunTool };

const ANIMATION_TYPES: readonly string[] = ["animate_property", "animate_control", "set_expression", "set_loop"];
const BUILD_TYPES: readonly string[] = ["create_layer", "duplicate_layer", "derive_layer", "create_vector_artwork"];
const DERIVED_LAYER_TYPES: readonly string[] = ["duplicate_layer", "derive_layer"];

/** The operations a queue call authors: ae_queue_add holds them in `operations`, ae_queue_fix in the `operation` of each of its `edits`. */
export function authoringOperations(name: string, args: ToolArguments): JsonObject[] {
  if (name === "ae_queue_add") return objectsOf(argumentJson(args, "operations"));
  if (name !== "ae_queue_fix") return [];
  return objectsOf(argumentJson(args, "edits")).flatMap((edit) => objectsOf([edit.operation ?? null]));
}

function hasKeyframes(operation: JsonObject): boolean {
  const keyframes = operation.keyframes;
  const table = objectOf(keyframes);
  return table ? Object.keys(table).length > 0 : listOf(keyframes).length > 0;
}

/** True when the operation is animation: one of the animation types, or any operation that carries keyframes. */
export function operationAnimates(operation: JsonObject): boolean {
  return ANIMATION_TYPES.includes(textOf(operation.type) ?? "") || hasKeyframes(operation);
}

/** The layer ids the operations create: the target of a create_layer, and the new id of a duplicated or derived layer that is named by placeholder. */
export function createdLayerIds(operations: readonly JsonObject[]): string[] {
  return operations.flatMap((operation) => {
    const type = textOf(operation.type) ?? "";
    const derived = textOf(operation.newLayerId);
    if (type === "create_layer") return targetLayerId(operation) ?? [];
    return DERIVED_LAYER_TYPES.includes(type) && derived?.startsWith(PLACEHOLDER_PREFIX) ? [derived] : [];
  });
}

function drawsLayer(operation: JsonObject): boolean {
  return operation.type === "create_layer" && operation.layerType === "shape";
}

function drawnNames(operations: readonly JsonObject[]): string[] {
  return operations.flatMap((operation) => {
    if (operation.type === "create_vector_artwork") return ["vector artwork"];
    const name = drawsLayer(operation) ? textOf(operation.name) : undefined;
    return name ? [`"${name}"`] : [];
  });
}

/** True when the operations draw new artwork: a shape layer or vector artwork. */
export function createsDrawnArtwork(operations: readonly JsonObject[]): boolean {
  return operations.some((operation) => drawsLayer(operation) || operation.type === "create_vector_artwork");
}

function batchBuilds(history: BuildHistory, batchId: string): boolean {
  const batch = history.batches[batchId];
  if (batch?.execution.state !== "executed") return false;
  return batch.operationIds.some((operationId) => BUILD_TYPES.includes(history.operations[operationId]?.type ?? ""));
}

function latestBuildAt(history: BuildHistory, jobId: string): string | undefined {
  const times = (history.jobs[jobId]?.batchIds ?? []).flatMap((batchId) => {
    const batch = history.batches[batchId];
    return batch && batchBuilds(history, batchId) ? [batch.updatedAt] : [];
  });
  return times.reduce<string | undefined>((newest, time) => (newest === undefined || time > newest ? time : newest), undefined);
}

function frameCheckedSince(history: BuildHistory, jobId: string, since: string): boolean {
  return Object.values(history.observations).some((observation) => observation?.jobId === jobId && observation.kind === "visual" && observation.recordedAt > since);
}

/** True when animating now would skip the frame check the newest build of the job needs. */
export function frameCheckMissing(history: BuildHistory, jobId: string): boolean {
  const buildTime = latestBuildAt(history, jobId);
  return buildTime !== undefined && !frameCheckedSince(history, jobId, buildTime);
}

function pendingSpecialistRefusal(): ToolResult {
  return { ok: false, error: { code: "WORKFLOW_DESIGN_REQUIRED", message: "Design first: the visual-scene designer is still drawing and building this scene itself, so nothing from this call was queued. Call this again, or wait for it once with ae_consult_specialist (action wait, role visual-scene), read its report, then queue what the scene still needs." } };
}

function designRequiredRefusal(createdNames: readonly string[], perItem: boolean): ToolResult {
  const launch = perItem
    ? "action launch for this checklist item, with its composition id as compositionId and its spec as the instruction, which states the composition's name, size, duration and frame rate"
    : "action launch, once for the whole scene: state the open composition's name, size, duration and frame rate, and pass the request whole, with every layer, card and beat it names, not just this layer";
  return { ok: false, error: { code: "WORKFLOW_DESIGN_REQUIRED", message: `Design first: this call creates ${createdNames.join(", ")} but this job has no scene design yet, so nothing from it was queued. Launch the visual-scene specialist with ae_consult_specialist (${launch}) and add motion only if there is motion beyond a single move, fade or wiggle. It draws the scene and builds it itself (if the user asked to see the plan first, send the design with ae_ask_user and stop before launching); wait for its report, then queue only what the scene still needs.` } };
}

function briefsVisualScene(deps: ChatAgentDeps, jobId: string): boolean {
  return !!deps.state.workflowOrchestrations.get(jobId)?.specialists.some((brief) => brief.role === "visual-scene");
}

function sceneDesignState(deps: ChatAgentDeps, jobId: string): DesignState {
  const session = visualSceneSession(deps, jobId);
  if (briefsVisualScene(deps, jobId)) return "ready";
  if (session?.pending) return "pending";
  if (session?.design) return "ready";
  return session?.error ? "failed" : "missing";
}

/** True when the job has a scene design, finished or still being drawn: only a designed scene is built before it is animated. */
export function jobHasDesign(deps: ChatAgentDeps, input: ChatAgentInput): boolean {
  if (!input.workflowJobId) return false;
  const designState = sceneDesignState(deps, deps.state.workflowCoordinator.jobIdForSeed(input.workflowJobId));
  return designState === "ready" || designState === "pending";
}

async function settledDesignState(deps: ChatAgentDeps, input: ChatAgentInput, workflowId: string): Promise<DesignState> {
  const designState = sceneDesignState(deps, workflowId);
  const drawing = designState === "pending" ? visualSceneSession(deps, workflowId) : undefined;
  if (!drawing) return designState;
  await awaitRunningSpecialist(deps, input, drawing);
  return sceneDesignState(deps, workflowId);
}

function specialistReachable(deps: ChatAgentDeps, input: ChatAgentInput): boolean {
  return !!(deps.state.options.workflowSpecialistProviders?.["visual-scene"] ?? input.workflowOwnerProvider);
}

async function designRequiredGate(deps: ChatAgentDeps, call: GateCall, input: ChatAgentInput): Promise<ToolResult | undefined> {
  const operations = authoringOperations(call.name, call.args);
  if (!createsDrawnArtwork(operations) || !input.workflowJobId) return undefined;
  const workflowId = deps.state.workflowCoordinator.jobIdForSeed(input.workflowJobId);
  if (!workflowId) return undefined;
  const designState = await settledDesignState(deps, input, workflowId);
  if (designState === "pending") return pendingSpecialistRefusal();
  if (designState !== "missing" || !specialistReachable(deps, input)) return undefined;
  return designRequiredRefusal(drawnNames(operations), !!checklistOf(deps.state, workflowId));
}

function frameCheckRefusal(tried: boolean): ToolResult {
  const capture = tried ? "the sidecar could not capture a frame of it itself just now, so capture one" : "capture a frame";
  return { ok: false, error: { code: "WORKFLOW_FRAME_CHECK_REQUIRED", message: `Check the built scene before animating it: ${capture} with ae_capture_composition_frame and measure it with ae_observe_frame, then compare it with the design — every layer present, inside the frame, in the right place and stacking order. Fix anything wrong in a build stage first; this call was not queued.` } };
}

/** True when animating now would skip the frame check a designed scene needs; a job with no design is checked once, at the end. */
export function frameCheckBlocks(deps: ChatAgentDeps, input: ChatAgentInput): boolean {
  if (!input.workflowJobId || !jobHasDesign(deps, input)) return false;
  const coordinator = deps.state.workflowCoordinator;
  return frameCheckMissing(coordinator.workflowStore.getState(), coordinator.jobIdForSeed(input.workflowJobId));
}

async function frameCheckGate(deps: ChatAgentDeps, input: ChatAgentInput, call: GateCall): Promise<ToolResult | undefined> {
  if (!input.workflowJobId || !authoringOperations(call.name, call.args).some(operationAnimates) || !frameCheckBlocks(deps, input)) return undefined;
  if (call.run && !input.workflowObservationOnly) await takeJobFrame(deps, deps.state.workflowCoordinator.jobIdForSeed(input.workflowJobId), call.run);
  return frameCheckBlocks(deps, input) ? frameCheckRefusal(!!call.run) : undefined;
}

/** Remembers the layers an accepted ae_queue_add call creates, so a later call this cycle that animates them is recognised as animating a new layer. */
export function recordCreatedLayers(state: AgentCallState, call: { name: string; args: ToolArguments }, result: ToolResult): void {
  if (call.name !== "ae_queue_add" || !queueStaged(result)) return;
  const created = createdLayerIds(authoringOperations(call.name, call.args));
  if (!created.length) return;
  state.createdLayers ??= new Set();
  for (const id of created) state.createdLayers.add(id);
}

/** Rules 1 and 3 for a workflow tool call, or undefined when the call may go on: the refusal names what to do first. */
export async function workflowDesignGate(deps: ChatAgentDeps, call: GateCall, input: ChatAgentInput): Promise<ToolResult | undefined> {
  if (!input.workflowJobId) return undefined;
  return await designRequiredGate(deps, call, input) ?? frameCheckGate(deps, input, call);
}

/** Rule 3 for the stage tool: a stage whose operation types animate is refused until the built scene's frame was checked. */
export function stageFrameCheckGate(deps: ChatAgentDeps, input: ChatAgentInput, operationTypes: readonly string[]): ToolResult | undefined {
  const animates = operationTypes.some((type) => ANIMATION_TYPES.includes(type));
  return animates && frameCheckBlocks(deps, input) ? frameCheckRefusal(false) : undefined;
}
