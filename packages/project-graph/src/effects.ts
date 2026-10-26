/** Effect and expression extraction from layer property trees, and queries over them across a project snapshot. */
import type { CompositionSnapshot, EffectSnapshot, ExpressionSnapshot, LayerSnapshot, ProjectSnapshot, PropertySnapshot } from "./model.js";

const EFFECT_PARADE_MATCH_NAME = "ADBE Effect Parade";

/** An effect and the layer and composition it sits on. */
export type EffectMatch = {
  compositionId: string;
  layerId: string;
  layerName: string;
  effect: EffectSnapshot;
};

/** An expression and the layer and composition it sits on. */
export type ExpressionMatch = {
  compositionId: string;
  layerId: string;
  layerName: string;
  expression: ExpressionSnapshot;
};

/** Filters for the effects of one layer, by stable path, matchName or display name; an omitted field matches every effect. */
export type LayerEffectQuery = {
  path?: string;
  matchName?: string;
  name?: string;
};

/** Filters for `queryEffects`: a layer query plus the layers to look at; an omitted or undefined field matches everything. */
export type EffectQuery = LayerEffectQuery & {
  compositionId?: string | undefined;
  layerId?: string;
  selectedLayer?: boolean;
};

/** Filters for `queryExpressions`; an omitted or undefined field matches everything. */
export type ExpressionQuery = {
  compositionId?: string | undefined;
  layerId?: string;
  path?: string;
  matchName?: string;
  selectedLayer?: boolean;
};

/** Accepts both the generic `ADBE Effect Parade` group shape and `kind: effect` roots; localized display names are never used for classification. */
export function extractEffects(layer: LayerSnapshot): EffectSnapshot[] {
  const effects: EffectSnapshot[] = [];
  for (const property of layer.properties) {
    if (property.matchName === EFFECT_PARADE_MATCH_NAME) {
      for (const child of property.children ?? []) effects.push(normalizeEffect(child));
    } else if (property.kind === "effect") {
      effects.push(normalizeEffect(property));
    } else {
      collectExplicitEffects(property.children ?? [], effects);
    }
  }
  return dedupeEffects(effects).sort(compareByPath);
}

export function extractExpressions(layer: LayerSnapshot): ExpressionSnapshot[] {
  return extractExpressionsFromProperties(layer.properties).sort(compareByPath);
}

/** Query effects on one layer using stable paths/matchNames, not display names alone. */
export function queryLayerEffects(layer: LayerSnapshot, query: LayerEffectQuery = {}): EffectSnapshot[] {
  return extractEffects(layer).filter((effect) => matchesEffect(effect, query));
}

export function findEffect(layer: LayerSnapshot, query: LayerEffectQuery): EffectSnapshot | undefined {
  return queryLayerEffects(layer, query)[0];
}

/** Query effects across the project. Results are deterministic by identity and path: in code-unit order, not locale collation, since match order travels in the extracted payload. */
export function queryEffects(snapshot: ProjectSnapshot, query: EffectQuery = {}): EffectMatch[] {
  return compositionsFor(snapshot, query.compositionId)
    .flatMap((composition) => composition.layers
      .filter((layer) => matchesLayerQuery(layer, query))
      .flatMap((layer) => queryLayerEffects(layer, query).map((effect) => ({
        compositionId: composition.id,
        layerId: layer.id,
        layerName: layer.name,
        effect,
      })))).sort(compareEffectMatches);
}

export function getSelectedLayerEffects(snapshot: ProjectSnapshot, compositionId = snapshot.selection.compositionId): EffectMatch[] {
  return queryEffects(snapshot, { compositionId: compositionId ?? undefined, selectedLayer: true });
}

/** Disabled expressions remain visible when authored. */
export function queryExpressions(snapshot: ProjectSnapshot, query: ExpressionQuery = {}): ExpressionMatch[] {
  return compositionsFor(snapshot, query.compositionId)
    .flatMap((composition) => composition.layers
      .filter((layer) => matchesLayerQuery(layer, query))
      .flatMap((layer) => extractExpressions(layer)
        .filter((expression) => matchesExpression(expression, query))
        .map((expression) => ({ compositionId: composition.id, layerId: layer.id, layerName: layer.name, expression })))).sort(compareExpressionMatches);
}

export function getSelectedLayerExpressions(snapshot: ProjectSnapshot, compositionId = snapshot.selection.compositionId): ExpressionMatch[] {
  return queryExpressions(snapshot, { compositionId: compositionId ?? undefined, selectedLayer: true });
}

function matchesLayerQuery(layer: LayerSnapshot, query: { layerId?: string; selectedLayer?: boolean }): boolean {
  return (query.layerId === undefined || layer.id === query.layerId) && (query.selectedLayer === undefined || layer.isSelected === query.selectedLayer);
}

function normalizeEffect(property: PropertySnapshot): EffectSnapshot {
  const properties = property.children ?? [];
  return {
    path: property.path,
    matchName: property.matchName,
    displayName: property.displayName,
    enabled: typeof property.enabled === "boolean" ? property.enabled : null,
    properties,
    expressions: extractExpressionsFromProperties(properties).sort(compareByPath),
  };
}

function collectExplicitEffects(properties: PropertySnapshot[], effects: EffectSnapshot[]): void {
  for (const property of properties) {
    if (property.kind === "effect") effects.push(normalizeEffect(property));
    else collectExplicitEffects(property.children ?? [], effects);
  }
}

function extractExpressionsFromProperties(properties: PropertySnapshot[]): ExpressionSnapshot[] {
  const expressions: ExpressionSnapshot[] = [];
  for (const property of properties) {
    if (property.expression !== undefined && (property.expression !== null || property.expressionEnabled === true)) {
      expressions.push({
        path: property.path,
        matchName: property.matchName,
        displayName: property.displayName,
        expression: property.expression,
        enabled: property.expressionEnabled === true,
        valueType: property.valueType,
      });
    }
    expressions.push(...extractExpressionsFromProperties(property.children ?? []));
  }
  return expressions;
}

function compositionsFor(snapshot: ProjectSnapshot, compositionId: string | undefined): CompositionSnapshot[] {
  return compositionId === undefined ? snapshot.compositions : snapshot.compositions.filter((composition) => composition.id === compositionId);
}

function matchesEffect(effect: EffectSnapshot, query: LayerEffectQuery): boolean {
  return (query.path === undefined || effect.path === query.path) &&
    (query.matchName === undefined || effect.matchName === query.matchName) &&
    (query.name === undefined || effect.displayName === query.name);
}

function matchesExpression(expression: ExpressionSnapshot, query: ExpressionQuery): boolean {
  return (query.path === undefined || expression.path === query.path) &&
    (query.matchName === undefined || expression.matchName === query.matchName);
}

function dedupeEffects(effects: EffectSnapshot[]): EffectSnapshot[] {
  const seen = new Set<string>();
  return effects.filter((effect) => {
    const key = `${effect.path}\u0000${effect.matchName}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const compareText = (a: string, b: string): number => (a === b ? 0 : a < b ? -1 : 1);
function compareByPath(a: { path: string }, b: { path: string }): number {
  return compareText(a.path, b.path);
}

function compareEffectMatches(a: EffectMatch, b: EffectMatch): number {
  return compareText(a.compositionId, b.compositionId) || compareText(a.layerId, b.layerId) || compareByPath(a.effect, b.effect);
}

function compareExpressionMatches(a: ExpressionMatch, b: ExpressionMatch): number {
  return compareText(a.compositionId, b.compositionId) || compareText(a.layerId, b.layerId) || compareByPath(a.expression, b.expression);
}
