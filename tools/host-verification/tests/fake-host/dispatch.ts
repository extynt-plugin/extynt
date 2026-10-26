/**
 * The fake host's `apply_plan` dispatcher: one handler per operation the production
 * adapter implements, plus the failure and refusal replies the probe records.
 *
 * A handler returns null when the operation applied and a reply string when it must
 * stop the plan, which is how the adapter reports a refused plan.
 */
import { jsonObjectOf, jsonValue, numberOf, numberOr, rowsOf, textOf, type Json, type JsonObject } from "./narrow.js";
import { decodeJson, isJsonArray } from "@extynt/decode";
import { isHostArray, type HostValue } from "./gradient.js";
import { FakeProperty, walk } from "./property.js";
import { FakeComp, FakeFolder, FakeLayer, FakeProject } from "./layers.js";
import { LAYER_ROLES, type HostCall } from "./extendscript.js";

type UndoStep = () => void;

export interface HostState { project: FakeProject; calls: HostCall[]; undoStack: UndoStep[] }

interface PlanStep { readonly [field: string]: HostValue }

interface PlanContext {
  state: HostState;
  operation: JsonObject;
  type: string;
  steps: PlanStep[];
  createdShapeGroups: Map<string, FakeProperty>;
}
interface LayerContext extends PlanContext { comp: FakeComp; layer: FakeLayer }

type PlanHandler = (context: PlanContext) => string | null;
type LayerHandler = (context: LayerContext) => string | null;

export const failure = (code: string, detail?: string): string => JSON.stringify({ ok: false, error: { code, message: detail ?? code }, completedOperations: [], steps: [], mutationState: "not-applied" });
/** The production reply for a plan refused after the undo group opened; the adapter reports it cannot vouch for the host. */
export const refusal = (code: string, detail: string): string => JSON.stringify({ ok: false, error: { code, message: detail }, completedOperations: [], steps: [], mayHaveMutated: true, mutationState: "mutation-unknown" });
const success = (steps: PlanStep[]): string => JSON.stringify({ ok: true, operation: "apply_plan", appliedOperations: steps.map(() => "applied"), completedOperations: steps.map(() => "applied"), steps, partial: false, undoGroups: 1 });

const arg = (context: PlanContext, name: string): Json | undefined => context.operation[name];

const applied = (context: PlanContext, step: PlanStep): void => {
  context.steps.push({ operation: context.type, ...step });
  context.state.calls.push({ operation: context.type, ok: true });
};
const fail = (context: PlanContext, code: string, detail?: string): string => {
  context.state.calls.push({ operation: context.type, ok: false, code });
  return failure(code, detail);
};
const refuse = (context: PlanContext, code: string, detail: string): string => {
  context.state.calls.push({ operation: context.type, ok: false, code });
  return refusal(code, detail);
};

const findComp = (project: FakeProject, id: string): FakeComp | null => {
  for (const item of project.items.all) if (item instanceof FakeComp && String(item.id) === id) return item;
  return null;
};
const findLayer = (comp: FakeComp | null, id: string): FakeLayer | null => {
  if (!comp) return null;
  for (const layer of comp.layers.list) if (String(layer.id) === id) return layer;
  return null;
};
const maskAt = (layer: FakeLayer, ordinal: number): FakeProperty | null => {
  const parade = walk(layer.properties, "ADBE Mask Parade");
  if (!parade) return null;
  let seen = 0;
  for (const child of parade.children) if (child.matchName === "ADBE Mask Atom") { seen += 1; if (seen === ordinal) return child; }
  return null;
};
const contentsByOrdinal = (layer: FakeLayer, ordinal: number): FakeProperty | null => {
  const root = walk(layer.properties, "ADBE Root Vectors Group");
  let seen = 0;
  for (const child of root?.children ?? []) {
    if (child.matchName !== "ADBE Vector Group") continue;
    seen += 1;
    if (seen === ordinal) return walk(child, "ADBE Vectors Group");
  }
  return null;
};
const shapeContentsOf = (layer: FakeLayer, groupId: string, created: Map<string, FakeProperty>): FakeProperty | null => {
  if (groupId === "root") return walk(layer.properties, "ADBE Root Vectors Group");
  const direct = created.get(groupId);
  if (direct) return walk(direct, "ADBE Vectors Group");
  const match = /^shape:([1-9][0-9]{0,2})$/.exec(groupId);
  return match ? contentsByOrdinal(layer, Number(match[1])) : null;
};
const applySpecWrites = (container: FakeProperty, operation: JsonObject): void => {
  for (const write of rowsOf(operation.writes)) { const property = walk(container, textOf(write.path)); if (property) property.setValue(write.value); }
  for (const animation of rowsOf(operation.animations)) {
    const property = walk(container, textOf(animation.path));
    if (!property) continue;
    for (const frame of rowsOf(animation.keyframes)) property.writeKey(numberOr(frame.time, NaN), frame.value);
  }
};
const withinAncestry = (candidate: FakeLayer, layer: FakeLayer): boolean => {
  let ancestor: FakeLayer | null = candidate, hops = 0;
  while (ancestor && hops < 1000) {
    if (ancestor === layer) return true;
    ancestor = ancestor.parent;
    hops += 1;
  }
  return false;
};

