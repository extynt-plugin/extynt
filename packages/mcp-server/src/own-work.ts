// Which removals only undo what the same job created: the layer, and any mask or marker on it, existed only because this job made it, so taking it away destroys nothing the user had.
import { jsonRecordOf, objectAt, stringAt } from "./json.js";
import type { JsonObject } from "@extynt/decode";

const NEVER_OWNED: ReadonlySet<string> = new Set(["cleanup_project", "remove_unused_footage"]);
const CREATED_ID_FIELDS = ["newLayerId", "newCompositionId", "newFolderId", "newItemId"] as const;

function nonEmpty(value: string | undefined): string | undefined {
  return value || undefined;
}

function isRemoval(type: string): boolean {
  return type.startsWith("remove_") || type.startsWith("delete_") || type === "cleanup_project";
}

function createdBy(operation: JsonObject): string[] {
  const named = CREATED_ID_FIELDS.flatMap((field) => nonEmpty(stringAt(operation, field)) ?? []);
  const target = nonEmpty(stringAt(objectAt(operation, "target"), "layerId"));
  return operation.type === "create_layer" && target ? [...named, target] : named;
}

function removalSubject(operation: JsonObject): string | undefined {
  const target = objectAt(operation, "target");
  if (operation.type === "delete_project_item") return nonEmpty(stringAt(target, "itemId"));
  return nonEmpty(stringAt(target, "layerId")) ?? nonEmpty(stringAt(target, "compositionId"));
}

/** Indexes of the removals whose target this job created earlier in the plan or in an earlier batch of the job; a target that cannot be proven job-created is not owned. */
export function ownedRemovalIndexes<T extends { readonly type: string }>(operations: ReadonlyArray<T>, jobCreatedIds: ReadonlySet<string> = new Set()): Set<number> {
  const planned = new Set<string>();
  const owned = new Set<number>();
  operations.forEach((operation, index) => {
    const fields = jsonRecordOf(operation) ?? {};
    const subject = removalSubject(fields);
    const removal = isRemoval(operation.type) && !NEVER_OWNED.has(operation.type);
    if (removal && subject !== undefined && (planned.has(subject) || jobCreatedIds.has(subject))) owned.add(index);
    for (const created of createdBy(fields)) planned.add(created);
  });
  return owned;
}
