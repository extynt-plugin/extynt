/**
 * A layer's place in its composition and the things attached to it: text documents, sibling order,
 * removal, track mattes and parenting.
 */

import { TEXT_DOCUMENT_FIELDS, textFieldError, type CompositionSnapshot, type LayerSnapshot, type PropertySnapshot } from "@extynt/project-graph";
import { type JsonValue } from "@extynt/decode";
import { isWireArray } from "@extynt/fake-plugin";
import { listedLayers, mintId, realName, resolveLayer, type ApplyOutcome, type FixtureApplyContext } from "./fake-host-context.js";
import { keyframeCount, propertyOf, requireProperty, requireSettable } from "./fake-host-model.js";
import { ANCHOR_PATH, POSITION_PATH, ROTATION_PATH, SCALE_PATH, TEXT_DOCUMENT_PATH, UNSUPPORTED_IN_FIXTURE } from "./fake-host-tables.js";
import { isFiniteNumber, isJsonObject, jsonOf, numericVector, pairOf, placeholderOf, refuse, type Field, type JsonObject } from "./fake-host-values.js";
import type { WireObject } from "./wire-types.js";

type TextFields = Array<[string, JsonValue]>;

type TrackMatteMode = "alpha" | "alpha-inverted" | "luma" | "luma-inverted";

interface ReorderRequest { composition: CompositionSnapshot; moved: LayerSnapshot; placement: string }

const REORDER_PLACEMENTS: ReadonlySet<string> = new Set(["beginning", "end", "before", "after"]);

const TRACK_MATTE_MODES: readonly TrackMatteMode[] = ["alpha", "alpha-inverted", "luma", "luma-inverted"];

const MAX_PARENT_HOPS = 64;

function reindex(composition: CompositionSnapshot): void { composition.layers.forEach((layer, position) => { layer.index = position + 1; }); }

function placementOf(operation: WireObject): string {
  const placement = operation.placement;
  if (typeof placement !== "string" || !REORDER_PLACEMENTS.has(placement)) {
    refuse("INVALID_VALUE", "reorder_layer placement must be beginning, end, before, or after.");
  }
  return placement;
}

function reorderReference(context: FixtureApplyContext, request: ReorderRequest, referenceId: Field): LayerSnapshot {
  const { composition, moved, placement } = request;
  if (typeof referenceId !== "string" || referenceId.length === 0) refuse("INVALID_TARGET", `reorder_layer placement "${placement}" requires referenceLayerId.`);
  if (realName(context, referenceId) === moved.id) refuse("INVALID_VALUE", "reorder_layer cannot place a layer before or after itself.");
  const reference = composition.layers.find((candidate) => candidate.id === realName(context, referenceId));
  if (!reference) refuse("TARGET_NOT_FOUND", `reorder_layer: no reference layer ${referenceId} in composition ${composition.id}. Layers: ${listedLayers(composition)}.`);
  return reference;
}

function destinationIndex(context: FixtureApplyContext, request: ReorderRequest, referenceId: Field): number {
  const { composition, moved, placement } = request;
  if (placement === "beginning") return 0;
  if (placement === "end") return composition.layers.length - 1;
  const at = composition.layers.indexOf(reorderReference(context, request, referenceId));
  const to = placement === "before" ? at : at + 1;
  const from = composition.layers.indexOf(moved);
  return from < to ? to - 1 : to;
}

/** Moves a layer to the beginning or end of the stack, or before or after a reference layer. */
export function applyReorderLayer(context: FixtureApplyContext, operation: WireObject): ApplyOutcome {
  const { composition, layer } = resolveLayer(context, operation, "reorder_layer");
  const placement = placementOf(operation);
  const to = destinationIndex(context, { composition, moved: layer, placement }, operation.referenceLayerId);
  composition.layers.splice(composition.layers.indexOf(layer), 1);
  composition.layers.splice(to, 0, layer);
  reindex(composition);
  return `moved layer ${layer.id} to ${placement}`;
}