interface FieldBinding<T> { read: (target: T) => Json; write: (target: T, value: Json) => void }

const numberField = <T>(read: (target: T) => number, write: (target: T, value: number) => void): FieldBinding<T> => ({
  read,
  write: (target, value) => {
    const numeric = numberOf(value);
    if (numeric !== null) write(target, numeric);
  },
});
const booleanField = <T>(read: (target: T) => boolean, write: (target: T, value: boolean) => void): FieldBinding<T> => ({
  read,
  write: (target, value) => {
    if (typeof value === "boolean") write(target, value);
  },
});
const stringField = <T>(read: (target: T) => string, write: (target: T, value: string) => void): FieldBinding<T> => ({
  read,
  write: (target, value) => {
    if (typeof value === "string") write(target, value);
  },
});
const colorField = <T>(read: (target: T) => number[], write: (target: T, value: number[]) => void): FieldBinding<T> => ({
  read,
  write: (target, value) => {
    if (isJsonArray(value))
      write(
        target,
        value.map((channel) => numberOr(channel, 0)),
      );
  },
});

const PROJECT_SETTINGS: Record<string, FieldBinding<FakeProject>> = {
  bitsPerChannel: numberField((project) => project.bitsPerChannel, (project, value) => { project.bitsPerChannel = value; }),
  linearBlending: booleanField((project) => project.linearBlending, (project, value) => { project.linearBlending = value; }),
  linearizeWorkingSpace: booleanField((project) => project.linearizeWorkingSpace, (project, value) => { project.linearizeWorkingSpace = value; }),
  workingSpace: stringField((project) => project.workingSpace, (project, value) => { project.workingSpace = value; }),
};
const COMP_SETTINGS: Record<string, FieldBinding<FakeComp>> = {
  width: numberField((comp) => comp.width, (comp, value) => { comp.width = value; }),
  height: numberField((comp) => comp.height, (comp, value) => { comp.height = value; }),
  pixelAspect: numberField((comp) => comp.pixelAspect, (comp, value) => { comp.pixelAspect = value; }),
  durationSeconds: numberField((comp) => comp.duration, (comp, value) => { comp.duration = value; }),
  frameRate: numberField((comp) => comp.frameRate, (comp, value) => { comp.frameRate = value; }),
  backgroundColor: colorField((comp) => comp.bgColor, (comp, value) => { comp.bgColor = value; }),
  workAreaStart: numberField((comp) => comp.workAreaStart, (comp, value) => { comp.workAreaStart = value; }),
  workAreaDuration: numberField((comp) => comp.workAreaDuration, (comp, value) => { comp.workAreaDuration = value; }),
  motionBlur: booleanField((comp) => comp.motionBlur, (comp, value) => { comp.motionBlur = value; }),
  shutterAngle: numberField((comp) => comp.shutterAngle, (comp, value) => { comp.shutterAngle = value; }),
  shutterPhase: numberField((comp) => comp.shutterPhase, (comp, value) => { comp.shutterPhase = value; }),
  motionBlurSamplesPerFrame: numberField((comp) => comp.motionBlurSamplesPerFrame, (comp, value) => { comp.motionBlurSamplesPerFrame = value; }),
  motionBlurAdaptiveSampleLimit: numberField((comp) => comp.motionBlurAdaptiveSampleLimit, (comp, value) => { comp.motionBlurAdaptiveSampleLimit = value; }),
  renderer: stringField((comp) => comp.renderer, (comp, value) => { if (comp.renderers.includes(value)) comp.renderer = value; }),
};

const applyBindings = <T>(state: HostState, target: T, settings: JsonObject, bindings: Record<string, FieldBinding<T>>): void => {
  const before = new Map<string, Json>();
  for (const [key, binding] of Object.entries(bindings)) {
    if (settings[key] === undefined) continue;
    before.set(key, binding.read(target));
    binding.write(target, settings[key]);
  }
  if (before.size) state.undoStack.push(() => { for (const [key, value] of before) bindings[key]?.write(target, value); });
};

