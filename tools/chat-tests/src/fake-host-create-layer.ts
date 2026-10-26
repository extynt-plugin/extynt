/** The create_layer operation: its options are validated whole, then the layer is built with the properties its type carries. */

import type { CompositionSnapshot, LayerSnapshot, ProjectItemSnapshot, PropertySnapshot } from "@extynt/project-graph";
import { mintId, realName, resolveComposition, type ApplyOutcome, type FixtureApplyContext } from "./fake-host-context.js";
import { shapeRootProperties, textProperties, threeDOptionGroup, transformProperties } from "./fake-host-model.js";
import { isFiniteNumber, numericVector, placeholderOf, refuse, targetOf, textOf, tuple2, type Field } from "./fake-host-values.js";
import type { WireObject } from "./wire-types.js";

const FIXTURE_LAYER_TYPES = ["text", "shape", "null", "camera", "light", "adjustment", "solid", "footage"] as const;

type FixtureLayerType = typeof FIXTURE_LAYER_TYPES[number];

type FootageSource = Pick<LayerSnapshot, "sourceId"> & { compositionSourceId: string | null; outPoint: number };

interface BuiltLayer extends FootageSource { type: LayerSnapshot["type"]; properties: PropertySnapshot[] }

interface CreateRequest { operation: WireObject; composition: CompositionSnapshot; placeholder: string; layerType: FixtureLayerType; name: string }

const SNAPSHOT_TYPES: Readonly<Record<FixtureLayerType, LayerSnapshot["type"]>> = { text: "text", shape: "shape", null: "null", camera: "camera", light: "light", adjustment: "adjustment", solid: "av", footage: "av" };

const TYPE_PROPERTIES: Readonly<Partial<Record<FixtureLayerType, (operation: WireObject) => PropertySnapshot[]>>> = {
  text: (operation) => textProperties(typeof operation.text === "string" ? operation.text : ""),
  shape: () => shapeRootProperties(),
  camera: () => [threeDOptionGroup("set_camera_options")],
  light: () => [threeDOptionGroup("set_light_options")],
};

const CREATE_TEXT_JUSTIFICATIONS: readonly string[] = ["LEFT_JUSTIFY", "CENTER_JUSTIFY", "RIGHT_JUSTIFY", "FULL_JUSTIFY_LASTLINE_LEFT", "FULL_JUSTIFY_LASTLINE_RIGHT", "FULL_JUSTIFY_LASTLINE_CENTER", "FULL_JUSTIFY_LASTLINE_FULL"];

function isFixtureLayerType(value: Field): value is FixtureLayerType { return FIXTURE_LAYER_TYPES.some((type) => type === value); }

function hasValue(value: Field): boolean { return value !== undefined && value !== null; }

function validateCreateJustification(operation: WireObject, layerType: FixtureLayerType): void {
  const justification = operation.justification;
  if (!hasValue(justification)) return;
  if (layerType !== "text") refuse("INVALID_VALUE", "create_layer justification applies only to a text layer.");
  if (typeof justification !== "string" || !CREATE_TEXT_JUSTIFICATIONS.includes(justification)) refuse("INVALID_VALUE", "create_layer justification must be a ParagraphJustification name.");
}

function validateCreateLayerOptions(operation: WireObject, layerType: FixtureLayerType): void {
  if (hasValue(operation.box)) {
    if (layerType !== "text") refuse("INVALID_VALUE", "create_layer box applies only to a text layer.");
    numericVector(operation.box, "create_layer box", [2]);
  }
  if (hasValue(operation.vertical) && typeof operation.vertical !== "boolean") refuse("INVALID_VALUE", "create_layer vertical must be boolean.");
  validateCreateJustification(operation, layerType);
  if (hasValue(operation.color)) numericVector(operation.color, "create_layer color", [3, 4]);
  if (hasValue(operation.size) && layerType !== "solid") refuse("INVALID_VALUE", "create_layer size applies only to a solid layer.");
}

function validateCreateLayer(context: FixtureApplyContext, operation: WireObject): CreateRequest {
  const target = targetOf(operation), composition = resolveComposition(context, target.compositionId, "create_layer");
  const placeholder = placeholderOf(target.layerId, "create_layer declares target.layerId, which must be a __new__:<name> placeholder for the layer it creates.");
  if (context.bindings[placeholder]) refuse("INVALID_OPERATION", `create_layer declares ${placeholder}, which an earlier operation in this call already created.`);
  const layerType = operation.layerType;
  if (!isFixtureLayerType(layerType)) refuse("INVALID_VALUE", "create_layer layerType must be one of text, shape, null, camera, light, adjustment, solid, footage.");
  const name = textOf(operation.name, "create_layer name", { min: 1, max: 256 });
  validateCreateLayerOptions(operation, layerType);
  return { operation, composition, placeholder, layerType, name };
}