/** As layer.duplicate() does in After Effects: a copy with the same name, properties and switches, directly above the original. */
export function applyDuplicateLayer(context: FixtureApplyContext, operation: WireObject): ApplyOutcome {
  const { composition, layer } = resolveLayer(context, operation, "duplicate_layer");
  const placeholder = placeholderOf(operation.newLayerId, "duplicate_layer declares newLayerId, which must be a __new__:<name> placeholder for the copy it creates.");
  if (context.bindings[placeholder]) refuse("INVALID_OPERATION", `duplicate_layer declares ${placeholder}, which an earlier operation in this call already created.`);
  const id = mintId(context, "layer");
  const copy: LayerSnapshot = { ...structuredClone(layer), id, isSelected: false };
  composition.layers.splice(composition.layers.indexOf(layer), 0, copy);
  reindex(composition);
  context.createdLayers.set(placeholder, copy);
  context.bindings[placeholder] = id;
  return `duplicated layer ${layer.id} as ${id} "${copy.name}" at index ${copy.index}`;
}

/** Removes a layer, which needs the destructive confirmation, and detaches whatever pointed at it. */
export function applyRemoveLayer(context: FixtureApplyContext, operation: WireObject): ApplyOutcome {
  if (operation.destructive !== true) refuse("DESTRUCTIVE_CONFIRMATION_REQUIRED", "remove_layer deletes a layer and requires destructive: true.");
  const { composition, layer } = resolveLayer(context, operation, "remove_layer");
  composition.layers.splice(composition.layers.indexOf(layer), 1);
  reindex(composition);
  for (const candidate of composition.layers) {
    if (candidate.parentId === layer.id) candidate.parentId = null;
    if (candidate.matteLayerId === layer.id) { candidate.matteLayerId = null; candidate.matteType = "none"; }
  }
  return `removed layer ${layer.id}`;
}

function matteModeOf(value: Field): TrackMatteMode {
  const mode = TRACK_MATTE_MODES.find((candidate) => candidate === value);
  if (!mode) refuse("INVALID_VALUE", "set_track_matte mode must be alpha, alpha-inverted, luma, or luma-inverted.");
  return mode;
}

function matteLayerOf(context: FixtureApplyContext, composition: CompositionSnapshot, matteRef: Field): LayerSnapshot {
  if (typeof matteRef !== "string") refuse("INVALID_VALUE", "set_track_matte matteLayerId must be a layer id or null.");
  const matte = composition.layers.find((candidate) => candidate.id === realName(context, matteRef));
  if (!matte) refuse("TARGET_NOT_FOUND", `set_track_matte: no matte layer ${matteRef} in composition ${composition.id}. Layers: ${listedLayers(composition)}.`);
  return matte;
}

/** Sets or clears a layer's track matte. */
export function applySetTrackMatte(context: FixtureApplyContext, operation: WireObject): ApplyOutcome {
  const { composition, layer } = resolveLayer(context, operation, "set_track_matte");
  const mode = matteModeOf(operation.mode);
  const matteRef = operation.matteLayerId;
  if (matteRef === null || matteRef === undefined) {
    layer.matteLayerId = null;
    layer.matteType = "none";
    return "cleared the track matte";
  }
  const matte = matteLayerOf(context, composition, matteRef);
  if (matte === layer) refuse("INVALID_VALUE", "A layer cannot be its own track matte.");
  layer.matteLayerId = matte.id;
  layer.matteType = mode;
  return `set ${mode} track matte ${matte.id} on layer ${layer.id}`;
}

function textDocumentFields(operation: WireObject): TextFields {
  const fields: TextFields = [];
  for (const [field, value] of Object.entries(operation)) {
    if (field === "type" || field === "target") continue;
    if (!(field in TEXT_DOCUMENT_FIELDS)) refuse("INVALID_VALUE", `set_text_document has no typed field "${field}"; the writable fields are ${Object.keys(TEXT_DOCUMENT_FIELDS).join(", ")}.`);
    const error = textFieldError(field, value);
    if (error) refuse("INVALID_VALUE", `set_text_document ${error}`);
    fields.push([field, jsonOf(value)]);
  }
  if (fields.length === 0) refuse("INVALID_VALUE", "set_text_document requires at least one typed text field.");
  return fields;
}

