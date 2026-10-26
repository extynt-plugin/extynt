// The inspection reads: composition and layer detail, effects and dependencies, project issues, the capability catalogue and the effect inventory.
import { BASE_CATALOGUE, diffInventory, observeSnapshotEffects, searchCapabilities } from "@extynt/capability-catalogue";
import { extractEffects, extractExpressions, findCompositionById } from "@extynt/project-graph";
import type { LayerSnapshot } from "@extynt/project-graph";
import { annotateEffectRanges } from "./effect-control-ranges.js";
import { compositionNotFound, inspectComposition, inspectLayer, layerNotFound } from "./inspection.js";
import type { Infer } from "@extynt/decode";
import { boundedAt, jsonOf, objectOf } from "./json.js";
import { listProjectIssues } from "./project-issues.js";
import { measureLayerTool } from "./solver-tools.js";
import { toolError, toolSuccess } from "./tool-result.js";
import type { ToolFailure, ToolRequest, ToolResult } from "./tool-result.js";
import { AE_DESCRIBE_CAPABILITY, AE_GET_EFFECT_CONTROLS, AE_LIST_CAPABILITIES, AE_SEARCH_CAPABILITIES } from "./tool-specs-host.js";
import { AE_INSPECT_COMPOSITION, AE_INSPECT_LAYER, AE_LIST_EFFECTS_AND_EXPRESSIONS, AE_LIST_PROJECT_ISSUES, AE_MEASURE_LAYER, AE_TRACE_DEPENDENCIES } from "./tool-specs-read.js";

const ISSUE_LIMIT = 100;

type LayerScope = { readonly compositionId?: string; readonly layerId?: string };

/** Wraps a read that needs property-level coverage, which a metadata-only snapshot does not have. */
export function needsFullCoverage<A>(handler: (request: ToolRequest<A>) => ToolResult): (request: ToolRequest<A>) => ToolResult {
  return (request) => request.snapshot.coverage
    ? toolError("READ_COVERAGE_UNKNOWN", "This snapshot covers layer metadata only; property, expression and dependency coverage is unknown. Demand bounded observations before planning dependent changes.")
    : handler(request);
}

/** Answers ae_inspect_composition. */
export function inspectCompositionTool({ base, snapshot, args }: ToolRequest<Infer<typeof AE_INSPECT_COMPOSITION.input.decoder>>): ToolResult {
  return inspectComposition(base, snapshot, args);
}

/** Answers ae_inspect_layer. */
export function inspectLayerTool({ base, snapshot, args }: ToolRequest<Infer<typeof AE_INSPECT_LAYER.input.decoder>>): ToolResult {
  return inspectLayer(base, snapshot, args);
}

/** Answers ae_measure_layer. */
export function measureTool({ base, snapshot, args }: ToolRequest<Infer<typeof AE_MEASURE_LAYER.input.decoder>>): ToolResult {
  return measureLayerTool(base, snapshot, args);
}

function layersOfRequest({ snapshot, args }: ToolRequest<LayerScope>): { layers: readonly LayerSnapshot[] } | ToolFailure {
  const compositionId = args.compositionId ?? snapshot.activeCompositionId ?? "";
  const composition = findCompositionById(snapshot, compositionId);
  if (!composition) return compositionNotFound(snapshot, compositionId);
  const layerId = args.layerId;
  if (layerId && !composition.layers.some((layer) => layer.id === layerId)) return layerNotFound(composition.id, composition.name, composition.layers, layerId);
  return { layers: composition.layers.filter((layer) => !layerId || layer.id === layerId) };
}

/** Answers ae_list_effects_and_expressions. */
export function effectsAndExpressionsTool(request: ToolRequest<Infer<typeof AE_LIST_EFFECTS_AND_EXPRESSIONS.input.decoder>>): ToolResult {
  const found = layersOfRequest(request);
  if ("error" in found) return found;
  const rows = found.layers.map((layer) => objectOf({
    layerId: layer.id, layerName: layer.name,
    effects: jsonOf(annotateEffectRanges(extractEffects(layer), request.context.hostProfile)), expressions: jsonOf(extractExpressions(layer)),
  }));
  return toolSuccess(request.base, rows);
}

