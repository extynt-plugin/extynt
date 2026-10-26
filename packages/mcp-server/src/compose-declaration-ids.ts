// Declaration-only ids (a shape item, mask, shape group or text animator a later operation may never name) are
// bookkeeping the caller should not have to invent. One implementation fills them for every client: the composer
// as a reported correction, and the panel's queue before composition.
import { recordChange } from "./compose-correction-core.js";
import type { CorrectionStep } from "./compose-correction-core.js";
import { stringAt } from "./json.js";
import { isJsonObject } from "@extynt/decode";
import type { JsonValue } from "@extynt/decode";

const DECLARATION_ID_FIELDS: Readonly<Record<string, string>> = {
  add_shape_item: "newItemId",
  add_mask: "newMaskId",
  create_shape_group: "newGroupId",
  add_text_animator: "newAnimatorId",
};

function usedPlaceholders(operations: ReadonlyArray<JsonValue>): Set<string> {
  const values = operations.flatMap((operation) => (isJsonObject(operation) ? Object.values(operation) : []));
  return new Set(values.filter((value): value is string => typeof value === "string" && value.startsWith("__new__:")));
}

function slug(text: string): string {
  return text.replace(/[^a-z0-9]+/gi, "-");
}

function mintedId(type: string, salt: string, position: number, used: Set<string>): string {
  const stem = `__new__:auto-${slug(type)}${salt ? `-${slug(salt).slice(-16)}` : ""}-${position}`;
  let candidate = stem, suffix = 1;
  while (used.has(candidate)) candidate = `${stem}-${suffix++}`;
  used.add(candidate);
  return candidate;
}

/** Fills a missing declaration id on each operation of `operations` in place; `offset` is the call's position within the queue. Returns how many it filled. */
export function supplyDeclarationIds(operations: ReadonlyArray<JsonValue>, salt: string, offset: number): number {
  const used = usedPlaceholders(operations);
  let filled = 0;
  operations.forEach((entry, index) => {
    if (!isJsonObject(entry)) return;
    const type = stringAt(entry, "type") ?? "";
    const field = DECLARATION_ID_FIELDS[type];
    if (!field || entry[field] !== undefined) return;
    Object.assign(entry, { [field]: mintedId(type, salt, offset + index, used) });
    filled += 1;
  });
  return filled;
}

/** The composer's correction: a declaration without its id gets one, and the caller is told which. */
export const supplyDeclarationId: CorrectionStep = (operation, context) => {
  const field = DECLARATION_ID_FIELDS[context.type];
  if (!field || operation[field] !== undefined) return undefined;
  const id = mintedId(context.type, "", context.index, usedPlaceholders(context.call ?? []));
  operation[field] = id;
  recordChange(context, { field, from: undefined, to: id, why: `${context.type} declares an id nothing needs to name; one was supplied` });
  return undefined;
};