function baseTextOf(current: JsonValue): string {
  if (typeof current === "string") return current;
  return isJsonObject(current) && typeof current.text === "string" ? current.text : "";
}

function writePlainText(property: PropertySnapshot, writtenText: string, others: TextFields): boolean {
  if (others.length > 0 || typeof property.value === "object") return false;
  property.value = writtenText;
  property.valueType = "string";
  return true;
}

function writeTextDocument(property: PropertySnapshot, fields: TextFields): void {
  const current = property.value;
  const written = fields.find(([field]) => field === "text")?.[1];
  const writtenText = typeof written === "string" ? written : baseTextOf(current);
  const others = fields.filter(([field]) => field !== "text");
  if (writePlainText(property, writtenText, others)) return;
  const document: JsonObject = { text: writtenText };
  if (isJsonObject(current)) for (const [key, value] of Object.entries(current)) if (key !== "text") document[key] = value;
  for (const [field, value] of others) document[field] = value;
  property.value = document;
  property.valueType = "unknown";
}

/** Writes the typed text fields onto a text layer's source text. */
export function applySetTextDocument(context: FixtureApplyContext, operation: WireObject): ApplyOutcome {
  const { layer } = resolveLayer(context, operation, "set_text_document");
  const property = requireProperty(layer, TEXT_DOCUMENT_PATH, "set_text_document");
  requireSettable(property, "set_text_document");
  const ranges = operation.characterRanges;
  if (ranges !== undefined) {
    if (!isWireArray(ranges) || ranges.length === 0) refuse("INVALID_VALUE", "set_text_document characterRanges must be a non-empty array.");
    refuse(UNSUPPORTED_IN_FIXTURE, "set_text_document characterRanges is not modelled by the fixture harness: a ProjectSnapshot carries one document value per text property and no per-range styles, so the fixture will not report a range style it cannot hold.");
  }
  writeTextDocument(property, textDocumentFields(operation));
  return `wrote the text document on layer ${layer.id}`;
}

function transformNumbers(layer: LayerSnapshot, path: string): number[] | undefined {
  const value = propertyOf(layer, path)?.value;
  return Array.isArray(value) && value.every(isFiniteNumber) ? value : undefined;
}

function translationOffset(layer: LayerSnapshot): [number, number] {
  const position = transformNumbers(layer, POSITION_PATH);
  const anchor = transformNumbers(layer, ANCHOR_PATH);
  if (!position || !anchor || position.length !== anchor.length || position.length < 2) {
    refuse(UNSUPPORTED_IN_FIXTURE, `set_layer_parent: layer ${layer.id} "${layer.name}" has no plain two- or three-number Position/Anchor Point pair in this fixture, so its world transform cannot be computed.`);
  }
  const [positionX, positionY] = pairOf(position);
  const [anchorX, anchorY] = pairOf(anchor);
  return [positionX - anchorX, positionY - anchorY];
}

function assertPureTranslation(layer: LayerSnapshot, candidate: LayerSnapshot): void {
  const rotation = propertyOf(candidate, ROTATION_PATH)?.value;
  const scale = propertyOf(candidate, SCALE_PATH)?.value;
  if ((isFiniteNumber(rotation) && rotation !== 0) || (Array.isArray(scale) && scale.some((value) => value !== 100))) {
    refuse(UNSUPPORTED_IN_FIXTURE, `set_layer_parent: layer ${layer.id} "${layer.name}" is being positioned through ${candidate.id} "${candidate.name}", which carries a rotation or scale. After Effects compensates through the full world matrix and the fixture only models the measured pure-translation case, so it refuses rather than reporting a position it did not compute.`);
  }
}

function ancestorOf(composition: CompositionSnapshot, layer: LayerSnapshot, seen: ReadonlySet<string>): LayerSnapshot | undefined {
  const parent = layer.parentId ? composition.layers.find((candidate) => candidate.id === layer.parentId) : undefined;
  return parent && !seen.has(parent.id) ? parent : undefined;
}