/** Answers ae_trace_dependencies. */
export function dependenciesTool(request: ToolRequest<Infer<typeof AE_TRACE_DEPENDENCIES.input.decoder>>): ToolResult {
  const found = layersOfRequest(request);
  if ("error" in found) return found;
  const rows = found.layers.map((layer) => objectOf({
    layerId: layer.id, parentId: layer.parentId, matteLayerId: layer.matteLayerId, compositionSourceId: layer.compositionSourceId ?? null, sourceId: layer.sourceId,
  }));
  return toolSuccess(request.base, rows);
}

/** Answers ae_list_project_issues. */
export function projectIssuesTool({ base, snapshot, args }: ToolRequest<Infer<typeof AE_LIST_PROJECT_ISSUES.input.decoder>>): ToolResult {
  const compositionId = args.compositionId || undefined;
  if (compositionId && !findCompositionById(snapshot, compositionId)) return compositionNotFound(snapshot, compositionId);
  const issues = listProjectIssues(snapshot, compositionId);
  return { ...toolSuccess(base, jsonOf(issues.slice(0, ISSUE_LIMIT))), truncated: issues.length > ISSUE_LIMIT };
}

/** Answers ae_list_capabilities. */
export function listCapabilitiesTool({ base, args, context }: ToolRequest<Infer<typeof AE_LIST_CAPABILITIES.input.decoder>>): ToolResult {
  const catalogue = context.catalogue ?? BASE_CATALOGUE;
  const limit = boundedAt(args, "limit", { fallback: 100, min: 1, max: 100 });
  const capabilities = catalogue.capabilities.slice(0, limit);
  return toolSuccess(base, objectOf({ catalogueVersion: catalogue.catalogueVersion, enumeration: jsonOf(catalogue.enumeration), capabilities: jsonOf(capabilities) }));
}

/** Answers ae_search_capabilities. */
export function searchCapabilitiesTool({ base, args, context }: ToolRequest<Infer<typeof AE_SEARCH_CAPABILITIES.input.decoder>>): ToolResult {
  const limit = boundedAt(args, "limit", { fallback: 25, min: 1, max: 100 });
  const found = searchCapabilities(context.catalogue ?? BASE_CATALOGUE, args.query ?? "", limit);
  return toolSuccess(base, jsonOf(found));
}

/** Answers ae_describe_capability. */
export function describeCapabilityTool({ base, args, context }: ToolRequest<Infer<typeof AE_DESCRIBE_CAPABILITY.input.decoder>>): ToolResult {
  const id = args.id ?? "";
  const capability = (context.catalogue ?? BASE_CATALOGUE).capabilities.find((candidate) => candidate.id === id || candidate.matchName === id);
  return toolSuccess(base, jsonOf(capability ?? null));
}

/** Answers ae_get_effect_controls: every instance of one effect in the project, with its controls. */
export function effectControlsTool({ base, snapshot, args, context }: ToolRequest<Infer<typeof AE_GET_EFFECT_CONTROLS.input.decoder>>): ToolResult {
  if (snapshot.coverage) return toolError("READ_COVERAGE_UNKNOWN", "Effect controls were not acquired by this metadata snapshot.");
  const matchName = args.matchName ?? "";
  const limit = boundedAt(args, "limit", { fallback: 50, min: 1, max: 100 });
  const matches = snapshot.compositions.flatMap((composition) => composition.layers.flatMap((layer) =>
    annotateEffectRanges(extractEffects(layer), context.hostProfile).filter((effect) => effect.matchName === matchName).map((effect) => objectOf({ compositionId: composition.id, layerId: layer.id, effect: jsonOf(effect) }))));
  return { ...toolSuccess(base, matches.slice(0, limit)), truncated: matches.length > limit };
}

/** Answers ae_get_inventory_diff: the effects the project uses, and what changed since the previous inventory. */
export function inventoryDiffTool({ base, snapshot, context }: ToolRequest): ToolResult {
  const inventory = context.inventory ?? observeSnapshotEffects(snapshot);
  const previous = context.previousInventory;
  return toolSuccess(base, objectOf({ inventory: jsonOf(inventory), previousFingerprint: previous?.fingerprint ?? null, diff: previous ? jsonOf(diffInventory(previous, inventory)) : null }));
}
