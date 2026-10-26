// The handlers for operations that act on the project rather than on one layer: compositions, project items,
// project settings and the composition-scoped actions. Each binds its placeholders and stores the operation.
import { arrayAt, objectAt, stringAt } from "./json.js";
import type { JsonValue } from "@extynt/decode";
import { isPlaceholderId, mappedPlaceholder, placeholderAt, refusal, refused, stampFingerprints, stampedTarget, storeOperation } from "./compose-pass.js";
import type { ComposePass, FamilyOutcome, Resolved } from "./compose-pass.js";
import { mappedComposition, namedOrImpliedComposition, targetCompositionName } from "./compose-references.js";
import type { OperationFields } from "./operation-fields.js";

type FamilyHandler = (pass: ComposePass, candidate: OperationFields, index: number) => FamilyOutcome;

function invalid(message: string): FamilyOutcome {
  return refused({ code: "INVALID_ARGUMENT", message });
}

function bindCreateComposition(pass: ComposePass, candidate: OperationFields, index: number): FamilyOutcome {
  const callerId = stringAt(candidate, "newCompositionId");
  const newId = `__new__:comp${index}`;
  if (callerId && callerId !== newId) {
    if (pass.maps.compositions.has(callerId) && !pass.forwardPlaceholders) return invalid("Duplicate new composition placeholder.");
    pass.maps.compositions.set(callerId, newId);
  }
  pass.maps.compositions.set(newId, newId);
  candidate.newCompositionId = newId;
  stampFingerprints(pass, candidate);
  return storeOperation(pass, candidate);
}

function bindItemParent(pass: ComposePass, candidate: OperationFields, parentKey: string): FamilyOutcome | undefined {
  const parent = placeholderAt(candidate, parentKey);
  if (parent === undefined) return undefined;
  const mapped = pass.maps.items.get(parent);
  if (!mapped) return invalid("Project-item placeholders must be created earlier.");
  candidate[parentKey] = mapped;
  return undefined;
}

function declareProjectItem(pass: ComposePass, candidate: OperationFields, index: number): FamilyOutcome | undefined {
  const isFolder = candidate.type === "create_folder";
  const field = isFolder ? "newFolderId" : "newItemId";
  const callerId = stringAt(candidate, field) ?? "";
  const canonicalId = `__new__:${isFolder ? "folder" : "item"}${index}`;
  if (callerId && pass.maps.items.has(callerId) && !pass.forwardPlaceholders) return invalid("Duplicate project-item placeholder.");
  pass.maps.items.set(callerId || canonicalId, canonicalId);
  pass.maps.items.set(canonicalId, canonicalId);
  candidate[field] = canonicalId;
  return undefined;
}

function bindProjectItem(pass: ComposePass, candidate: OperationFields, index: number): FamilyOutcome {
  const duplicate = declareProjectItem(pass, candidate, index);
  if (duplicate) return duplicate;
  stampFingerprints(pass, candidate);
  return bindItemParent(pass, candidate, candidate.type === "create_folder" ? "parentFolderId" : "destinationFolderId") ?? storeOperation(pass, candidate);
}

function bindMoveDestination(pass: ComposePass, candidate: OperationFields): FamilyOutcome | undefined {
  const destination = candidate.type === "move_item_to_folder" ? placeholderAt(candidate, "folderId") : undefined;
  if (destination === undefined) return undefined;
  const mapped = pass.maps.items.get(destination);
  if (!mapped) return invalid("Destination folder placeholder must be created earlier.");
  candidate.folderId = mapped;
  return undefined;
}

function bindItemTarget(pass: ComposePass, candidate: OperationFields): FamilyOutcome {
  const named = stringAt(objectAt(candidate, "target"), "itemId");
  if (named === undefined) return invalid("Item operations require an itemId target.");
  const itemId = mappedPlaceholder(pass.maps.items, named);
  if (itemId === undefined) return invalid("Project-item placeholders must be created earlier.");
  candidate.target = stampedTarget(pass, { itemId });
  return bindMoveDestination(pass, candidate) ?? storeOperation(pass, candidate);
}