function ownPosition(layer: LayerSnapshot): [number, number] {
  const position = transformNumbers(layer, POSITION_PATH);
  if (!position || position.length < 2) {
    refuse(UNSUPPORTED_IN_FIXTURE, `set_layer_parent: layer ${layer.id} "${layer.name}" has a keyed, expression-driven, or non-numeric Position in this fixture, and the fixture does not model how After Effects compensates an animated transform.`);
  }
  return pairOf(position);
}

function anchorWorldPosition(
  composition: CompositionSnapshot,
  layer: LayerSnapshot,
  subject: { layer: LayerSnapshot; includeSelf: boolean },
): [number, number] {
  let [x, y] = ownPosition(layer);
  if (subject.includeSelf) assertPureTranslation(subject.layer, layer);
  const seen = new Set<string>([layer.id]);
  let current = layer;
  for (let hop = 0; hop < MAX_PARENT_HOPS; hop += 1) {
    const parent = ancestorOf(composition, current, seen);
    if (!parent) break;
    seen.add(parent.id);
    assertPureTranslation(subject.layer, parent);
    const offset = translationOffset(parent);
    x += offset[0];
    y += offset[1];
    current = parent;
  }
  return [x, y];
}

function resolveParentLayer(context: FixtureApplyContext, composition: CompositionSnapshot, layer: LayerSnapshot, parentRef: Field): LayerSnapshot {
  if (typeof parentRef !== "string" || parentRef.length === 0) refuse("INVALID_VALUE", "set_layer_parent parentLayerId must be a layer id or null.");
  const parent = composition.layers.find((candidate) => candidate.id === realName(context, parentRef));
  if (!parent) refuse("TARGET_NOT_FOUND", `set_layer_parent: no parent layer ${parentRef} in composition ${composition.id}. Layers: ${listedLayers(composition)}.`);
  if (parent === layer) refuse("INVALID_VALUE", "A layer cannot parent itself.");
  assertNoParentCycle(composition, layer, parent);
  return parent;
}

function assertNoParentCycle(composition: CompositionSnapshot, layer: LayerSnapshot, parent: LayerSnapshot): void {
  for (let ancestor: LayerSnapshot | undefined = parent; ancestor; ancestor = composition.layers.find((candidate) => candidate.id === ancestor?.parentId)) {
    if (ancestor === layer) refuse("PARENT_CYCLE", `set_layer_parent would make layer ${layer.id} its own ancestor.`);
  }
}

function compensateParentPosition(composition: CompositionSnapshot, layer: LayerSnapshot, parent: LayerSnapshot): void {
  const positionProperty = requireProperty(layer, POSITION_PATH, "set_layer_parent");
  if (keyframeCount(positionProperty) > 0 || positionProperty.expressionEnabled === true) {
    refuse(UNSUPPORTED_IN_FIXTURE, `set_layer_parent: layer ${layer.id} has a keyed or expression-driven Position, and the fixture does not model how After Effects compensates an animated transform.`);
  }
  const world = anchorWorldPosition(composition, layer, { layer, includeSelf: false });
  const parentWorld = anchorWorldPosition(composition, parent, { layer, includeSelf: true });
  const parentAnchor = numericVector(propertyOf(parent, ANCHOR_PATH)?.value, "set_layer_parent parent Anchor Point", [2, 3]);
  const current = numericVector(positionProperty.value, "set_layer_parent Position", [2, 3]);
  const [anchorX, anchorY] = pairOf(parentAnchor);
  positionProperty.value = [world[0] - (parentWorld[0] - anchorX), world[1] - (parentWorld[1] - anchorY), ...current.slice(2)];
}

/** Parents a layer to another (keeping its world position through a pure-translation chain), or clears its parent. */
export function applySetLayerParent(context: FixtureApplyContext, operation: WireObject): ApplyOutcome {
  const { composition, layer } = resolveLayer(context, operation, "set_layer_parent");
  const parentRef = operation.parentLayerId;
  if (parentRef === null) { layer.parentId = null; return `cleared the parent of layer ${layer.id}`; }
  const parent = resolveParentLayer(context, composition, layer, parentRef);
  if (layer.parentId !== parent.id) compensateParentPosition(composition, layer, parent);
  layer.parentId = parent.id;
  return `parented layer ${layer.id} to ${parent.id}`;
}
