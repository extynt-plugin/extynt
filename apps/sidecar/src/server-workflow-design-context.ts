/**
 * The compiled drawing of a job and the composition it builds into. A drawing names its composition, else the open batch creates one at the drawing's size,
 * else the job created and sealed exactly one earlier; anything else is a refusal that says what to do. The designer builds into a composition that exists,
 * so a composition still queued unsealed in the owner's batch is not there for its isolated batch, and the owner's batch set aside during that build is remembered here.
 */
import { splitHeavyLayers, type CompiledSceneLayer } from "@extynt/mcp-server";
import type { ChatAgentInput } from "./server-chat-agent-types.js";
import { createdId, createdLayerId, jobCreatedCompositionIds, openPlanOf, operationsOf, removedLayerIds, type DesignDeps, type PlanSnapshot } from "./server-workflow-design-receipts.js";
import { objectsOf, refusal, textOf, type ToolResult } from "./server-workflow-operation-json.js";
import { specialistRemedy, specialistWorkflowId } from "./server-workflow-specialist-id.js";
import type { SceneDesign } from "./workflow-design-compile.js";
import type { WorkflowSpecialistSession } from "./workflow-orchestration.js";
import type { JsonObject } from "@extynt/decode";
import { jsonOf } from "@extynt/mcp-server";

/** The composition a drawing builds into. */
export type DesignComposition = { readonly id: string; readonly name: string; readonly width: number; readonly height: number; readonly layers: ReadonlyArray<{ readonly name: string; readonly id?: string; readonly index?: number }> };

/** The drawing's layers (heavy ones split), the composition they build into and the project fingerprint they were planned against. */
export type DesignContext = { readonly layers: readonly CompiledSceneLayer[]; readonly composition: DesignComposition; readonly fingerprint: string | null };

type Ready = { readonly session: WorkflowSpecialistSession; readonly design: SceneDesign; readonly snapshot: PlanSnapshot };
type Size = { readonly width: number; readonly height: number };

const DESIGNER_BUILDS = "The designer is still drawing and builds its drawing itself; do not call ae_queue_design for it. Keep working on the rest: its report wakes you when it is done.";
const setAside = new WeakMap<DesignDeps["state"], string | null>();

/** The visual-scene thread of a workflow, when it has one. */
export function visualSceneSession(deps: DesignDeps, workflowId: string | undefined): WorkflowSpecialistSession | undefined {
  return workflowId ? deps.state.workflowSpecialistSessions.get(workflowId)?.get("visual-scene") : undefined;
}

/** The visual-scene thread of the job an input belongs to. */
export function designSession(deps: DesignDeps, input: ChatAgentInput): WorkflowSpecialistSession | undefined {
  return visualSceneSession(deps, specialistWorkflowId(deps, input));
}

/** Remembers the owner's open batch while the designer builds in a batch of its own (null when there was none). */
export function setOwnerBatchAside(deps: DesignDeps, planId: string | null): void {
  setAside.set(deps.state, planId);
}

/** Forgets the owner's batch set aside once the designer's build is over. */
export function clearOwnerBatchAside(deps: DesignDeps): void {
  setAside.delete(deps.state);
}

function sizedCompositions(operations: readonly JsonObject[], size: Size): JsonObject[] {
  return operations.filter((operation) => operation.type === "create_composition" && operation.width === size.width && operation.height === size.height);
}

function authoredCompositionId(deps: DesignDeps, size: Size): string | undefined {
  const authored = (openPlanOf(deps)?.staged ?? []).flatMap((batch) => objectsOf(jsonOf(batch.authored)));
  return textOf(sizedCompositions(authored, size)[0]?.newCompositionId);
}

function queuedComposition(deps: DesignDeps, size: Size): (DesignComposition & { readonly placeholder: string }) | ToolResult | undefined {
  const open = openPlanOf(deps);
  const candidates = open ? sizedCompositions(operationsOf(open), size) : [];
  if (candidates.length > 1) return refusal("COMPOSITION_AMBIGUOUS", "This batch creates more than one composition at the drawing's size. Create one composition per scene build.");
  const placeholder = textOf(candidates[0]?.newCompositionId);
  const name = textOf(candidates[0]?.name);
  if (placeholder === undefined || name === undefined) return undefined;
  return { id: authoredCompositionId(deps, size) ?? placeholder, placeholder, name, ...size, layers: [] };
}

function designerNoTarget(deps: DesignDeps, size: Size): ToolResult {
  const held = setAside.get(deps.state);
  const open = held ? deps.state.plans.get(held) : undefined;
  const queued = open ? sizedCompositions(operationsOf(open), size).length > 0 : false;
  const problem = queued ? `A ${size.width}×${size.height} composition is queued in the owner's open batch but not sealed, so it does not exist yet and is built into only once the owner seals it.` : `This job has no ${size.width}×${size.height} composition yet.`;
  const todo = queued ? "seal the batch that holds the composition (ae_queue_finish)" : `create a ${size.width}×${size.height} composition`;
  return refusal("COMPOSITION_TARGET_REQUIRED", `${problem} Nothing was built; your drawing is compiled and kept. You cannot fix this yourself: end your turn now with a short report that says so and asks the owner to ${todo}, then message you (ae_consult_specialist action message, role visual-scene) to build, which you do with ae_build_drawing and no svg: no redrawing is needed.`);
}

