/** Shape operations: groups, the items inside them with their settings and keyframes, the shape path, and the fill and stroke of a group. */

import type { LayerSnapshot, PropertySnapshot } from "@extynt/project-graph";
import { ordinalOf, resolveLayer, resolveOrdinal, type ApplyOutcome, type FixtureApplyContext } from "./fake-host-context.js";
import { writeKeyframes, parseFrames } from "./fake-host-keyframes.js";
import { childSegment, childrenOf, ensureChildGroup, ensureChildProperty, findChild, group, keyframeCount, layerRoot, materializeSetting } from "./fake-host-model.js";
import { requireShapePath, shapePathMessage } from "./fake-host-shape-path.js";
import { SHAPE_ITEMS, SHAPE_ROOT, V, VECTOR_CONTENTS, VECTOR_GROUP, type ShapeItemSpec, type SpecKind } from "./fake-host-tables.js";
import { boundedNumber, jsonOf, optionalBounded, optionalObject, own, placeholderOf, refuse, specValueError, textOf, tuple3, type Field } from "./fake-host-values.js";
import type { WireObject, WireValue } from "./wire-types.js";

interface StaticSetting { key: string; path: string; kind: SpecKind; value: WireValue }

interface AnimatedSetting { key: string; path: string; kind: SpecKind; frames: WireValue }

interface PlannedShapeWrites { values: StaticSetting[]; animations: AnimatedSetting[] }

interface ShapeItemRequest { contents: PropertySnapshot; spec: ShapeItemSpec; layer: LayerSnapshot; operation: WireObject }

interface ShapeSettingInput { item: PropertySnapshot; spec: ShapeItemSpec; operation: WireObject; label: string }

/** The vectors root of a shape layer, or an INVALID_TARGET refusal for any other layer. */
export function shapeRootOf(layer: LayerSnapshot): PropertySnapshot {
  const root = findChild(layerRoot(layer), SHAPE_ROOT);
  if (!root) refuse("INVALID_TARGET", `Shape operations apply only to a shape layer; ${layer.id} "${layer.name}" has no ${SHAPE_ROOT} group in this fixture.`);
  return root;
}

function resolveShapeGroup(context: FixtureApplyContext, layer: LayerSnapshot, rawGroupId: Field, label: string): PropertySnapshot {
  if (typeof rawGroupId !== "string" || rawGroupId.length === 0) refuse("INVALID_TARGET", `${label} requires a groupId.`);
  const bound = context.createdShapeGroups.get(rawGroupId);
  if (bound) return bound;
  const root = shapeRootOf(layer);
  if (rawGroupId === "root") return root;
  const match = /^shape:([1-9][0-9]{0,2})$/.exec(rawGroupId);
  if (!match) refuse("TARGET_NOT_FOUND", `${label}: groupId must be root, shape:<n>, or a create_shape_group placeholder created earlier in this call.`);
  const found = resolveOrdinal(root, VECTOR_GROUP, Number(match[1]));
  if (!found) refuse("TARGET_NOT_FOUND", `${label}: no shape group at ordinal ${match[1]} on layer ${layer.id}.`);
  return found;
}

function contentsOf(shapeGroup: PropertySnapshot): PropertySnapshot {
  return shapeGroup.matchName === SHAPE_ROOT ? shapeGroup : ensureChildGroup(shapeGroup, VECTOR_CONTENTS, "Contents");
}