const setProjectSettings = (context: PlanContext): string | null => {
  const settings = jsonObjectOf(arg(context, "settings"));
  applyBindings(context.state, context.state.project, settings, PROJECT_SETTINGS);
  applied(context, { status: "applied", observed: { ...settings } });
  return null;
};
const setCompositionSettings = (context: PlanContext): string | null => {
  const comp = findComp(context.state.project, textOf(arg(context, "compositionId")));
  if (!comp) return fail(context, "TARGET_NOT_FOUND");
  applyBindings(context.state, comp, jsonObjectOf(arg(context, "settings")), COMP_SETTINGS);
  applied(context, { status: "applied", compositionId: arg(context, "compositionId"), verification: "composition-settings-written" });
  return null;
};
const renderComposition = (context: PlanContext): string | null => {
  const comp = findComp(context.state.project, textOf(arg(context, "compositionId")));
  if (!comp) return fail(context, "TARGET_NOT_FOUND");
  const { project, undoStack } = context.state;
  project.renderQueue.items.add(comp);
  undoStack.push(() => { project.renderQueue.remove(project.renderQueue.numItems); });
  applied(context, { status: "queued", queueStatus: "QUEUED", verification: "render-queued" });
  return null;
};
const deleteProjectItem = (context: PlanContext): string | null => {
  const items: Array<FakeComp | FakeFolder> = context.state.project.items.all;
  const index = items.findIndex((entry) => String(entry.id) === textOf(arg(context, "itemId")));
  const item = index >= 0 ? items[index] : undefined;
  if (!item) return fail(context, "TARGET_NOT_FOUND");
  items.splice(index, 1);
  context.state.undoStack.push(() => { items.splice(index, 0, item); });
  applied(context, { status: "applied", itemId: arg(context, "itemId"), name: item.name });
  return null;
};

