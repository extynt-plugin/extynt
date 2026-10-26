// Reads a composition's layers into the one-line-per-layer list and the counts of the project index the agent briefing opens with.
import { extractEffects, type LayerSnapshot, type PropertySnapshot } from "@extynt/project-graph";
import { MAX_BRIEFING_PROPERTY_DEPTH, clean } from "./agent-policy.js";

/** What names a layer's kind: the source types by source id and the ids of the compositions a layer may be a precomp of. */
export interface KindLookup {
  readonly sourceTypes: ReadonlyMap<string, string>;
  readonly compositionIds: ReadonlySet<string>;
}

/** Counts over a composition's layers: by kind, selected, locked, hidden, with effects, keyframed and expressed. */
export interface LayerIndex {
  readonly byKind: ReadonlyMap<string, number>;
  readonly selected: number;
  readonly locked: number;
  readonly hidden: number;
  readonly effectedLayers: number;
  readonly effectInstances: number;
  readonly keyframed: number;
  readonly expressed: number;
}

interface PropertyCounts {
  readonly keyframed: number;
  readonly expressed: number;
}

const NO_PROPERTIES: PropertyCounts = { keyframed: 0, expressed: 0 };
const EFFECT_PARADE = "ADBE Effect Parade";

const flag = (condition: boolean): number => (condition ? 1 : 0);

/** The kind the model is told: `av` is a snapshot implementation detail, so a solid is called a solid. */
export function layerKind(layer: LayerSnapshot, lookup: KindLookup): string {
  if (layer.type !== "av") return layer.type;
  if (layer.sourceId && lookup.compositionIds.has(layer.sourceId)) return "precomp";
  const sourceType = layer.sourceId ? lookup.sourceTypes.get(layer.sourceId) : undefined;
  return sourceType === "solid" ? "solid" : sourceType === "footage" ? "footage" : "av-layer";
}

/** The layer's list line: index, id, name, kind, and `[selected]` when it is. */
export function layerLine(layer: LayerSnapshot, isSelected: boolean, kind: string): string {
  return [`${layer.index} ${layer.id} "${clean(layer.name)}" ${kind}`, isSelected ? "[selected]" : ""].filter(Boolean).join(" ");
}

function leafEffectPaths(properties: readonly PropertySnapshot[] | undefined, paths: Set<string>): void {
  for (const property of properties ?? []) {
    const segments = property.path.split("/");
    if (segments[0] === EFFECT_PARADE && segments[1]) paths.add(`${EFFECT_PARADE}/${segments[1]}`);
    leafEffectPaths(property.children, paths);
  }
}

function effectInstanceCount(layer: LayerSnapshot): number {
  const paths = new Set(extractEffects(layer).map((effect) => effect.path));
  leafEffectPaths(layer.properties, paths);
  return paths.size;
}

const hasKeyframes = (property: PropertySnapshot): boolean => (property.keyframes?.length ?? 0) > 0 || (property.keyframeCount ?? 0) > 0;

const hasExpression = (property: PropertySnapshot): boolean => (typeof property.expression === "string" && property.expression.length > 0) || property.expressionEnabled === true;

function propertyCounts(property: PropertySnapshot): PropertyCounts {
  return { keyframed: flag(hasKeyframes(property)), expressed: flag(hasExpression(property)) };
}

function propertyTree(properties: readonly PropertySnapshot[] | undefined, depth: number): PropertyCounts {
  if (depth > MAX_BRIEFING_PROPERTY_DEPTH) return NO_PROPERTIES;
  return (properties ?? []).reduce((total, property) => {
    const own = propertyCounts(property);
    const below = propertyTree(property.children, depth + 1);
    return { keyframed: total.keyframed + own.keyframed + below.keyframed, expressed: total.expressed + own.expressed + below.expressed };
  }, NO_PROPERTIES);
}

/** The layers counted by kind and by the facts the index states; property counts stop at the briefing's depth limit. */
export function summarizeLayers(layers: readonly LayerSnapshot[], selected: ReadonlySet<string>, lookup: KindLookup): LayerIndex {
  const byKind = new Map<string, number>();
  let counts = { selected: 0, locked: 0, hidden: 0, effectedLayers: 0, effectInstances: 0, keyframed: 0, expressed: 0 };
  for (const layer of layers) {
    const kind = layerKind(layer, lookup);
    byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
    const effects = effectInstanceCount(layer);
    const properties = propertyTree(layer.properties, 0);
    counts = {
      selected: counts.selected + flag(selected.has(layer.id)),
      locked: counts.locked + flag(layer.locked),
      hidden: counts.hidden + flag(!layer.enabled),
      effectedLayers: counts.effectedLayers + flag(effects > 0),
      effectInstances: counts.effectInstances + effects,
      keyframed: counts.keyframed + properties.keyframed,
      expressed: counts.expressed + properties.expressed,
    };
  }
  return { byKind, ...counts };
}
