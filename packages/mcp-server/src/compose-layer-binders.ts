// The placeholders an operation on one layer can declare or refer to: a copy of a layer, a mask, shape group,
// text animator or shape item added earlier, a layer or source item created earlier in the plan.
import { objectAt, stringAt } from "./json.js";
import { isPlaceholderId, placeholderAt } from "./compose-pass.js";
import type { ComposePass, LayerPlaceholder, PlaceholderMaps, Refusal } from "./compose-pass.js";
import { declaredComposition, layerReference } from "./compose-references.js";
import type { OperationFields } from "./operation-fields.js";

type LayerBinder = (pass: ComposePass, candidate: OperationFields, target: LayerPlaceholder, index: number) => Refusal | undefined;

type ScopedTable = "masks" | "shapes" | "animators" | "shapeItems";

interface ScopedAddition {
  table: ScopedTable;
  field: string;
  prefix: string;
}

interface ScopedReference {
  types: readonly string[];
  table: ScopedTable;
  field: string;
  message: string;
}

const SCOPED_ADDITIONS: ReadonlyMap<string, ScopedAddition> = new Map<string, ScopedAddition>([
  ["add_mask", { table: "masks", field: "newMaskId", prefix: "mask" }],
  ["create_shape_group", { table: "shapes", field: "newGroupId", prefix: "shape" }],
  ["add_text_animator", { table: "animators", field: "newAnimatorId", prefix: "animator" }],
  ["add_shape_item", { table: "shapeItems", field: "newItemId", prefix: "shapeitem" }],
]);

const SCOPED_REFERENCES: readonly ScopedReference[] = [
  { types: ["update_mask", "remove_mask"], table: "masks", field: "maskId", message: "Mask placeholders must be created earlier on the same layer." },
  { types: ["update_text_animator"], table: "animators", field: "animatorId", message: "Animator placeholders must be added earlier on the same layer." },
  { types: ["update_shape_item"], table: "shapeItems", field: "itemId", message: "Shape item placeholders must be added earlier on the same layer." },
  {
    types: ["set_shape_path", "ensure_shape_fill", "ensure_shape_stroke", "add_shape_item", "update_shape_item"],
    table: "shapes", field: "groupId", message: "Shape group placeholders must be created earlier on the same layer.",
  },
];

const SAME_COMPOSITION_LAYER_REFERENCES: Readonly<Record<string, { field: string; message: string }>> = {
  set_layer_parent: { field: "parentLayerId", message: "Parent layer placeholders must be created earlier in the same composition." },
  reorder_layer: { field: "referenceLayerId", message: "Reference layer placeholders must be created earlier in the same composition." },
  set_track_matte: { field: "matteLayerId", message: "Matte layer placeholders must be created earlier in the same composition." },
};

function invalid(message: string): Refusal {
  return { code: "INVALID_ARGUMENT", message };
}

function bindDuplicateLayer(pass: ComposePass, candidate: OperationFields, target: LayerPlaceholder, index: number): Refusal | undefined {
  const type = stringAt(candidate, "type");
  if (type !== "duplicate_layer" && type !== "derive_layer") return undefined;
  const callerId = stringAt(candidate, "newLayerId") ?? "";
  const newLayerId = `__new__:layer${index}`;
  if (!callerId || (pass.maps.layers.has(callerId) && callerId !== newLayerId)) return invalid(`${type} requires a unique new layer placeholder.`);
  candidate.newLayerId = newLayerId;
  pass.maps.layers.set(callerId, { compositionId: target.compositionId, layerId: newLayerId });
  pass.maps.layers.set(newLayerId, { compositionId: target.compositionId, layerId: newLayerId });
  return undefined;
}

function bindKeyframeSource(pass: ComposePass, candidate: OperationFields, _target: LayerPlaceholder, index: number): Refusal | undefined {
  const type = stringAt(candidate, "type");
  const source = type === "edit_keyframes" || type === "copy_effects" ? objectAt(candidate, "source") : undefined;
  if (!source) return undefined;
  const named = stringAt(source, "compositionId");
  if (!named) return invalid("edit_keyframes source requires compositionId.");
  const composition = declaredComposition(pass, named, index);
  if (!composition.ok) return composition.refusal;
  const layer = layerReference(pass, stringAt(source, "layerId") ?? "", composition.value);
  if (!layer.ok) return layer.refusal;
  candidate.source = { ...source, compositionId: composition.value, layerId: layer.value };
  return undefined;
}

