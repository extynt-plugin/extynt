// The project reads: status, snapshot refresh, the current context, the overview, the selection and object search.
import { extractEffects, getSelectedLayers, layersInScope, summarizeSnapshot } from "@extynt/project-graph";
import type { LayerSnapshot, ProjectSnapshot } from "@extynt/project-graph";
import type { ToolContext } from "./contracts.js";
import { jsonOf, objectOf } from "./json.js";
import type { JsonObject, JsonValue } from "@extynt/decode";
import { latestWorkView } from "./plan-work.js";
import type { ToolRequest, ToolResult } from "./tool-result.js";
import { MCP_SERVER_VERSION } from "./version.js";

const CONTEXT_LAYER_LIMIT = 50;
const SELECTION_LAYER_LIMIT = 100;
const UNCHANGED_NEXT = "Nothing about the newest work or the project has changed since the answer you already have this turn. Read it again only if you need to quote a number from it.";
const REFRESH_NEXT = "Poll ae_get_bootstrap_context with this knownRevision; an open paired panel republishes within a few seconds.";

function revisionOf(snapshot: ProjectSnapshot): string {
  return `${snapshot.revision}:${snapshot.fingerprint}`;
}

function statusProject(snapshot: ProjectSnapshot | undefined): JsonObject {
  if (!snapshot) return { host: null, projectName: null, activeCompositionId: null, capturedAt: null };
  return objectOf({ host: jsonOf(snapshot.host), projectName: snapshot.project.name, activeCompositionId: snapshot.activeCompositionId ?? null, capturedAt: snapshot.capturedAt });
}

function statusData(snapshot: ProjectSnapshot | undefined, latestWork: JsonValue, context: ToolContext): JsonObject {
  return objectOf({
    version: MCP_SERVER_VERSION, connected: true, ...statusProject(snapshot), latestWork,
    interruptedApply: context.interruptedApply ? jsonOf(context.interruptedApply) : undefined,
    ...context.statusFacts,
  });
}

/** Answers ae_status from the snapshot, or from nothing while no project has been read; the sidecar adds the facts only it holds through the context, and a caller holding this turn's answer is told it is unchanged. */
export function statusResult(snapshot: ProjectSnapshot | undefined, context: ToolContext): ToolResult {
  const latestWork = jsonOf(latestWorkView(context));
  const data = statusData(snapshot, latestWork, context);
  const answer = { ok: true as const, tool: "ae_status", snapshotFingerprint: snapshot?.fingerprint ?? null };
  const memory = context.statusMemory;
  if (!memory) return { ...answer, data };
  const key = JSON.stringify(data);
  if (memory.value === key) return { ...answer, data: { unchanged: true, status: "unchanged", latestWork, next: UNCHANGED_NEXT } };
  memory.value = key;
  return { ...answer, data };
}

/** Answers ae_status for a loaded snapshot. */
export function statusTool({ snapshot, context }: ToolRequest): ToolResult {
  return statusResult(snapshot, context);
}

/** Answers ae_refresh_snapshot by naming the revision to poll from. */
export function refreshSnapshotTool({ base, snapshot }: ToolRequest): ToolResult {
  return { ...base, data: { status: "queued", knownRevision: revisionOf(snapshot), next: REFRESH_NEXT } };
}

function selectedRow(layer: LayerSnapshot): JsonObject {
  const effects = extractEffects(layer);
  return objectOf({
    id: layer.id, name: layer.name, type: layer.type, locked: layer.locked ? true : undefined,
    effects: effects.length ? effects.map((effect) => effect.displayName || effect.matchName) : undefined,
  });
}

function carriedFacts(context: ToolContext): JsonObject {
  return objectOf({
    interruptedApply: context.interruptedApply ? jsonOf(context.interruptedApply) : undefined,
    hostFailures: context.hostFailures?.length ? jsonOf(context.hostFailures) : undefined,
    recentBuild: context.recentBuild ? jsonOf(context.recentBuild) : undefined,
  });
}

/** Answers ae_get_current_context: the active composition, time and the first selected layers. */
export function currentContextTool({ base, snapshot, context }: ToolRequest): ToolResult {
  const selected = getSelectedLayers(snapshot);
  const data = objectOf({
    ...carriedFacts(context),
    activeCompositionId: snapshot.activeCompositionId, currentTime: snapshot.currentTime, revision: revisionOf(snapshot),
    selection: { compositionId: snapshot.selection.compositionId, layers: selected.slice(0, CONTEXT_LAYER_LIMIT).map(selectedRow) },
  });
  return { ...base, data, truncated: selected.length > CONTEXT_LAYER_LIMIT };
}

/** Answers ae_get_project_overview. */
export function projectOverviewTool({ base, snapshot }: ToolRequest): ToolResult {
  const data = objectOf({
    project: { name: snapshot.project.name }, host: jsonOf(snapshot.host), summary: jsonOf(summarizeSnapshot(snapshot)),
    warnings: jsonOf(snapshot.warnings ?? []), truncation: jsonOf(snapshot.truncation ?? { truncated: false, limits: {} }),
  });
  return { ...base, data };
}

/** Answers ae_get_selection. */
export function selectionTool({ base, snapshot }: ToolRequest): ToolResult {
  const selected = getSelectedLayers(snapshot);
  const rows: JsonValue = selected.slice(0, SELECTION_LAYER_LIMIT).map((layer) => ({
    id: layer.id, name: layer.name, type: layer.type, locked: layer.locked,
    effects: extractEffects(layer).map((effect) => ({ matchName: effect.matchName, displayName: effect.displayName })),
  }));
  return { ...base, data: { compositionId: snapshot.selection.compositionId, layers: rows }, truncated: selected.length > SELECTION_LAYER_LIMIT };
}

function matchesQuery(layer: LayerSnapshot, query: string): boolean {
  return !query || layer.id.toLowerCase() === query || layer.name.toLowerCase().includes(query) || layer.type === query;
}

/** Answers ae_find_project_objects: layers whose id, name or type matches the query; the open composition's matches are the answer when it holds any, so a name shared with a layer elsewhere is not offered as a choice. */
export function findObjectsTool({ base, snapshot, args }: ToolRequest<{ readonly query?: string; readonly limit?: number }>): ToolResult {
  const query = (args.query ?? "").toLowerCase();
  const limit = Math.min(100, Math.max(1, args.limit ?? 50));
  const rows = layersInScope(snapshot, (layer) => matchesQuery(layer, query)).layers.slice(0, limit);
  const data = rows.map((layer) => objectOf({
    id: layer.id, name: layer.name, type: layer.type,
    compositionId: snapshot.compositions.find((composition) => composition.layers.includes(layer))?.id ?? null, selected: layer.isSelected,
  }));
  return { ...base, data };
}