const applyPreset = (context: LayerContext): string | null => {
  const parade = walk(context.layer.properties, "ADBE Effect Parade");
  if (!parade) return fail(context, "EFFECT_NOT_AVAILABLE");
  const effect = parade.addProperty("ADBE Fake Preset Effect");
  context.state.undoStack.push(() => { const at = parade.children.indexOf(effect); if (at >= 0) parade.children.splice(at, 1); });
  applied(context, { status: "applied", changed: true, added: { effects: ["ADBE Fake Preset Effect"], keyedProperties: [], expressions: [] } });
  return null;
};
const addEssentialProperty = (context: LayerContext): string | null => {
  const property = walk(context.layer.properties, textOf(arg(context, "propertyPath")));
  if (!property) return fail(context, "PROPERTY_NOT_FOUND");
  context.comp.motionGraphicsTemplateControllerCount += 1;
  context.state.undoStack.push(() => { context.comp.motionGraphicsTemplateControllerCount -= 1; });
  applied(context, { status: "applied", propertyPath: arg(context, "propertyPath"), named: false, verification: "essential-property-added" });
  return null;
};
const writeMask = (context: LayerContext): string | null => {
  const match = /^mask:([1-9][0-9]{0,2})$/.exec(textOf(arg(context, "maskId")));
  const mask = match ? maskAt(context.layer, Number(match[1])) : null;
  if (!mask) return fail(context, "TARGET_NOT_FOUND");
  if (context.type === "remove_mask") mask.remove();
  else {
    const opacity = walk(mask, "ADBE Mask Opacity"), wanted = jsonObjectOf(arg(context, "values")).opacity;
    if (opacity && typeof wanted === "number") opacity.setValue(wanted);
  }
  applied(context, { status: "applied", layerId: String(context.layer.id), requestedMaskId: arg(context, "maskId") });
  return null;
};
const isAnimatorSpec = (operation: JsonObject): boolean => typeof operation.selectorMatchName === "string" && Array.isArray(operation.writes) && Array.isArray(operation.animations);
const writeAnimatorValue = (animator: FakeProperty, write: JsonObject): void => {
  const segments = textOf(write.path).split("/"), leafName = segments.pop() ?? "";
  let container = animator;
  for (const segment of segments) container = walk(container, segment) ?? container.addProperty(segment);
  container.addProperty(leafName).setValue(write.value);
};
const addTextAnimator = (context: LayerContext): string | null => {
  if (!isAnimatorSpec(context.operation)) return fail(context, "INVALID_VALUE", "add_text_animator requires selectorMatchName, writes, and animations");
  const animators = walk(context.layer.properties, "ADBE Text Properties/ADBE Text Animators");
  if (!animators) return fail(context, "TEXT_ANIMATOR_UNSUPPORTED");
  const animator = animators.addProperty("ADBE Text Animator");
  animator.addProperty("ADBE Text Selectors").addProperty(textOf(arg(context, "selectorMatchName")));
  for (const write of rowsOf(arg(context, "writes"))) writeAnimatorValue(animator, write);
  applied(context, { status: "applied" });
  return null;
};
const setExpression = (context: LayerContext): string | null => {
  const property = walk(context.layer.properties, textOf(arg(context, "propertyPath")));
  if (!property) return fail(context, "PROPERTY_NOT_FOUND");
  property.expression = textOf(arg(context, "source"));
  property.expressionEnabled = arg(context, "enabled") === true;
  applied(context, { status: "applied", enabled: property.expressionEnabled, keys: property.numKeys, expressionError: "" });
  return null;
};
const animateProperty = (context: LayerContext): string | null => {
  const property = walk(context.layer.properties, textOf(arg(context, "propertyPath")));
  if (!property) return fail(context, "PROPERTY_NOT_FOUND");
  for (const frame of rowsOf(arg(context, "keyframes"))) property.writeKey(numberOr(frame.time, NaN), frame.value);
  applied(context, { status: "applied", keys: property.numKeys });
  return null;
};
const setLayerProperty = (context: LayerContext): string | null => {
  const role = arg(context, "role");
  if (typeof role !== "string" || LAYER_ROLES[role] !== arg(context, "propertyPath")) return fail(context, "PROPERTY_NOT_SETTABLE");
  const property = walk(context.layer.properties, textOf(arg(context, "propertyPath")));
  if (!property) return fail(context, "PROPERTY_NOT_FOUND");
  if (property.numKeys > 0) return refuse(context, "CONFLICTING_KEYS", "CONFLICTING_KEYS: " + textOf(arg(context, "propertyPath")) + " has " + String(property.numKeys) + " keyframe(s); a static value would be refused.");
  property.setValue(arg(context, "value"));
  applied(context, { status: "applied", propertyPath: arg(context, "propertyPath") });
  return null;
};
const setLayerParent = (context: LayerContext): string | null => {
  const parentId = arg(context, "parentLayerId");
  if (parentId === null || parentId === undefined) context.layer.parent = null;
  else {
    const parent = findLayer(context.comp, textOf(parentId));
    if (!parent) return fail(context, "TARGET_NOT_FOUND");
    if (parent === context.layer) return fail(context, "INVALID_VALUE");
    if (withinAncestry(parent, context.layer)) return fail(context, "PARENT_CYCLE");
    context.layer.parent = parent;
  }
  applied(context, { status: "applied", layerId: String(context.layer.id), parentLayerId: parentId ?? null });
  return null;
};
const createShapeGroup = (context: LayerContext): string | null => {
  const root = walk(context.layer.properties, "ADBE Root Vectors Group");
  if (!root) return fail(context, "SHAPE_UNSUPPORTED");
  const group = root.addProperty("ADBE Vector Group");
  if (arg(context, "name") !== undefined) group.name = textOf(arg(context, "name"));
  context.createdShapeGroups.set(textOf(arg(context, "newGroupId")), group);
  applied(context, { status: "applied", layerId: String(context.layer.id), requestedGroupId: arg(context, "newGroupId"), name: group.name, verification: "shape-group-created" });
  return null;
};
const addShapeItem = (context: LayerContext): string | null => {
  const contents = shapeContentsOf(context.layer, textOf(arg(context, "groupId")), context.createdShapeGroups);
  if (!contents) return fail(context, "TARGET_NOT_FOUND");
  const item = contents.addProperty(textOf(arg(context, "itemMatchName")));
  if (arg(context, "name") !== undefined) item.name = textOf(arg(context, "name"));
  applySpecWrites(item, context.operation);
  applied(context, { status: "applied", layerId: String(context.layer.id), groupId: arg(context, "groupId"), requestedItemId: arg(context, "newItemId"), created: true, verification: "shape-item-written" });
  return null;
};
const ensureShapeFill = (context: LayerContext): string | null => {
  const contents = shapeContentsOf(context.layer, textOf(arg(context, "groupId")), context.createdShapeGroups);
  if (!contents) return fail(context, "TARGET_NOT_FOUND");
  let fill = contents.children.find((child) => child.matchName === "ADBE Vector Graphic - Fill") ?? null;
  if (!fill) fill = contents.addProperty("ADBE Vector Graphic - Fill");
  const color = walk(fill, "ADBE Vector Fill Color");
  if (color) color.setValue(arg(context, "color"));
  if (arg(context, "opacity") !== undefined) { const opacity = walk(fill, "ADBE Vector Fill Opacity"); if (opacity) opacity.setValue(arg(context, "opacity")); }
  applied(context, { status: "applied", layerId: String(context.layer.id), requestedGroupId: arg(context, "groupId"), verification: "shape-fill-written" });
  return null;
};
const ensureEffect = (context: LayerContext): string | null => {
  const parade = walk(context.layer.properties, "ADBE Effect Parade");
  if (!parade) return fail(context, "EFFECT_NOT_AVAILABLE");
  const wanted = textOf(arg(context, "effectMatchName"));
  const created = walk(parade, wanted) === null;
  if (created) parade.addProperty(wanted);
  applied(context, { status: "applied", layerId: String(context.layer.id), effectPath: arg(context, "effectPath"), created, enabled: arg(context, "enabled") });
  return null;
};
const withAlphaFor = (value: Json | undefined, current: HostValue): Json | undefined =>
  isJsonArray(value) && value.length === 3 && isHostArray(current) && current.length === 4 ? [...value, 1] : value;
