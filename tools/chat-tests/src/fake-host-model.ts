/**
 * The fixture's property tree: leaves and groups, lookup and creation of children, the blocks every layer carries, and the
 * marker list a property keeps in its value. Pure data shaping over the project snapshot; refusals come from the callers.
 */

import { findProperty, type CompositionSnapshot, type LayerSnapshot, type PropertySnapshot } from "@extynt/project-graph";
import { type JsonValue } from "@extynt/decode";
import { ANCHOR_PATH, OPACITY_PATH, POSITION_PATH, ROTATION_PATH, SCALE_PATH, SHAPE_ROOT, TEXT_DOCUMENT_PATH, TEXT_PROPERTIES, THREE_D_OPTION_GROUPS, TRANSFORM, type SpecKind, type ThreeDOperation } from "./fake-host-tables.js";
import { escapeSegment, isJsonObject, refuse, valueTypeOf, type JsonObject } from "./fake-host-values.js";

interface LeafOptions {
  path: string;
  matchName: string;
  displayName: string;
  valueType: PropertySnapshot["valueType"];
  value: JsonValue;
  canSetValue?: boolean;
}

interface ChildSpec {
  matchName: string;
  displayName: string;
  valueType: PropertySnapshot["valueType"];
  value?: JsonValue;
}

/** A property leaf. */
export function leaf({ path, matchName, displayName, valueType, value, canSetValue = true }: LeafOptions): PropertySnapshot {
  return { path, matchName, displayName, kind: "property", valueType, value, canSetValue };
}

/** A property group, empty unless given children. */
export function group(path: string, matchName: string, displayName: string, children: PropertySnapshot[] = []): PropertySnapshot {
  return { path, matchName, displayName, kind: "group", valueType: "unknown", value: null, canSetValue: false, children };
}

/** The path segment a new child named `matchName` takes under `parent`: repeats carry a `#n` ordinal. */
export function childSegment(parent: PropertySnapshot, matchName: string): string {
  const ordinal = (parent.children ?? []).filter((child) => child.matchName === matchName).length + 1;
  return ordinal > 1 ? `${escapeSegment(matchName)}#${ordinal}` : escapeSegment(matchName);
}

/** The node's child list, created when it has none. */
export function childrenOf(node: PropertySnapshot): PropertySnapshot[] { return node.children ?? (node.children = []); }

/** A synthetic root over a layer's own property list, so the layer-level groups share the child helpers. */
export function layerRoot(layer: LayerSnapshot): PropertySnapshot {
  return { path: "", matchName: "", displayName: layer.name, kind: "group", valueType: "unknown", value: null, canSetValue: false, children: layer.properties };
}

function joinPath(parent: PropertySnapshot, segment: string): string { return parent.path ? `${parent.path}/${segment}` : segment; }

/** The child group named `matchName`, created when it is not there yet. */
export function ensureChildGroup(parent: PropertySnapshot, matchName: string, displayName: string): PropertySnapshot {
  const children = childrenOf(parent);
  const existing = children.find((child) => child.matchName === matchName);
  if (existing) return existing;
  const created = group(joinPath(parent, childSegment(parent, matchName)), matchName, displayName);
  children.push(created);
  return created;
}

/** The direct child named `matchName`, if any. */
export function findChild(node: PropertySnapshot, matchName: string): PropertySnapshot | undefined {
  return (node.children ?? []).find((child) => child.matchName === matchName);
}

/** The child property named by `spec`, created when it is not there yet. */
export function ensureChildProperty(parent: PropertySnapshot, spec: ChildSpec): PropertySnapshot {
  const children = childrenOf(parent);
  const existing = children.find((child) => child.matchName === spec.matchName);
  if (existing) return existing;
  const created = leaf({
    path: joinPath(parent, escapeSegment(spec.matchName)),
    matchName: spec.matchName,
    displayName: spec.displayName,
    valueType: spec.valueType,
    value: spec.value ?? null,
  });
  children.push(created);
  return created;
}

/** Materialise one setting leaf (and any intermediate group its path needs) on a shape item or animator. */
export function materializeSetting(item: PropertySnapshot, path: string, kind: SpecKind): PropertySnapshot {
  const segments = path.split("/");
  const name = segments.pop() ?? path;
  let node = item;
  for (const segment of segments) {
    const existing = findChild(node, segment);
    if (existing) { node = existing; continue; }
    const intermediate = group(`${node.path}/${escapeSegment(segment)}`, segment, segment);
    childrenOf(node).push(intermediate);
    node = intermediate;
  }
  return ensureChildProperty(node, { matchName: name, displayName: name, valueType: valueTypeOf(kind) });
}

