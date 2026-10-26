// The panel's context tools and the whole-plan proposal: fresh edit context, semantic role resolution, and a proposal that may carry a drawing.
import { BASE_CATALOGUE, resolveCapability, resolveControl } from "@extynt/capability-catalogue";
import type { CapabilityResolveRequest } from "@extynt/capability-catalogue";
import type { Infer } from "@extynt/decode";
import { getSelectedLayers } from "@extynt/project-graph";
import type { ProjectSnapshot } from "@extynt/project-graph";
import { composeProposal } from "./compose.js";
import type { ToolContext } from "./contracts.js";
import { PROPOSAL_OPERATION_LIMIT } from "./core-constants.js";
import { jsonOf, objectOf } from "./json.js";
import { sceneProposal } from "./svg-scene/propose.js";
import type { AE_RESOLVE_CAPABILITY } from "./tool-specs-host.js";
import type { AE_PROPOSE_PLAN } from "./tool-specs-plan.js";
import { toolError, toolSuccess } from "./tool-result.js";
import type { ToolBase, ToolRequest, ToolResult } from "./tool-result.js";

type ResolveArgs = Infer<typeof AE_RESOLVE_CAPABILITY.input.decoder>;
type ProposeArgs = Infer<typeof AE_PROPOSE_PLAN.input.decoder>;

/** The layers selected in the open composition, with the fingerprints that say whether the answer is still current. */
export function freshEditContext(base: ToolBase, snapshot: ProjectSnapshot): ToolResult {
  const selected = getSelectedLayers(snapshot);
  return toolSuccess(base, jsonOf({
    contextId: `${snapshot.fingerprint}:${snapshot.selectionFingerprint}`,
    freshness: snapshot.freshness,
    selectionFingerprint: snapshot.selectionFingerprint,
    activeCompositionId: snapshot.activeCompositionId,
    currentTime: snapshot.currentTime,
    target: { compositionId: snapshot.selection.compositionId, layerIds: selected.map((layer) => layer.id) },
    selectedLayers: selected.map((layer) => ({ id: layer.id, name: layer.name, type: layer.type, locked: layer.locked })),
  }));
}

function resolveTarget(args: ResolveArgs, capabilityId: string): CapabilityResolveRequest {
  const { compositionId, layerId, selectedLayer } = args;
  return { capabilityId, ...(compositionId ? { compositionId } : {}), ...(layerId ? { layerId } : {}), ...(selectedLayer === undefined ? {} : { selectedLayer }) };
}

/** Resolves a capability, or one semantic control of it, against the layers of the snapshot. */
export function resolveSemanticCapability({ base, snapshot, args, context }: ToolRequest<ResolveArgs>): ToolResult {
  if (!args.capabilityId) return toolError("INVALID_ARGUMENT", "capabilityId is required.");
  const catalogue = context.catalogue ?? BASE_CATALOGUE;
  const common = resolveTarget(args, args.capabilityId);
  const { effectPath, role } = args;
  const resolved = role ? resolveControl(snapshot, { ...common, role, ...(effectPath ? { effectPath } : {}) }, catalogue) : resolveCapability(snapshot, common, catalogue);
  return toolSuccess(base, jsonOf(resolved));
}

function drawingTooLarge(count: number): ToolResult {
  return toolError("INVALID_ARGUMENT", `The drawing compiles to ${count} native operations with the others given, over the ${PROPOSAL_OPERATION_LIMIT} one proposal holds. Split it: propose the drawing's first layers now (fewer groups in the svg) and the rest in a second proposal.`);
}

function drawnProposal(base: ToolBase, snapshot: ProjectSnapshot, args: ProposeArgs, context: ToolContext): ToolResult {
  const written = objectOf({ summary: args.summary, svg: args.svg, compositionId: args.compositionId, operations: args.operations });
  const scene = sceneProposal(written, snapshot);
  if ("error" in scene) return scene;
  if (scene.operations.length > PROPOSAL_OPERATION_LIMIT) return drawingTooLarge(scene.operations.length);
  const composed = composeProposal(base, snapshot, { args: { ...written, operations: jsonOf(scene.operations) }, limit: PROPOSAL_OPERATION_LIMIT, retainDraft: true }, context);
  if (!composed.ok) return composed;
  const layers = scene.layers.map((layer) => ({ name: layer.name, layerId: composed.data.renamedPlaceholders[layer.layerId] ?? layer.layerId }));
  const svgScene = { compositionId: scene.compositionId, layers, ...(scene.warnings.length ? { warnings: scene.warnings } : {}) };
  return toolSuccess(base, jsonOf({ ...composed.data, svgScene }));
}

/** Proposes a whole plan from the caller's operations, compiling a drawn scene into layers first when `svg` is given. */
export function proposeCustomPlan(base: ToolBase, snapshot: ProjectSnapshot, args: ProposeArgs, context: ToolContext): ToolResult {
  if (args.svg === undefined) {
    const composed = composeProposal(base, snapshot, { args: objectOf({ summary: args.summary, operations: args.operations }), limit: PROPOSAL_OPERATION_LIMIT, retainDraft: true }, context);
    return composed.ok ? toolSuccess(base, jsonOf(composed.data)) : composed;
  }
  return drawnProposal(base, snapshot, args, context);
}