function bindRenderComposition(pass: ComposePass, candidate: OperationFields): FamilyOutcome {
  const composition = mappedComposition(pass, stringAt(candidate, "compositionId") ?? "");
  if (!composition.ok) return refused(composition.refusal);
  candidate.compositionId = composition.value;
  stampFingerprints(pass, candidate);
  return storeOperation(pass, candidate);
}

function bindProjectSettings(pass: ComposePass, candidate: OperationFields): FamilyOutcome {
  stampFingerprints(pass, candidate);
  return storeOperation(pass, candidate);
}

interface PrecomposeIds {
  callerCompositionId: string;
  callerLayerId: string;
  newCompositionId: string;
  newLayerId: string;
}

function precomposeIds(candidate: OperationFields, index: number): PrecomposeIds {
  return {
    callerCompositionId: stringAt(candidate, "newCompositionId") ?? "",
    callerLayerId: stringAt(candidate, "newLayerId") ?? "",
    newCompositionId: `__new__:comp${index}`,
    newLayerId: `__new__:layer${index}`,
  };
}

function precomposeIdsUsable(pass: ComposePass, ids: PrecomposeIds): boolean {
  if (!ids.callerCompositionId || !ids.callerLayerId) return false;
  const heldLayer = pass.maps.layers.get(ids.callerLayerId);
  const reusesForwardIds = pass.forwardPlaceholders && pass.maps.compositions.get(ids.callerCompositionId) === ids.newCompositionId && heldLayer?.layerId === ids.newLayerId;
  return reusesForwardIds || (!pass.maps.compositions.has(ids.callerCompositionId) && !pass.maps.layers.has(ids.callerLayerId));
}

function precomposeLayerId(pass: ComposePass, id: JsonValue, compositionId: string): Resolved<JsonValue> {
  if (typeof id !== "string" || !isPlaceholderId(pass.maps.layers, id)) return { ok: true, value: id };
  const mapped = pass.maps.layers.get(id);
  if (!mapped) return pass.forwardPlaceholders ? { ok: true, value: id } : refusal("INVALID_ARGUMENT", `Layer ${id} is not created earlier in this composition.`);
  if (mapped.compositionId && mapped.compositionId !== compositionId) return refusal("INVALID_ARGUMENT", "New layer references must stay in their created composition.");
  return { ok: true, value: mapped.layerId };
}

function precomposeLayerIds(pass: ComposePass, candidate: OperationFields, compositionId: string): Resolved<JsonValue[]> {
  const layerIds: JsonValue[] = [];
  for (const id of arrayAt(candidate, "layerIds") ?? []) {
    const resolved = precomposeLayerId(pass, id, compositionId);
    if (!resolved.ok) return resolved;
    layerIds.push(resolved.value);
  }
  return { ok: true, value: layerIds };
}

function pinPrecomposeIds(pass: ComposePass, ids: PrecomposeIds, compositionId: string): void {
  pass.maps.compositions.set(ids.callerCompositionId, ids.newCompositionId);
  pass.maps.compositions.set(ids.newCompositionId, ids.newCompositionId);
  pass.maps.layers.set(ids.callerLayerId, { compositionId, layerId: ids.newLayerId });
  pass.maps.layers.set(ids.newLayerId, { compositionId, layerId: ids.newLayerId });
}

function bindPrecompose(pass: ComposePass, candidate: OperationFields, index: number): FamilyOutcome {
  const composition = mappedComposition(pass, targetCompositionName(candidate));
  if (!composition.ok) return refused(composition.refusal);
  if (!composition.value) return invalid("precompose_layers requires target.compositionId.");
  const layerIds = precomposeLayerIds(pass, candidate, composition.value);
  if (!layerIds.ok) return refused(layerIds.refusal);
  const ids = precomposeIds(candidate, index);
  if (!precomposeIdsUsable(pass, ids)) return invalid("precompose_layers requires unique newCompositionId and newLayerId placeholders.");
  pinPrecomposeIds(pass, ids, composition.value);
  Object.assign(candidate, {
    target: stampedTarget(pass, { compositionId: composition.value }),
    layerIds: layerIds.value, newCompositionId: ids.newCompositionId, newLayerId: ids.newLayerId,
  });
  return storeOperation(pass, candidate);
}