function footageFromComposition(composition: CompositionSnapshot, sourceComposition: CompositionSnapshot): FootageSource {
  if (sourceComposition.id === composition.id) refuse("INVALID_VALUE", "create_layer cannot use the target composition as its own footage source.");
  return { sourceId: sourceComposition.id, compositionSourceId: sourceComposition.id, outPoint: sourceComposition.duration };
}

function projectItemForLayer(context: FixtureApplyContext, rawSource: string, itemId: string): ProjectItemSnapshot {
  const items = context.snapshot.items ?? [];
  const item = items.find((candidate) => candidate.id === itemId);
  if (!item) refuse("TARGET_NOT_FOUND", `create_layer sourceItemId ${rawSource} is not a project item or composition in this fixture project. Items: ${items.map((candidate) => candidate.id).join(", ") || "none"}.`);
  if (item.type === "folder") refuse("TARGET_NOT_FOUND", `create_layer sourceItemId ${rawSource} is a folder; a footage layer needs footage or a composition.`);
  return item;
}

function sourceDurationOf(context: FixtureApplyContext, sourceId: string, fallbackDuration: number): number {
  const source = (context.snapshot.sources ?? []).find((candidate) => candidate.id === sourceId);
  return source && isFiniteNumber(source.duration) ? source.duration : fallbackDuration;
}

function footageFromItem(context: FixtureApplyContext, ids: { raw: string; resolved: string }, fallbackDuration: number): FootageSource {
  const item = projectItemForLayer(context, ids.raw, ids.resolved);
  const sourceId = item.sourceId ?? item.id;
  return {
    sourceId,
    compositionSourceId: item.type === "composition" ? item.compositionId ?? sourceId : null,
    outPoint: sourceDurationOf(context, sourceId, fallbackDuration),
  };
}

function buildFootageLayer(context: FixtureApplyContext, composition: CompositionSnapshot, operation: WireObject): FootageSource {
  const rawSource = operation.sourceItemId;
  if (typeof rawSource !== "string" || rawSource.length === 0) refuse("INVALID_VALUE", "create_layer layerType footage requires sourceItemId.");
  const resolved = realName(context, rawSource),
    sourceComposition = context.createdCompositions.get(rawSource) ?? context.snapshot.compositions.find((candidate) => candidate.id === resolved);
  return sourceComposition
    ? footageFromComposition(composition, sourceComposition)
    : footageFromItem(context, { raw: rawSource, resolved }, composition.duration);
}

function solidSizeOf(composition: CompositionSnapshot, operation: WireObject): [number, number] {
  const size = operation.size;
  return hasValue(size) ? tuple2(size, "create_layer size") : [composition.width, composition.height];
}

function recordSolidSource(context: FixtureApplyContext, name: string, size: [number, number]): string | null {
  if (!context.snapshot.sources) return null;
  const id = mintId(context, "solid");
  context.snapshot.sources.push({ id, name, type: "solid", filePath: null, missing: false, width: size[0], height: size[1] });
  return id;
}

function buildLayerData(context: FixtureApplyContext, request: CreateRequest): BuiltLayer {
  const { operation, composition, layerType, name } = request;
  const properties = [...transformProperties(composition), ...(TYPE_PROPERTIES[layerType]?.(operation) ?? [])];
  const base = { type: SNAPSHOT_TYPES[layerType], properties, compositionSourceId: null, outPoint: composition.duration };
  if (layerType === "adjustment" || layerType === "solid") return { ...base, sourceId: recordSolidSource(context, name, solidSizeOf(composition, operation)) };
  if (layerType === "footage") return { ...base, ...buildFootageLayer(context, composition, operation) };
  return { ...base, sourceId: null };
}

/** Creates a layer at the top of the composition under a `__new__:` placeholder and binds the id the fixture mints for it. */
export function applyCreateLayer(context: FixtureApplyContext, operation: WireObject): ApplyOutcome {
  const request = validateCreateLayer(context, operation), built = buildLayerData(context, request), id = mintId(context, "layer");
  const layer: LayerSnapshot = { id, index: 1, name: request.name, type: built.type, enabled: true, shy: false, solo: false, locked: false, startTime: 0, inPoint: 0, outPoint: built.outPoint, stretch: 100, parentId: null, matteLayerId: null, matteType: "none", isSelected: false, sourceId: built.sourceId, properties: built.properties, ...(built.compositionSourceId ? { compositionSourceId: built.compositionSourceId } : {}) };
  for (const existing of request.composition.layers) existing.index += 1;
  request.composition.layers.unshift(layer);
  context.createdLayers.set(request.placeholder, layer);
  context.bindings[request.placeholder] = id;
  return `created ${request.layerType} layer ${id} "${request.name}" at index 1`;
}
