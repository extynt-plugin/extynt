// Project-level operation kinds: creating folders, importing files, and renaming, moving or deleting existing project items.
import type { ProjectSnapshot } from "@extynt/project-graph";
import type { JsonObject, JsonValue } from "@extynt/decode";
import { IMPORT_AS_VALUES } from "./canonical-enums.js";
import { importSequenceError } from "./footage-rules.js";
import type { OperationContext } from "./layer-targets.js";
import { currentItemTarget, isCurrentIdentity } from "./plan-shape.js";
import { ACCEPTED, invalid, isAbsoluteBoundedPath, isBoundedName, isOneOf, isPlaceholderField, isRefusal, objectsIn, rejectUnknown, targetOf, type OperationResult, type Refusal } from "./validation-primitives.js";

type ProjectCreate = { readonly fields: readonly string[]; readonly idField: "newFolderId" | "newItemId" };
type ParentField = "parentFolderId" | "destinationFolderId";

const FOLDER_CREATE: ProjectCreate = { fields: ["type", "newFolderId", "snapshotFingerprint", "selectionFingerprint", "name", "parentFolderId"], idField: "newFolderId" };
const IMPORT_CREATE: ProjectCreate = { fields: ["type", "newItemId", "snapshotFingerprint", "selectionFingerprint", "path", "importAs", "destinationFolderId", "sequence", "forceAlphabetical"], idField: "newItemId" };
const ITEM_PRODUCERS: readonly string[] = ["import_file", "create_vector_artwork"];
const PROJECT_REFERENCE_KEYS = ["newFolderId", "newItemId", "parentFolderId", "destinationFolderId", "folderId"] as const;
const FOLDER_DEPTH_LIMIT = 256;
const IMPORT_MESSAGE = "Import requires a bounded absolute path and supported importAs.";
const FOLDER_NOT_FOUND_MESSAGE = "Destination folder must exist or be created earlier in this plan.";

function hasEarlierFolderCreate(earlier: readonly JsonValue[], folderId: string): boolean {
  return objectsIn(earlier).some((operation) => operation.type === "create_folder" && operation.newFolderId === folderId);
}

function hasEarlierProjectCreate(earlier: readonly JsonValue[], id: string): boolean {
  const producesItem = (operation: JsonObject): boolean => typeof operation.type === "string" && ITEM_PRODUCERS.includes(operation.type) && operation.newItemId === id;
  return hasEarlierFolderCreate(earlier, id) || objectsIn(earlier).some(producesItem);
}

function isProjectItemAvailable(snapshot: ProjectSnapshot | undefined, id: string): boolean {
  return snapshot ? (snapshot.items ?? []).some((item) => item.id === id) : true;
}

function isItemKnown(context: OperationContext, id: string): boolean {
  return isProjectItemAvailable(context.snapshot, id) || hasEarlierProjectCreate(context.earlier, id);
}

function hasEarlierProjectItemReference(earlier: readonly JsonValue[], id: string): boolean {
  return objectsIn(earlier).some((operation) => targetOf(operation)?.itemId === id || PROJECT_REFERENCE_KEYS.some((key) => operation[key] === id));
}

/** The refusal for a destination folder that is neither a folder in the snapshot nor created earlier in the plan; none when no folder is named. */
export function projectParentError(context: OperationContext, field: ParentField): Refusal | undefined {
  const { operation, snapshot, earlier } = context;
  const parent = operation[field];
  if (parent === undefined || parent === null) return undefined;
  const parentId = String(parent);
  const observed = snapshot?.items?.find((item) => item.id === parentId);
  if (observed) return observed.type === "folder" ? undefined : invalid("TARGET_NOT_FOUND", "Destination must be a project folder, not another project item type.");
  return hasEarlierFolderCreate(earlier, parentId) ? undefined : invalid("TARGET_NOT_FOUND", FOLDER_NOT_FOUND_MESSAGE);
}

function projectCreateError(context: OperationContext, create: ProjectCreate): Refusal | undefined {
  const { operation, plan } = context;
  const unknownField = rejectUnknown(operation, create.fields);
  if (unknownField) return unknownField;
  if (!isCurrentIdentity(operation, plan)) return invalid("STALE_TARGET", "Project operations require current snapshot identity.");
  return isPlaceholderField(operation[create.idField]) ? undefined : invalid("INVALID_OPERATION", "Project creates require a __new__: placeholder id.");
}