function noTargetRefusal(size: Size): ToolResult {
  return refusal("COMPOSITION_TARGET_REQUIRED", `No composition of ${size.width}×${size.height} exists in this job or is open. Create a composition at ${size.width}×${size.height} with create_composition, or open the intended composition (at that size), then call ae_queue_design again.`);
}

function targetComposition(deps: DesignDeps, ready: Ready, workflowJobId: string | undefined): PlanSnapshot["compositions"][number] | ToolResult | undefined {
  const { session, design, snapshot } = ready;
  const { width, height } = design.scene;
  const targetId = design.targetCompositionPlaceholder ? createdId(deps, design.targetCompositionPlaceholder, workflowJobId) : design.compositionId;
  const named = targetId ? snapshot.compositions.find((item) => item.id === targetId) : undefined;
  if (named) return named;
  const ids = jobCreatedCompositionIds(deps, workflowJobId);
  const created = snapshot.compositions.filter((item) => ids.includes(item.id) && item.width === width && item.height === height);
  if (created.length > 1) return refusal("COMPOSITION_AMBIGUOUS", `This job created more than one ${width}×${height} composition: ${created.map((item) => `"${item.name}" (${item.id})`).join(", ")}. Open the one the scene belongs in, then call ae_queue_design again.`);
  const [first] = created;
  if (first) session.design = { ...design, compositionId: first.id };
  return first;
}

function persistedComposition(deps: DesignDeps, ready: Ready, where: { workflowJobId: string | undefined; builder: boolean }): DesignComposition | ToolResult {
  const { width, height } = ready.design.scene;
  const composition = targetComposition(deps, ready, where.workflowJobId);
  if (composition && "ok" in composition) return composition;
  if (!composition) return where.builder ? designerNoTarget(deps, { width, height }) : noTargetRefusal({ width, height });
  if (composition.width !== width || composition.height !== height) return refusal("COMPOSITION_SIZE_MISMATCH", "The target composition's size differs from the compiled drawing. Redraw for that composition before building.");
  return composition;
}

function sessionRefusal(session: WorkflowSpecialistSession | undefined, builder: boolean): ToolResult | undefined {
  if (session?.pending && !builder) return refusal("DESIGN_PENDING", DESIGNER_BUILDS);
  if (session?.design) return undefined;
  if (session?.error) return refusal("DESIGN_FAILED", `The visual-scene designer's last turn failed: ${session.error} ${specialistRemedy("visual-scene")}`);
  return refusal("DESIGN_UNAVAILABLE", "No drawing exists for this job yet. Launch the visual-scene designer (ae_consult_specialist action launch); it draws the scene and builds it itself.");
}

function readyDesign(deps: DesignDeps, input: ChatAgentInput, builder: boolean): Ready | ToolResult {
  const session = designSession(deps, input);
  const refused = sessionRefusal(session, builder);
  if (refused || !session?.design) return refused ?? refusal("DESIGN_UNAVAILABLE", "No compiled scene drawing exists for this job yet.");
  const snapshot = deps.planState.normalizedLatest();
  return snapshot ? { session, design: session.design, snapshot } : refusal("SNAPSHOT_REQUIRED", "Refresh the project snapshot before building the designed scene.");
}

/** The compiled drawing and the composition it builds into, or why the build cannot start. */
export function designContext(deps: DesignDeps, input: ChatAgentInput, builder = false): DesignContext | ToolResult {
  const ready = readyDesign(deps, input, builder);
  if ("ok" in ready) return ready;
  const { session, design, snapshot } = ready;
  const layers = splitHeavyLayers(design.scene.layers);
  const queued = builder ? undefined : queuedComposition(deps, design.scene);
  if (queued && "ok" in queued) return queued;
  if (queued) {
    session.design = { ...design, targetCompositionPlaceholder: queued.placeholder };
    return { layers, composition: queued, fingerprint: snapshot.fingerprint };
  }
  const composition = persistedComposition(deps, ready, { workflowJobId: specialistWorkflowId(deps, input), builder });
  return "ok" in composition ? composition : { layers, composition, fingerprint: snapshot.fingerprint };
}

function readLayerId(deps: DesignDeps, work: { jobId: ReturnType<typeof specialistWorkflowId>; read: string | null; receiptId: string | undefined }): string | null {
  const { jobId, read, receiptId } = work;
  return read && receiptId && read !== receiptId && removedLayerIds(deps, jobId).has(read) ? receiptId : read;
}

/** The id a layer the designer built has now: the one layer of that name in the composition, else the id the receipt gave it (the project read may not show it yet, or may still show the layer a redraw replaced). Null when it is not exactly one layer. */
export function designLayerId(deps: DesignDeps, input: ChatAgentInput, where: { composition: DesignComposition | undefined; name: string }): string | null {
  const found = where.composition?.layers.filter((item) => item.name === where.name) ?? [];
  const jobId = specialistWorkflowId(deps, input);
  const receiptId = createdLayerId(deps, jobId, where.name);
  if (!found.length) return receiptId ?? null;
  const [only] = found;
  return found.length === 1 ? readLayerId(deps, { jobId, read: only?.id ?? null, receiptId }) : null;
}