const setEffectControl = (context: LayerContext): string | null => {
  const property = walk(context.layer.properties, textOf(arg(context, "propertyPath")));
  if (!property) return fail(context, "PROPERTY_NOT_FOUND");
  if (property.numKeys > 0) return refuse(context, "CONFLICTING_KEYS", "CONFLICTING_KEYS: " + textOf(arg(context, "propertyPath")) + " has " + String(property.numKeys) + " keyframe(s); use animate_control.");
  property.setValue(withAlphaFor(arg(context, "value"), property.value));
  const current = property.value;
  applied(context, { status: "applied", layerId: String(context.layer.id), propertyPath: arg(context, "propertyPath"), value: Array.isArray(current) ? current.slice(0) : current });
  return null;
};

const PROJECT_HANDLERS: Record<string, PlanHandler> = {
  set_project_settings: setProjectSettings,
  set_composition_settings: setCompositionSettings,
  render_composition: renderComposition,
  delete_project_item: deleteProjectItem,
};

const LAYER_HANDLERS: Record<string, LayerHandler> = {
  apply_preset: applyPreset,
  add_essential_property: addEssentialProperty,
  remove_mask: writeMask,
  update_mask: writeMask,
  add_text_animator: addTextAnimator,
  set_expression: setExpression,
  animate_property: animateProperty,
  set_layer_property: setLayerProperty,
  set_layer_parent: setLayerParent,
  create_shape_group: createShapeGroup,
  add_shape_item: addShapeItem,
  ensure_shape_fill: ensureShapeFill,
  ensure_effect: ensureEffect,
  set_effect_control: setEffectControl,
};

const parseOperations = (raw: string): JsonObject[] | null => {
  const parsed = decodeJson(raw, jsonValue);
  if (!parsed.ok) return null;
  const operations = jsonObjectOf(parsed.value).operations;
  return Array.isArray(operations) ? operations.map(jsonObjectOf) : null;
};

const runLayerOperation = (context: PlanContext): string | null => {
  const comp = findComp(context.state.project, textOf(arg(context, "compositionId")));
  const layer = findLayer(comp, textOf(arg(context, "layerId")));
  if (!comp || !layer) return fail(context, "TARGET_NOT_FOUND");
  const handler = LAYER_HANDLERS[context.type];
  return handler ? handler({ ...context, comp, layer }) : fail(context, "UNSUPPORTED_OPERATION");
};

const runOperation = (base: PlanContext, operation: JsonObject): string | null => {
  const context: PlanContext = { ...base, operation, type: textOf(operation.operation) };
  const projectHandler = PROJECT_HANDLERS[context.type];
  return projectHandler ? projectHandler(context) : runLayerOperation(context);
};

/** Builds the applier the fake host hands to the probe as `context.applyPlan`. */
export function createPlanApplier(state: HostState): (raw: string) => string {
  return (raw: string): string => {
    const operations = parseOperations(raw);
    if (!operations) return failure("INVALID_COMMAND");
    const base: PlanContext = { state, operation: {}, type: "", steps: [], createdShapeGroups: new Map() };
    for (const operation of operations) {
      const reply = runOperation(base, operation);
      if (reply) return reply;
    }
    return success(base.steps);
  };
}