/** create_folder: current snapshot identity, a `__new__:` placeholder id, a bounded name, and a parent folder that exists or is created earlier. */
export function validateCreateFolder(context: OperationContext): OperationResult {
  const problem = projectCreateError(context, FOLDER_CREATE);
  if (problem) return problem;
  if (!isBoundedName(context.operation.name, 256)) return invalid("INVALID_VALUE", "Folder name must be 1-256 characters.");
  return projectParentError(context, "parentFolderId") ?? ACCEPTED;
}

function importFileError(operation: JsonObject): Refusal | undefined {
  if (!isAbsoluteBoundedPath(operation.path, 1024)) return invalid("INVALID_VALUE", IMPORT_MESSAGE);
  const importAs = operation.importAs;
  if (importAs !== undefined && !isOneOf(importAs, IMPORT_AS_VALUES)) return invalid("INVALID_VALUE", IMPORT_MESSAGE);
  return importSequenceError(operation);
}

/** import_file: current snapshot identity, a `__new__:` placeholder id, a bounded absolute path, a supported importAs, and a destination folder that exists or is created earlier. */
export function validateImportFile(context: OperationContext): OperationResult {
  const problem = projectCreateError(context, IMPORT_CREATE) ?? importFileError(context.operation);
  return problem ?? projectParentError(context, "destinationFolderId") ?? ACCEPTED;
}

function existingItem(context: OperationContext, allowed: readonly string[]): { readonly itemId: string } | Refusal {
  const { operation, plan } = context;
  const unknownField = rejectUnknown(operation, allowed);
  if (unknownField) return unknownField;
  const target = currentItemTarget(operation, plan, "Item operation requires an exact current item target.");
  if (isRefusal(target)) return target;
  return isItemKnown(context, target.itemId) ? target : invalid("TARGET_NOT_FOUND", "Item must exist or be imported/created earlier in this plan.");
}

/** set_item_name: an exact project item that exists or is created earlier, and a bounded name. */
export function validateSetItemName(context: OperationContext): OperationResult {
  const target = existingItem(context, ["type", "target", "name"]);
  if (isRefusal(target)) return target;
  return isBoundedName(context.operation.name, 256) ? ACCEPTED : invalid("INVALID_VALUE", "Item name must be 1-256 characters.");
}

function parentFolderOf(snapshot: ProjectSnapshot | undefined, itemId: string): string | null | undefined {
  return snapshot?.items?.find((item) => item.id === itemId)?.parentFolderId;
}

function folderCycle(itemId: string, folderId: string, snapshot: ProjectSnapshot | undefined): boolean {
  let cursor: string | null | undefined = folderId;
  for (let depth = 0; cursor && depth < FOLDER_DEPTH_LIMIT; depth += 1) {
    if (cursor === itemId) return true;
    cursor = parentFolderOf(snapshot, cursor);
  }
  return false;
}

/** move_item_to_folder: an exact project item and a destination folder (or null for the project root) that exists or is created earlier, never the item's own subtree. */
export function validateMoveItemToFolder(context: OperationContext): OperationResult {
  const target = existingItem(context, ["type", "target", "folderId"]);
  if (isRefusal(target)) return target;
  const folderId = context.operation.folderId;
  if (folderId === null) return ACCEPTED;
  if (typeof folderId !== "string" || !isItemKnown(context, folderId)) return invalid("TARGET_NOT_FOUND", FOLDER_NOT_FOUND_MESSAGE);
  return folderCycle(target.itemId, folderId, context.snapshot) ? invalid("FOLDER_CYCLE", "A folder cannot be moved into itself or one of its own subfolders.") : ACCEPTED;
}

/** delete_project_item: an exact project item that exists or is created earlier, explicit confirmation, and no earlier operation in the plan referencing the item. */
export function validateDeleteProjectItem(context: OperationContext): OperationResult {
  const target = existingItem(context, ["type", "target", "destructive"]);
  if (isRefusal(target)) return target;
  if (context.operation.destructive !== true) return invalid("DESTRUCTIVE_CONFIRMATION_REQUIRED", "delete_project_item requires destructive:true.");
  return hasEarlierProjectItemReference(context.earlier, target.itemId) ? invalid("ITEM_REFERENCED_EARLIER", "delete_project_item cannot remove an item referenced earlier in the same plan.") : ACCEPTED;
}
