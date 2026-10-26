/** Selects the bounded, redacted project context a model is shown: the active composition, the selected layers and their ancestors, and the sources they reference. */
import {
  findCompositionById,
  getActiveComposition,
  type CompositionSnapshot,
  type LayerSnapshot,
  type ProjectSnapshot,
} from "@extynt/project-graph";
import { DEFAULT_REDACTION_CONFIG } from "./redaction.js";
import { positiveLimit } from "./provider-runtime.js";
import { ContextProjector, type ProjectionLimits } from "./context-project.js";
import type {
  ContextComposition,
  ContextHost,
  ContextLayer,
  ContextProject,
  ContextSection,
  ContextSelectionOptions,
  CopilotContext,
} from "./types.js";

const DEFAULT_SECTIONS: NonNullable<ContextSelectionOptions["include"]> = [
  "host", "project", "activeComposition", "selectedLayers", "selectionAncestors", "sources",
];

const DEFAULT_LIMITS = {
  maxHistoryMessages: 8,
  maxPropertiesPerLayer: 80,
  maxPropertyDepth: 6,
  maxStringLength: DEFAULT_REDACTION_CONFIG.maxStringLength,
};

export interface ContextSelectionResult {
  context: CopilotContext;
  selectedPropertyCount: number;
}

interface SelectionPass {
  snapshot: ProjectSnapshot;
  include: ReadonlySet<ContextSection>;
  projector: ContextProjector;
  activeComposition: CompositionSnapshot | undefined;
  selectedLayers: ContextLayer[];
  selectionAncestors: ContextLayer[];
  host: ContextHost | undefined;
  project: ContextProject | undefined;
  activeCompositionContext: ContextComposition | undefined;
}

/** Layers count as selected by id or by the host's own `isSelected` flag within the selection composition. A section the caller excluded is not projected at all, so it adds no redaction counts either, and the payload's key order is part of the prompt text, so the gated sections keep the order they have here. */
export function selectProjectContext(snapshot: ProjectSnapshot, options: ContextSelectionOptions = {}): ContextSelectionResult {
  const include = new Set<ContextSection>(options.include ?? DEFAULT_SECTIONS);
  const projector = new ContextProjector(projectionLimits(options));
  const activeComposition = getActiveComposition(snapshot);
  const candidates = selectedLayerCandidates(snapshot);
  const selectedLayers = projector.layers(candidates.layers);
  const selectedIds = new Set(selectedLayers.map((layer) => layer.id));
  const selectionAncestors = projector.layers(selectionAncestorLayers(candidates.composition, candidates.layers, selectedIds));
  const pass: SelectionPass = {
    snapshot,
    include,
    projector,
    activeComposition,
    selectedLayers,
    selectionAncestors,
    host: include.has("host") ? projector.host(snapshot) : undefined,
    project: include.has("project") ? projector.project(snapshot) : undefined,
    activeCompositionContext: activeComposition && include.has("activeComposition") ? projector.composition(activeComposition, snapshot.currentTime) : undefined,
  };
  return { context: assembleContext(pass), selectedPropertyCount: projector.selectedPropertyCount };
}

function projectionLimits(options: ContextSelectionOptions): ProjectionLimits {
  return {
    config: { includeFilePaths: options.includeFilePaths ?? false, maxStringLength: positiveLimit(options.maxStringLength, DEFAULT_LIMITS.maxStringLength) },
    includeExpressions: options.includeExpressions ?? false,
    maxDepth: positiveLimit(options.maxPropertyDepth, DEFAULT_LIMITS.maxPropertyDepth),
    maxProperties: positiveLimit(options.maxPropertiesPerLayer, DEFAULT_LIMITS.maxPropertiesPerLayer),
  };
}

function selectedLayerCandidates(snapshot: ProjectSnapshot): { composition: CompositionSnapshot | undefined; layers: LayerSnapshot[] } {
  const composition = snapshot.selection.compositionId ? findCompositionById(snapshot, snapshot.selection.compositionId) : undefined;
  const layers = composition ? composition.layers.filter((layer) => snapshot.selection.layerIds.includes(layer.id) || layer.isSelected) : [];
  return { composition, layers };
}

function assembleContext(pass: SelectionPass): CopilotContext {
  const { snapshot, include } = pass;
  return {
    schemaVersion: "0.1",
    snapshotIdentity: { revision: snapshot.revision, fingerprint: snapshot.fingerprint },
    ...(pass.host ? { host: pass.host } : {}),
    ...(pass.project ? { project: pass.project } : {}),
    activeCompositionId: snapshot.activeCompositionId,
    currentTime: snapshot.currentTime,
    selection: { compositionId: snapshot.selection.compositionId, layerIds: [...snapshot.selection.layerIds].sort() },
    ...(pass.activeCompositionContext ? { activeComposition: pass.activeCompositionContext } : {}),
    selectedLayers: include.has("selectedLayers") ? pass.selectedLayers : [],
    selectionAncestors: include.has("selectionAncestors") ? pass.selectionAncestors : [],
    ...referencedSections(pass),
    redaction: pass.projector.redaction,
  };
}

function referencedSections(pass: SelectionPass): Pick<CopilotContext, "sources" | "items" | "warnings" | "truncation"> {
  const { snapshot, projector } = pass;
  const sourceIds = referencedSourceIds(pass.selectedLayers, pass.selectionAncestors);
  return {
    sources: pass.include.has("sources") ? projector.sources((snapshot.sources ?? []).filter((source) => sourceIds.has(source.id))) : [],
    items: pass.include.has("items") ? projector.items(referencedItems(pass, sourceIds)) : [],
    warnings: projector.warnings(snapshot.warnings ?? []),
    truncation: snapshot.truncation?.truncated ? snapshot.truncation : null,
  };
}

function referencedItems(pass: SelectionPass, sourceIds: ReadonlySet<string>): NonNullable<ProjectSnapshot["items"]> {
  const itemIds = new Set(pass.activeComposition ? [...sourceIds, pass.activeComposition.id] : sourceIds);
  return (pass.snapshot.items ?? []).filter((item) => itemIds.has(item.id));
}

function referencedSourceIds(selectedLayers: ContextLayer[], selectionAncestors: ContextLayer[]): Set<string> {
  return new Set([...selectedLayers, ...selectionAncestors]
    .flatMap((layer) => [layer.sourceId, layer.compositionSourceId])
    .filter((id): id is string => id !== null));
}

function selectionAncestorLayers(composition: CompositionSnapshot | undefined, selected: LayerSnapshot[], selectedIds: Set<string>): LayerSnapshot[] {
  const ancestorIds = new Set<string>();
  let frontier = selected;
  while (frontier.length > 0) {
    const nextIds = frontier.map((layer) => layer.parentId)
      .filter((id): id is string => id !== null && !selectedIds.has(id) && !ancestorIds.has(id))
      .sort();
    if (nextIds.length === 0) break;
    nextIds.forEach((id) => ancestorIds.add(id));
    frontier = nextIds.map((id) => composition?.layers.find((layer) => layer.id === id))
      .filter((layer): layer is LayerSnapshot => !!layer);
  }
  return [...ancestorIds]
    .map((id) => composition?.layers.find((layer) => layer.id === id))
    .filter((layer): layer is LayerSnapshot => !!layer);
}
