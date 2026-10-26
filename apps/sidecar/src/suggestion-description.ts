// Describes the selected layers as a small bounded JSON text: the only project data a prompt suggestion request ever sees.
import { extractEffects, flattenProperties, getActiveComposition, getSelectedLayers, type LayerSnapshot, type ProjectSnapshot } from "@extynt/project-graph";

/** The ceilings that keep the description small whatever the project holds: it never grows with the project, only with the selection, and then only up to these. */
export const DESCRIPTION_LIMITS = { layers: 6, name: 40, effects: 6, effectName: 32, characters: 2400 } as const;

interface SelectionDescription {
  readonly text: string;
  readonly layers: number;
  readonly omitted: number;
}

interface LayerView {
  readonly kind: string;
  readonly name: string;
  readonly inSeconds: number;
  readonly outSeconds: number;
  readonly hidden?: true;
  readonly effects: readonly string[];
  readonly moreEffects?: number;
  readonly keyframedProperties: number;
  readonly hasParent?: true;
  readonly usesMatte?: true;
}

const round = (value: number): number => Math.round(value * 100) / 100;
const finite = (value: number): number => (Number.isFinite(value) ? round(value) : 0);

/** Control characters and runs of whitespace become one space, so a name can never carry a line break or an escape into the prompt. */
export function cleanName(value: string, limit: number): string {
  const text = value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function kindOf(layer: LayerSnapshot, sources: ReadonlyMap<string, string>): string {
  if (layer.compositionSourceId) return "precomp";
  if (layer.type !== "av") return layer.type;
  return (layer.sourceId ? sources.get(layer.sourceId) : undefined) ?? "av";
}

function keyframedProperties(layer: LayerSnapshot): number {
  return flattenProperties(layer.properties).filter((property) => (property.keyframeCount ?? property.keyframes?.length ?? 0) > 0).length;
}

function layerView(layer: LayerSnapshot, sources: ReadonlyMap<string, string>): LayerView {
  const effects = extractEffects(layer);
  return {
    kind: kindOf(layer, sources),
    name: cleanName(layer.name, DESCRIPTION_LIMITS.name),
    inSeconds: finite(layer.inPoint),
    outSeconds: finite(layer.outPoint),
    ...(layer.enabled ? {} : { hidden: true }),
    effects: effects.slice(0, DESCRIPTION_LIMITS.effects).map((effect) => cleanName(effect.displayName || effect.matchName || "", DESCRIPTION_LIMITS.effectName)),
    ...(effects.length > DESCRIPTION_LIMITS.effects ? { moreEffects: effects.length - DESCRIPTION_LIMITS.effects } : {}),
    keyframedProperties: keyframedProperties(layer),
    ...(layer.parentId ? { hasParent: true } : {}),
    ...(layer.matteType !== "none" ? { usesMatte: true } : {}),
  };
}

function render(snapshot: ProjectSnapshot, layers: readonly LayerView[], selected: number): string {
  const composition = getActiveComposition(snapshot);
  const omitted = selected - layers.length;
  return JSON.stringify({
    composition: composition ? { name: cleanName(composition.name, DESCRIPTION_LIMITS.name), durationSeconds: finite(composition.duration), frameRate: finite(composition.frameRate) } : null,
    selectedLayers: selected,
    layers,
    ...(omitted > 0 ? { notDescribed: omitted } : {}),
  });
}

function renderWithinBudget(snapshot: ProjectSnapshot, views: readonly LayerView[], selected: number): SelectionDescription {
  for (let shown = views.length; shown > 1; shown -= 1) {
    const text = render(snapshot, views.slice(0, shown), selected);
    if (text.length <= DESCRIPTION_LIMITS.characters) return { text, layers: shown, omitted: selected - shown };
  }
  return { text: render(snapshot, views.slice(0, 1), selected), layers: 1, omitted: selected - 1 };
}

/**
 * A compact, bounded description of ONLY the selected layers: kind, truncated name, effects, timing and how much is
 * keyframed. Nothing else of the project is included (no other layers, no values, no expressions, no paths). Undefined
 * when nothing is selected, else the text with how many layers it describes and how many it left out. Layers past the ceiling, or past the character budget, are counted rather than described.
 */
export function describeSelection(snapshot: ProjectSnapshot): SelectionDescription | undefined {
  const selected = getSelectedLayers(snapshot);
  if (selected.length === 0) return undefined;
  const sources = new Map((snapshot.sources ?? []).map((source) => [source.id, source.type] as const));
  const views = selected.slice(0, DESCRIPTION_LIMITS.layers).map((layer) => layerView(layer, sources));
  return renderWithinBudget(snapshot, views, selected.length);
}
