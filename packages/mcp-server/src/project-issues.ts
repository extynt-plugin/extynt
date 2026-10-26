// Structural warnings and layout risks for a project or one composition.
import { findProperty } from "@extynt/project-graph";
import type { CompositionSnapshot, LayerSnapshot, ProjectSnapshot, PropertySnapshot } from "@extynt/project-graph";
import { isJsonArray } from "@extynt/decode";

type ProjectIssue = { code: string; severity: "error" | "warning" | "info"; message: string; compositionId?: string; layerId?: string; layerName?: string; animated?: boolean | undefined };

const POSITION = "ADBE Transform Group/ADBE Position";
const SCALE = "ADBE Transform Group/ADBE Scale";
const OPACITY = "ADBE Transform Group/ADBE Opacity";
const NON_RENDERING = new Set(["camera", "light", "null", "adjustment"]);

/** The snapshot's host warnings and missing sources, then each selected composition's locked layers, name clashes and layout risks. */
export function listProjectIssues(snapshot: ProjectSnapshot, compositionId?: string): ProjectIssue[] {
  const issues: ProjectIssue[] = snapshotIssues(snapshot);
  for (const composition of selectedCompositions(snapshot, compositionId)) issues.push(...compositionIssues(composition));
  return issues;
}

function snapshotIssues(snapshot: ProjectSnapshot): ProjectIssue[] {
  const issues: ProjectIssue[] = (snapshot.warnings ?? []).map((message) => ({ code: "HOST_WARNING", severity: "warning", message }));
  for (const source of snapshot.sources ?? []) {
    if (source.missing) issues.push({ code: "MISSING_SOURCE", severity: "error", message: `Source ${source.id} is missing.` });
  }
  if (snapshot.truncation?.truncated) issues.push({ code: "TRUNCATED_SNAPSHOT", severity: "warning", message: "Snapshot limits were reached; absence is not proof." });
  return issues;
}

function selectedCompositions(snapshot: ProjectSnapshot, compositionId?: string): CompositionSnapshot[] {
  return compositionId ? snapshot.compositions.filter((composition) => composition.id === compositionId) : snapshot.compositions;
}

function compositionIssues(composition: CompositionSnapshot): ProjectIssue[] {
  const locked = composition.layers.filter((layer) => layer.locked).map((layer) => ({ ...at(composition, layer), code: "LOCKED_LAYER", severity: "info" as const, message: `Layer ${layer.id} is locked.` }));
  return [...locked, ...nameIssues(composition), ...layoutIssues(composition)];
}

function at(composition: CompositionSnapshot, layer: LayerSnapshot) { return { compositionId: composition.id, layerId: layer.id, layerName: layer.name }; }

function nameIssues(composition: CompositionSnapshot): ProjectIssue[] {
  const issues: ProjectIssue[] = [];
  const enabled = composition.layers.filter((layer) => layer.enabled);
  const normalized = enabled.map((layer) => ({ layer, name: layer.name.trim().replace(/\s+/g, " ").toLowerCase() }));
  const seen = new Map<string, LayerSnapshot>();
  for (const { layer, name } of normalized) {
    const first = seen.get(name);
    if (first) issues.push({ ...at(composition, layer), code: "DUPLICATE_LAYER_NAME", severity: "warning", message: `Enabled layers ${first.id} and ${layer.id} share one name; confirm which one is meant to render before targeting either.` });
    else seen.set(name, layer);
  }
  for (const shorter of normalized) for (const longer of normalized) {
    if (shorter.layer === longer.layer || longer.name.length <= shorter.name.length || !longer.name.startsWith(`${shorter.name} `)) continue;
    issues.push({ ...at(composition, shorter.layer), code: "SUPERSEDED_LAYER_CANDIDATE", severity: "warning", message: `Enabled layers ${shorter.layer.id} and ${longer.layer.id} have names where one extends the other; one may be a replacement that left the original visible.` });
  }
  return issues;
}

function layoutIssues(composition: CompositionSnapshot): ProjectIssue[] {
  const issues: ProjectIssue[] = [];
  for (const layer of composition.layers) {
    if (!layer.enabled || NON_RENDERING.has(layer.type)) continue;
    issues.push(...layerLayoutIssues(composition, layer));
  }
  return issues;
}

function layerLayoutIssues(composition: CompositionSnapshot, layer: LayerSnapshot): ProjectIssue[] {
  const scale = findProperty(layer, { path: SCALE }), opacity = findProperty(layer, { path: OPACITY }), position = findProperty(layer, { path: POSITION });
  const issues: ProjectIssue[] = [];
  const zeroScale = zeroScaleIssue(composition, layer, scale);
  if (zeroScale) issues.push(zeroScale);
  const transparent = transparentIssue(composition, layer, opacity);
  if (transparent) issues.push(transparent);
  const offCanvas = offCanvasIssue(composition, layer, position);
  if (offCanvas) issues.push(offCanvas);
  return issues;
}

function animatedAt(property: PropertySnapshot | undefined): boolean | undefined {
  return !!property && ((property.keyframeCount ?? 0) > 0 || property.expressionEnabled);
}

function severityOf(animated: boolean | undefined): "info" | "warning" { return animated ? "info" : "warning"; }

function zeroScaleIssue(composition: CompositionSnapshot, layer: LayerSnapshot, property: PropertySnapshot | undefined): ProjectIssue | undefined {
  const value = property?.value;
  if (!isJsonArray(value) || value.length < 2) return undefined;
  if (Math.abs(Number(value[0])) >= 0.5 || Math.abs(Number(value[1])) >= 0.5) return undefined;
  const animated = animatedAt(property);
  return { ...at(composition, layer), code: "ZERO_SCALE_AT_CURRENT_TIME", severity: severityOf(animated), animated, message: `Layer ${layer.id} has zero scale at the current time.` };
}

function transparentIssue(composition: CompositionSnapshot, layer: LayerSnapshot, property: PropertySnapshot | undefined): ProjectIssue | undefined {
  const value = property?.value;
  if (typeof value !== "number" || !(value <= 0)) return undefined;
  const animated = animatedAt(property);
  return { ...at(composition, layer), code: "TRANSPARENT_AT_CURRENT_TIME", severity: severityOf(animated), animated, message: `Layer ${layer.id} has 0% opacity at the current time.` };
}

function outsideFrame(composition: CompositionSnapshot, x: number, y: number): boolean {
  return x < 0 || y < 0 || x > composition.width || y > composition.height;
}

function pointOf(property: PropertySnapshot | undefined): { x: number; y: number } | undefined {
  const value = property?.value;
  if (!isJsonArray(value) || value.length < 2) return undefined;
  const x = Number(value[0]);
  const y = Number(value[1]);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined;
}

function offCanvasIssue(composition: CompositionSnapshot, layer: LayerSnapshot, property: PropertySnapshot | undefined): ProjectIssue | undefined {
  if (layer.parentId !== null) return undefined;
  const position = pointOf(property);
  if (!position || !outsideFrame(composition, position.x, position.y)) return undefined;
  const { x, y } = position;
  const animated = animatedAt(property);
  return { ...at(composition, layer), code: "OFF_CANVAS_AT_CURRENT_TIME", severity: severityOf(animated), animated, message: `Layer ${layer.id} is positioned at [${Math.round(x)}, ${Math.round(y)}], outside the ${composition.width}x${composition.height} frame at the current time; capture a frame before judging the layout.` };
}
