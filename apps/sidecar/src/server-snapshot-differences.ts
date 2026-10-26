// A bounded, id-only description of what differs between two snapshots; it never carries values or names.
import type { JsonValue } from "@extynt/decode";
import type { CompositionSnapshot, LayerSnapshot, ProjectSnapshot, PropertySnapshot } from "@extynt/project-graph";

interface Lines {
  readonly lines: string[];
  readonly limit: number;
}

const COMPOSITION_KEYS = ["width", "height", "duration", "frameRate"] as const;
const LAYER_KEYS = ["name", "index", "enabled", "label", "parentId", "inPoint", "outPoint", "startTime"] as const;

function add(output: Lines, line: string): void {
  if (output.lines.length < output.limit) output.lines.push(line);
}

function sameJson(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function keyframeChanged(before: PropertySnapshot, after: PropertySnapshot): boolean {
  return (before.keyframeCount ?? 0) !== (after.keyframeCount ?? 0) || (before.keyDigest ?? null) !== (after.keyDigest ?? null);
}

function propertyChanged(before: PropertySnapshot, after: PropertySnapshot): boolean {
  const animated = (before.keyframeCount ?? 0) > 0 || before.expressionEnabled;
  return keyframeChanged(before, after) || before.expression !== after.expression || (!animated && !sameJson(before.value, after.value));
}

function compareProperties(before: LayerSnapshot, after: LayerSnapshot, scope: string, output: Lines): void {
  const later = new Map(after.properties.map((property) => [property.path, property]));
  for (const property of before.properties) {
    const next = later.get(property.path);
    if (!next) add(output, `layer ${scope}/${before.id} property removed ${property.path}`);
    else if (propertyChanged(property, next)) add(output, `layer ${scope}/${before.id} ${property.path}`);
  }
  for (const property of after.properties) {
    if (!before.properties.some((candidate) => candidate.path === property.path)) add(output, `layer ${scope}/${before.id} property added ${property.path}`);
  }
}

function compareLayer(before: LayerSnapshot, after: LayerSnapshot, scope: string, output: Lines): void {
  for (const key of LAYER_KEYS) if (!sameJson(before[key], after[key])) add(output, `layer ${scope}/${before.id} ${key}`);
  compareProperties(before, after, scope, output);
}

function compareLayers(before: CompositionSnapshot, after: CompositionSnapshot, output: Lines): void {
  const later = new Map(after.layers.map((layer) => [layer.id, layer]));
  for (const layer of before.layers) {
    const next = later.get(layer.id);
    if (next) compareLayer(layer, next, before.id, output);
    else add(output, `layer ${before.id}/${layer.id} missing`);
  }
  for (const layer of after.layers) {
    if (!before.layers.some((candidate) => candidate.id === layer.id)) add(output, `layer ${before.id}/${layer.id} added`);
  }
}

function compareComposition(before: CompositionSnapshot, after: CompositionSnapshot, output: Lines): void {
  for (const key of COMPOSITION_KEYS) if (before[key] !== after[key]) add(output, `composition ${before.id} ${key}`);
  if (!sameJson(before.backgroundColor, after.backgroundColor)) add(output, `composition ${before.id} backgroundColor`);
  compareLayers(before, after, output);
}

function compareItemCounts(before: ProjectSnapshot, after: ProjectSnapshot, output: Lines): void {
  const was = before.items?.length ?? 0, now = after.items?.length ?? 0;
  if (was !== now) add(output, `project items ${was} -> ${now}`);
}

/** The ids of what differs between two snapshots, at most `limit` lines. */
export function snapshotDifferences(before: ProjectSnapshot, after: ProjectSnapshot, limit = 12): string[] {
  const output: Lines = { lines: [], limit };
  const later = new Map(after.compositions.map((composition) => [composition.id, composition]));
  compareItemCounts(before, after, output);
  for (const composition of before.compositions) {
    const next = later.get(composition.id);
    if (next) compareComposition(composition, next, output);
    else add(output, `composition ${composition.id} missing`);
  }
  for (const composition of after.compositions) {
    if (!before.compositions.some((candidate) => candidate.id === composition.id)) add(output, `composition ${composition.id} added`);
  }
  return output.lines;
}