/** Creates a shape group under a `__new__:` placeholder. */
export function applyCreateShapeGroup(context: FixtureApplyContext, operation: WireObject): ApplyOutcome {
  const { layer } = resolveLayer(context, operation, "create_shape_group");
  const root = shapeRootOf(layer);
  const placeholder = placeholderOf(operation.newGroupId, "create_shape_group declares newGroupId, which must be a __new__:<name> placeholder for the group it creates.");
  const name = textOf(operation.name, "create_shape_group name", { min: 1, max: 256 });
  const segment = childSegment(root, VECTOR_GROUP);
  const created = group(`${root.path}/${segment}`, VECTOR_GROUP, name, [group(`${root.path}/${segment}/${VECTOR_CONTENTS}`, VECTOR_CONTENTS, "Contents")]);
  childrenOf(root).push(created);
  const ordinal = ordinalOf(root, VECTOR_GROUP, created);
  context.createdShapeGroups.set(placeholder, created);
  context.bindings[placeholder] = `shape:${ordinal}`;
  context.evidence = { readback: { matchName: created.matchName, name: created.displayName, ordinal } };
  return `created shape group shape:${ordinal} "${name}" on layer ${layer.id}`;
}

function shapeItemSpec(item: Field): ShapeItemSpec {
  const spec = typeof item === "string" ? own(SHAPE_ITEMS, item) : undefined;
  if (!spec) refuse("INVALID_VALUE", `Shape item ${typeof item === "string" ? `"${item}"` : "(none given)"} is not one of ${Object.keys(SHAPE_ITEMS).join(", ")}.`);
  return spec;
}

function createShapeItem(parent: PropertySnapshot, spec: ShapeItemSpec, name: string | undefined): PropertySnapshot {
  const created = group(`${parent.path}/${childSegment(parent, spec.matchName)}`, spec.matchName, name ?? spec.matchName);
  childrenOf(parent).push(created);
  for (const [path, kind] of Object.values(spec.settings)) materializeSetting(created, path, kind);
  return created;
}

function planStaticShapeSettings(spec: ShapeItemSpec, values: WireObject, label: string): StaticSetting[] {
  const planned: StaticSetting[] = [];
  for (const [key, value] of Object.entries(values)) {
    const setting = own(spec.settings, key);
    if (!setting) refuse("INVALID_VALUE", `${label} has no setting "${key}"; use one of ${Object.keys(spec.settings).join(", ")}.`);
    const [path, kind] = setting;
    const error = specValueError(kind, value);
    if (error) refuse("INVALID_VALUE", `${label}.${key} ${error}.`);
    planned.push({ key, path, kind, value });
  }
  return planned;
}

function planAnimatedShapeSettings(spec: ShapeItemSpec, keyframes: WireObject, values: WireObject | undefined, label: string): AnimatedSetting[] {
  const planned: AnimatedSetting[] = [];
  for (const [key, frames] of Object.entries(keyframes)) {
    const setting = own(spec.settings, key);
    if (!setting) refuse("INVALID_VALUE", `${label} has no animatable setting "${key}"; use one of ${Object.keys(spec.settings).join(", ")}.`);
    const [path, kind] = setting;
    if (kind === "boolean" || kind === "menu") refuse("INVALID_VALUE", `${label}.${key} is a ${kind} and is set statically, not keyframed.`);
    if (values !== undefined && key in values) refuse("INVALID_VALUE", `${label}.${key} cannot be both set and keyframed in one operation.`);
    parseFrames(frames, `${label}.${key}`);
    planned.push({ key, path, kind, frames });
  }
  return planned;
}

function planShapeSettings(spec: ShapeItemSpec, operation: WireObject, label: string): PlannedShapeWrites {
  const values = optionalObject(operation.values, `${label}: values must be an object of setting names.`);
  const keyframes = optionalObject(operation.keyframes, `${label}: keyframes must map setting names to keyframe arrays.`);
  return { values: planStaticShapeSettings(spec, values ?? {}, label), animations: planAnimatedShapeSettings(spec, keyframes ?? {}, values, label) };
}