function bindSameCompositionLayer(pass: ComposePass, candidate: OperationFields, target: LayerPlaceholder): Refusal | undefined {
  const reference = SAME_COMPOSITION_LAYER_REFERENCES[stringAt(candidate, "type") ?? ""];
  if (!reference) return undefined;
  const named = stringAt(candidate, reference.field);
  if (named === undefined || !isPlaceholderId(pass.maps.layers, named)) return undefined;
  const mapped = pass.maps.layers.get(named);
  if (!mapped || (mapped.compositionId && mapped.compositionId !== target.compositionId)) return invalid(reference.message);
  candidate[reference.field] = mapped.layerId;
  return undefined;
}

function bindScopedAddition(pass: ComposePass, candidate: OperationFields, target: LayerPlaceholder, index: number): Refusal | undefined {
  const type = stringAt(candidate, "type") ?? "";
  const addition = SCOPED_ADDITIONS.get(type);
  if (!addition) return undefined;
  const table: PlaceholderMaps[ScopedTable] = pass.maps[addition.table];
  const callerId = stringAt(candidate, addition.field) ?? "";
  const id = `__new__:${addition.prefix}${index}`;
  if (!callerId || table.has(callerId)) return invalid(`${type} requires ${addition.field} as a unique "__new__:<name>" placeholder; fix it with ae_amend_plan.`);
  candidate[addition.field] = id;
  table.set(callerId, { compositionId: target.compositionId, layerId: target.layerId, id });
  table.set(id, { compositionId: target.compositionId, layerId: target.layerId, id });
  return undefined;
}

function bindScopedReference(pass: ComposePass, candidate: OperationFields, target: LayerPlaceholder, reference: ScopedReference): Refusal | undefined {
  if (!reference.types.includes(stringAt(candidate, "type") ?? "")) return undefined;
  const callerId = placeholderAt(candidate, reference.field);
  if (callerId === undefined) return undefined;
  const held = pass.maps[reference.table].get(callerId);
  if (!held || held.compositionId !== target.compositionId || held.layerId !== target.layerId) return invalid(reference.message);
  candidate[reference.field] = held.id;
  return undefined;
}

function bindScopedReferences(pass: ComposePass, candidate: OperationFields, target: LayerPlaceholder): Refusal | undefined {
  for (const reference of SCOPED_REFERENCES) {
    const problem = bindScopedReference(pass, candidate, target, reference);
    if (problem) return problem;
  }
  return undefined;
}

function bindSourceItemReference(pass: ComposePass, candidate: OperationFields): Refusal | undefined {
  const type = stringAt(candidate, "type");
  if (type !== "create_layer" && type !== "replace_layer_source") return undefined;
  const callerId = placeholderAt(candidate, "sourceItemId");
  if (callerId === undefined) return undefined;
  const source = pass.maps.compositions.get(callerId) ?? pass.maps.items.get(callerId);
  if (!source) return invalid(`sourceItemId ${callerId} matches no item declared earlier in this plan. Give the import_file (or create_composition) operation newItemId (newCompositionId) set to exactly that "__new__:name" string, in the same call or an earlier one, then use the same string as sourceItemId; or finish the import first and use the item id its receipt returns.`);
  candidate.sourceItemId = source;
  return undefined;
}

const LAYER_SCOPED_BINDERS: readonly LayerBinder[] = [
  bindDuplicateLayer, bindSameCompositionLayer, bindKeyframeSource, bindScopedAddition, bindScopedReferences, bindSourceItemReference,
];

/** Binds every placeholder an operation on one layer declares or refers to; the first one that cannot be bound is the refusal. */
export function bindLayerScopedPlaceholders(pass: ComposePass, candidate: OperationFields, target: LayerPlaceholder, index: number): Refusal | undefined {
  for (const bind of LAYER_SCOPED_BINDERS) {
    const problem = bind(pass, candidate, target, index);
    if (problem) return problem;
  }
  return undefined;
}