function mintCopyPlaceholder(pass: ComposePass, callerId: string, newId: string): FamilyOutcome | undefined {
  const named = callerId !== "" && callerId !== newId;
  if (named && pass.maps.compositions.has(callerId) && !pass.forwardPlaceholders) return invalid("duplicate_composition requires a unique newCompositionId placeholder.");
  if (named) pass.maps.compositions.set(callerId, newId);
  pass.maps.compositions.set(newId, newId);
  return undefined;
}

function bindDuplicateComposition(pass: ComposePass, candidate: OperationFields, index: number): FamilyOutcome {
  const source = namedOrImpliedComposition(pass, candidate, { index, type: "duplicate_composition" });
  if (!source.ok) return refused(source.refusal);
  if (!source.value) return invalid("duplicate_composition requires target.compositionId.");
  const newId = `__new__:comp${index}`;
  const clash = mintCopyPlaceholder(pass, stringAt(candidate, "newCompositionId") ?? "", newId);
  if (clash) return clash;
  Object.assign(candidate, { target: stampedTarget(pass, { compositionId: source.value }), newCompositionId: newId });
  return storeOperation(pass, candidate);
}

function bindCompositionTarget(pass: ComposePass, candidate: OperationFields, index: number): FamilyOutcome {
  const type = stringAt(candidate, "type") ?? "";
  const composition = namedOrImpliedComposition(pass, candidate, { index, type });
  if (!composition.ok) return refused(composition.refusal);
  if (!composition.value) return invalid(`${type} requires a compositionId target.`);
  candidate.target = stampedTarget(pass, { compositionId: composition.value });
  return storeOperation(pass, candidate);
}

const PROJECT_ITEM_DECLARATIONS = ["create_folder", "import_file", "create_vector_artwork"];
const ITEM_OPERATIONS = ["set_item_name", "move_item_to_folder", "delete_project_item", "replace_footage", "set_footage_proxy", "clear_footage_proxy", "set_footage_interpretation"];
const PROJECT_SETTINGS = ["set_project_settings", "cleanup_project", "save_project", "collect_project", "switch_project"];
const COMPOSITION_OPERATIONS = ["set_composition_settings", "set_composition_guides", "export_mogrt", "export_frame", "open_composition"];

function handlersFor(types: readonly string[], handler: FamilyHandler): Array<[string, FamilyHandler]> {
  return types.map((type) => [type, handler]);
}

/** The handler that owns each operation type declared at project level. */
export const PROJECT_FAMILY_HANDLERS: ReadonlyMap<string, FamilyHandler> = new Map<string, FamilyHandler>([
  ["create_composition", bindCreateComposition],
  ["precompose_layers", bindPrecompose],
  ["duplicate_composition", bindDuplicateComposition],
  ["render_composition", bindRenderComposition],
  ...handlersFor(PROJECT_ITEM_DECLARATIONS, bindProjectItem),
  ...handlersFor(ITEM_OPERATIONS, bindItemTarget),
  ...handlersFor(PROJECT_SETTINGS, bindProjectSettings),
  ...handlersFor(COMPOSITION_OPERATIONS, bindCompositionTarget),
]);

const MARKER_OPERATIONS: ReadonlySet<string> = new Set(["add_marker", "update_marker", "remove_marker"]);

/** The composition-scoped handler for a marker operation whose target names no layer, otherwise `undefined`. */
export function compositionMarkerHandler(candidate: OperationFields): FamilyHandler | undefined {
  const onComposition = MARKER_OPERATIONS.has(stringAt(candidate, "type") ?? "") && objectAt(candidate, "target") !== undefined && stringAt(objectAt(candidate, "target"), "layerId") === undefined;
  return onComposition ? bindCompositionTarget : undefined;
}