/** How many keys a property has, whether the fixture holds them or only their count. */
export function keyframeCount(property: PropertySnapshot): number { return property.keyframeCount ?? property.keyframes?.length ?? 0; }

/** The property at `path` on the layer, if it is there. */
export function propertyOf(layer: LayerSnapshot, path: string): PropertySnapshot | undefined { return findProperty(layer, { path }); }

/** The property at `path`, or a PROPERTY_NOT_FOUND refusal labelled with the operation. */
export function requireProperty(layer: LayerSnapshot, path: string, label: string): PropertySnapshot {
  const property = propertyOf(layer, path);
  if (!property) refuse("PROPERTY_NOT_FOUND", `${label}: ${path} is not present on layer ${layer.id} "${layer.name}" in this fixture.`);
  return property;
}

/** Refuses a group, or a property After Effects reports as not settable. */
export function requireSettable(property: PropertySnapshot, label: string): void {
  if (property.kind !== "property" || property.canSetValue === false) refuse("PROPERTY_NOT_SETTABLE", `${label}: After Effects reports ${property.path} as not settable, and the fixture will not pretend it wrote it.`);
}

/** The transform block every fixture layer carries, with the values the host itself creates a layer with. */
export function transformProperties(composition: CompositionSnapshot): PropertySnapshot[] {
  return [
    group(TRANSFORM, TRANSFORM, "Transform", [
      leaf({ path: ANCHOR_PATH, matchName: "ADBE Anchor Point", displayName: "Anchor Point", valueType: "vector", value: [0, 0] }),
      leaf({ path: POSITION_PATH, matchName: "ADBE Position", displayName: "Position", valueType: "vector", value: [composition.width / 2, composition.height / 2] }),
      leaf({ path: SCALE_PATH, matchName: "ADBE Scale", displayName: "Scale", valueType: "vector", value: [100, 100] }),
      leaf({ path: ROTATION_PATH, matchName: "ADBE Rotate Z", displayName: "Rotation", valueType: "number", value: 0 }),
      leaf({ path: OPACITY_PATH, matchName: "ADBE Opacity", displayName: "Opacity", valueType: "number", value: 100 }),
    ]),
  ];
}

/** The text block of a text layer: its document and an empty animator group. */
export function textProperties(text: string): PropertySnapshot[] {
  return [group(TEXT_PROPERTIES, TEXT_PROPERTIES, "Text", [
    leaf({ path: TEXT_DOCUMENT_PATH, matchName: "ADBE Text Document", displayName: "Source Text", valueType: "string", value: text }),
    group(`${TEXT_PROPERTIES}/ADBE Text Animators`, "ADBE Text Animators", "Animators"),
  ])];
}

/** The empty contents group of a shape layer. */
export function shapeRootProperties(): PropertySnapshot[] {
  return [group(SHAPE_ROOT, SHAPE_ROOT, "Contents")];
}

/** An option group with every option present and no value claimed: the fixture does not know After Effects' defaults. */
export function threeDOptionGroup(operationType: ThreeDOperation): PropertySnapshot {
  const spec = THREE_D_OPTION_GROUPS[operationType];
  return group(spec.matchName, spec.matchName, spec.displayName, Object.values(spec.options).map((option) => leaf({ path: `${spec.matchName}/${option.matchName}`, matchName: option.matchName, displayName: option.displayName, valueType: option.kind, value: null })));
}

/** The markers a marker property keeps in its value. */
export function markersOf(property: PropertySnapshot | undefined): JsonObject[] {
  const list = property && isJsonObject(property.value) ? property.value.markers : undefined;
  return Array.isArray(list) ? list.filter(isJsonObject) : [];
}

/** Stores the markers sorted by time, in the value and as keys. */
export function writeMarkers(property: PropertySnapshot, markers: JsonObject[]): void {
  const sorted = [...markers].sort((left, right) => Number(left.time) - Number(right.time));
  property.value = { count: sorted.length, markers: sorted };
  property.keyframes = sorted.map((marker) => ({ time: Number(marker.time), value: marker }));
  property.keyframeCount = sorted.length;
}