function writeShapeSettings({ item, spec, operation, label }: ShapeSettingInput): WireObject {
  const planned = planShapeSettings(spec, operation, label);
  const keyframeMode = operation.keyframeMode;
  const writes = planned.values.map((write) => {
    const property = materializeSetting(item, write.path, write.kind);
    property.value = jsonOf(write.value);
    return { path: property.path, value: property.value };
  });
  const animations = planned.animations.map((animation) => {
    const property = materializeSetting(item, animation.path, animation.kind);
    writeKeyframes(property, animation.frames, keyframeMode, `${label}.${animation.key}`);
    return { path: property.path, keyframes: animation.frames, keyframeMode: typeof keyframeMode === "string" ? keyframeMode : "reject", afterKeys: keyframeCount(property) };
  });
  return { writes, animations };
}

function addShapeItem(context: FixtureApplyContext, request: ShapeItemRequest): PropertySnapshot {
  const { contents, spec, operation } = request;
  const placeholder = placeholderOf(operation.newItemId, "add_shape_item declares newItemId, which must be a __new__:<name> placeholder for the item it creates.");
  const name = operation.name;
  if (name !== undefined && name !== null) textOf(name, "add_shape_item name", { min: 1, max: 256 });
  const item = createShapeItem(contents, spec, typeof name === "string" ? name : undefined);
  context.createdShapeItems.set(placeholder, item);
  context.bindings[placeholder] = `item:${ordinalOf(contents, spec.matchName, item)}`;
  return item;
}

function updatedShapeItem(context: FixtureApplyContext, request: ShapeItemRequest): PropertySnapshot {
  const { contents, spec, operation, layer } = request;
  const itemId = operation.itemId;
  if (typeof itemId !== "string" || itemId.length === 0) refuse("INVALID_TARGET", "update_shape_item requires itemId.");
  const bound = context.createdShapeItems.get(itemId);
  if (bound) return bound;
  const match = /^item:([1-9][0-9]{0,2})$/.exec(itemId);
  if (!match) refuse("TARGET_NOT_FOUND", "update_shape_item itemId must be item:<n> (the nth item of that kind in the group) or a newItemId added earlier in this call.");
  const found = resolveOrdinal(contents, spec.matchName, Number(match[1]));
  if (!found) refuse("TARGET_NOT_FOUND", `update_shape_item: no ${operation.item} item at ${itemId} in group ${String(operation.groupId)} on layer ${layer.id}.`);
  return found;
}

function shapeItemRequest(context: FixtureApplyContext, operation: WireObject, type: string): ShapeItemRequest {
  const { layer } = resolveLayer(context, operation, type);
  shapeRootOf(layer);
  const spec = shapeItemSpec(operation.item ?? operation.itemMatchName);
  return { contents: contentsOf(resolveShapeGroup(context, layer, operation.groupId, type)), spec, layer, operation };
}

/** Adds a shape item to a group under a `__new__:` placeholder, writing its settings and keyframes. */
export function applyAddShapeItem(context: FixtureApplyContext, operation: WireObject): ApplyOutcome {
  const request = shapeItemRequest(context, operation, "add_shape_item");
  const label = String(operation.item);
  planShapeSettings(request.spec, operation, label);
  const item = addShapeItem(context, request);
  context.evidence = { containerPath: item.path, created: true, ...writeShapeSettings({ item, spec: request.spec, operation, label }) };
  return `added ${operation.item} item as ${context.bindings[String(operation.newItemId)]} on layer ${request.layer.id}`;
}

/** Writes settings and keyframes onto a shape item the plan or an earlier step named. */
export function applyUpdateShapeItem(context: FixtureApplyContext, operation: WireObject): ApplyOutcome {
  const request = shapeItemRequest(context, operation, "update_shape_item");
  if (operation.values === undefined && operation.keyframes === undefined) refuse("INVALID_OPERATION", "update_shape_item requires values or keyframes.");
  const label = String(operation.item);
  planShapeSettings(request.spec, operation, label);
  const item = updatedShapeItem(context, request);
  context.evidence = { containerPath: item.path, created: false, ...writeShapeSettings({ item, spec: request.spec, operation, label }) };
  return `updated ${operation.item} item ${String(operation.itemId)} on layer ${request.layer.id}`;
}

