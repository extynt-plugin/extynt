/**
 * The fixture project as the native plugin reports it. `read_project` and `read_comp` rows carry a content hash per layer and
 * composition, and the values the plugin cannot read (text documents, markers, path values, layer references) are `{unsupported}`
 * with the real value supplied by the `aeReadPropertyDetails` answer, which is also where key digests live.
 */
import { createHash } from "node:crypto";
import { decodedValue, wireObjectOfDocument, type FixtureComposition, type FixtureEntry, type FixtureLayer, type FixtureProject } from "@extynt/fake-plugin";
import type { KeyframeSnapshot, LayerSnapshot, ProjectSnapshot, PropertySnapshot } from "@extynt/project-graph";
import type { WireObject, WireValue } from "./wire-types.js";

/** The values of one layer's unsupported properties, the answer to `aeReadPropertyDetails`. */
export type LayerDetails = { compId: string; layerId: string; properties: WireObject[] };

const UNSUPPORTED_BY_MATCH: ReadonlyMap<string, string> = new Map([
  ["ADBE Text Document", "text-document"], ["ADBE Marker", "marker"], ["ADBE Mask Shape", "shape-path"], ["ADBE Vector Shape", "shape-path"],
]);

function hashOf(value: WireValue): string {
  return createHash("md5").update(JSON.stringify(value)).digest("hex");
}

function unsupportedKind(property: PropertySnapshot): string | undefined {
  if (property.kind !== "property") return undefined;
  if (property.valueType === "layer") return "layer-id";
  return UNSUPPORTED_BY_MATCH.get(property.matchName);
}

function flatten(properties: readonly PropertySnapshot[], into: PropertySnapshot[] = []): PropertySnapshot[] {
  for (const property of properties) {
    into.push(property);
    if (property.children) flatten(property.children, into);
  }
  return into;
}

function keyframeRow(key: KeyframeSnapshot): WireObject {
  const { inType, outType } = key.interpolation ?? {};
  return {
    time: key.time,
    value: key.value,
    ...(key.interpolation ? { interpolation: { ...(inType === undefined ? {} : { inType }), ...(outType === undefined ? {} : { outType }) } } : {}),
  };
}

function entryExtras(property: PropertySnapshot): WireObject {
  return {
    ...(typeof property.keyframeCount === "number" ? { keyframeCount: property.keyframeCount } : {}),
    ...(property.keyframes?.length ? { keyframes: property.keyframes.map(keyframeRow) } : {}),
    ...(property.enabled === undefined ? {} : { enabled: property.enabled }),
    ...(property.hidden === true ? { hidden: true } : {}),
    ...(property.animatable === false ? { animatable: false } : {}),
  };
}

function entryRow(property: PropertySnapshot, unsupported: string | undefined): FixtureEntry {
  return {
    path: property.path, matchName: property.matchName, displayName: property.displayName, kind: property.kind, valueType: property.valueType,
    value: unsupported ? { unsupported } : property.value ?? null, canSetValue: property.canSetValue,
    expression: property.expression ?? null, expressionEnabled: property.expressionEnabled === true, ...entryExtras(property),
  };
}

function detailOf(property: PropertySnapshot, unsupported: string | undefined): WireObject | undefined {
  const detail: WireObject = {
    path: property.path,
    ...(unsupported ? { value: property.value ?? null } : {}),
    ...(typeof property.keyDigest === "string" ? { keyDigest: property.keyDigest } : {}),
  };
  return Object.keys(detail).length > 1 ? detail : undefined;
}

function layerFields(layer: LayerSnapshot): WireObject {
  return {
    startTime: layer.startTime, type: layer.type, enabled: layer.enabled, shy: layer.shy, solo: layer.solo, locked: layer.locked,
    inPoint: layer.inPoint, outPoint: layer.outPoint, stretch: layer.stretch, parentId: layer.parentId,
    matteLayerId: layer.matteLayerId, matteType: layer.matteType, isSelected: layer.isSelected,
    ...(typeof layer.label === "number" ? { label: layer.label } : {}),
    ...(typeof layer.threeD === "boolean" ? { threeD: layer.threeD } : {}),
    sourceId: layer.sourceId, compositionSourceId: layer.compositionSourceId ?? null,
  };
}

interface BuiltLayer { full: FixtureLayer; structure: WireObject; details: WireObject[] }

function builtLayer(layer: LayerSnapshot): BuiltLayer {
  const rows: FixtureEntry[] = [], details: WireObject[] = [];
  for (const property of flatten(layer.properties)) {
    const unsupported = unsupportedKind(property), detail = detailOf(property, unsupported);
    rows.push(entryRow(property, unsupported));
    if (detail) details.push(detail);
  }
  const fields = layerFields(layer);
  const head = { id: layer.id, index: layer.index, name: layer.name, ...fields, hash: hashOf({ fields, name: layer.name, index: layer.index, rows, details }) };
  return { full: { ...head, propertyPaths: rows }, structure: head, details };
}

interface BuiltComposition { full: FixtureComposition; structure: WireObject; details: LayerDetails[] }

function compositionFields(composition: ProjectSnapshot["compositions"][number]): WireObject {
  const settings = decodedValue(wireObjectOfDocument({ ...composition, layers: undefined }));
  return { ...settings, currentTime: composition.currentTime ?? null, truncated: false };
}

function builtComposition(composition: ProjectSnapshot["compositions"][number]): BuiltComposition {
  const layers = composition.layers.map(builtLayer);
  const fields = compositionFields(composition);
  const hash = hashOf({ fields, layers: layers.map((layer) => layer.full.hash ?? null) });
  return {
    full: { ...fields, id: composition.id, name: composition.name, hash, layers: layers.map((layer) => layer.full) },
    structure: { ...fields, hash, layers: layers.map((layer) => layer.structure) },
    details: layers.flatMap((layer, at) => (layer.details.length ? [{ compId: composition.id, layerId: composition.layers[at]?.id ?? "", properties: layer.details }] : [])),
  };
}

/** What the plugin answers for a snapshot: the project rows, the per-layer details, and the structure-only composition rows. */
export interface NativeModel {
  project: FixtureProject;
  details: Map<string, LayerDetails[]>;
  structure: Map<string, WireObject>;
}

/** Everything the plugin would answer for `snapshot`; recomputed after every change to the fixture. */
export function nativeModelOf(snapshot: ProjectSnapshot): NativeModel {
  const details = new Map<string, LayerDetails[]>(), structure = new Map<string, WireObject>(), compositions: FixtureComposition[] = [];
  for (const composition of snapshot.compositions) {
    const built = builtComposition(composition);
    details.set(composition.id, built.details);
    structure.set(composition.id, built.structure);
    compositions.push(built.full);
  }
  const items = (snapshot.items ?? []).map((item) => decodedValue(wireObjectOfDocument(item))),
    sources = (snapshot.sources ?? []).map((source) => decodedValue(wireObjectOfDocument(source)));
  const project: FixtureProject = {
    source: "native", project: { name: snapshot.project.name, filePath: snapshot.project.filePath, dirty: false }, itemCount: items.length,
    activeCompositionId: snapshot.activeCompositionId, currentTime: snapshot.currentTime, selectedLayerIds: snapshot.selection.layerIds,
    items, sources, compositions,
    itemsHash: hashOf(items), projectHash: hashOf(compositions.map((composition) => composition.hash ?? null)), warnings: snapshot.warnings ?? [],
  };
  return { project, details, structure };
}