/** Writes the path of a shape group. */
export function applySetShapePath(context: FixtureApplyContext, operation: WireObject): ApplyOutcome {
  const { layer } = resolveLayer(context, operation, "set_shape_path");
  const shapeGroup = resolveShapeGroup(context, layer, operation.groupId, "set_shape_path");
  const written = requireShapePath(operation.path, shapePathMessage("set_shape_path path"));
  const pathGroup = ensureChildGroup(contentsOf(shapeGroup), "ADBE Vector Shape - Group", "Path 1");
  const pathProperty = ensureChildProperty(pathGroup, { matchName: "ADBE Vector Shape", displayName: "Path", valueType: "unknown" });
  pathProperty.value = written;
  context.evidence = { readback: { matchName: pathProperty.matchName, ...written } };
  return `wrote the shape path on group ${String(operation.groupId)}`;
}

function ensureShapeGraphic(parent: PropertySnapshot, matchName: string, displayName: string): PropertySnapshot {
  const contents = contentsOf(parent);
  const existing = findChild(contents, matchName);
  if (existing) return existing;
  const created = group(`${contents.path}/${childSegment(contents, matchName)}`, matchName, displayName);
  childrenOf(contents).push(created);
  return created;
}

/** Ensures the group has a fill and writes its colour and, when given, its opacity. */
export function applyEnsureShapeFill(context: FixtureApplyContext, operation: WireObject): ApplyOutcome {
  const { layer } = resolveLayer(context, operation, "ensure_shape_fill");
  const shapeGroup = resolveShapeGroup(context, layer, operation.groupId, "ensure_shape_fill");
  const color = tuple3(operation.color, "ensure_shape_fill color");
  const opacity = optionalBounded(operation.opacity, "ensure_shape_fill opacity", { min: 0, max: 100 });
  const fill = ensureShapeGraphic(shapeGroup, `${V} Graphic - Fill`, "Fill 1");
  const colorProperty = ensureChildProperty(fill, { matchName: `${V} Fill Color`, displayName: "Color", valueType: "color" });
  const opacityProperty = ensureChildProperty(fill, { matchName: `${V} Fill Opacity`, displayName: "Opacity", valueType: "number" });
  colorProperty.value = color;
  if (opacity !== undefined) opacityProperty.value = opacity;
  context.evidence = { readback: { matchName: fill.matchName, color: colorProperty.value, opacity: opacityProperty.value } };
  return;
}

/** Ensures the group has a stroke and writes its colour, width and, when given, its opacity. */
export function applyEnsureShapeStroke(context: FixtureApplyContext, operation: WireObject): ApplyOutcome {
  const { layer } = resolveLayer(context, operation, "ensure_shape_stroke");
  const shapeGroup = resolveShapeGroup(context, layer, operation.groupId, "ensure_shape_stroke");
  const color = tuple3(operation.color, "ensure_shape_stroke color");
  const width = boundedNumber(operation.width, "ensure_shape_stroke width", { min: 0, max: 10000 });
  const opacity = optionalBounded(operation.opacity, "ensure_shape_stroke opacity", { min: 0, max: 100 });
  const stroke = ensureShapeGraphic(shapeGroup, `${V} Graphic - Stroke`, "Stroke 1");
  const colorProperty = ensureChildProperty(stroke, { matchName: `${V} Stroke Color`, displayName: "Color", valueType: "color" });
  const widthProperty = ensureChildProperty(stroke, { matchName: `${V} Stroke Width`, displayName: "Stroke Width", valueType: "number" });
  const opacityProperty = ensureChildProperty(stroke, { matchName: `${V} Stroke Opacity`, displayName: "Opacity", valueType: "number" });
  colorProperty.value = color;
  widthProperty.value = width;
  if (opacity !== undefined) opacityProperty.value = opacity;
  context.evidence = { readback: { matchName: stroke.matchName, color: colorProperty.value, width: widthProperty.value, opacity: opacityProperty.value } };
  return;
}
