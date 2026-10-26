// The one table of which fields declare a brand-new object rather than referring to one, plus the vocabulary helpers built on it.
import type { ActionPlanV2Operation } from "@extynt/action-plan";
import { asObject, jsonFieldsOf, stringAt } from "./json.js";
import type { JsonObject, JsonValue } from "@extynt/decode";

/** Where an operation declares a brand-new object, as opposed to referring to one. */
export const DECLARES: Readonly<Record<string, readonly string[]>> = {
  create_layer: ["target.layerId"],
  duplicate_layer: ["newLayerId"],
  derive_layer: ["newLayerId"],
  create_composition: ["newCompositionId"],
  duplicate_composition: ["newCompositionId"],
  precompose_layers: ["newCompositionId", "newLayerId"],
  create_folder: ["newFolderId"],
  import_file: ["newItemId"],
  create_vector_artwork: ["newItemId"],
  add_mask: ["newMaskId"],
  create_shape_group: ["newGroupId"],
  add_text_animator: ["newAnimatorId"],
  add_shape_item: ["newItemId"],
};

/** The namespace prefix of every minted canonical id. */
export const CANONICAL_PREFIX = "__new__:";

/** The canonical id shape the composer mints per declaring field, for a declaration that named nothing. */
export const CANONICAL_FIELDS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  create_layer: { "target.layerId": "layer" },
  duplicate_layer: { newLayerId: "layer" },
  derive_layer: { newLayerId: "layer" },
  create_composition: { newCompositionId: "comp" },
  duplicate_composition: { newCompositionId: "comp" },
  precompose_layers: { newCompositionId: "comp", newLayerId: "layer" },
  create_folder: { newFolderId: "folder" },
  import_file: { newItemId: "item" },
  create_vector_artwork: { newItemId: "item" },
  add_mask: { newMaskId: "mask" },
  create_shape_group: { newGroupId: "shape" },
  add_text_animator: { newAnimatorId: "animator" },
  add_shape_item: { newItemId: "shapeitem" },
};

/** Every declaring field as the operation type, the field name and, for a nested field, the key inside it. */
export const DECLARED_PATHS: ReadonlyArray<readonly [type: string, head: string, tail: string]> = Object.entries(DECLARES).flatMap(([type, paths]) =>
  paths.map((path) => {
    const [head = "", tail = ""] = path.split(".");
    return [type, head, tail] as const;
  }),
);

interface BindingSite {
  readonly raw: JsonObject;
  readonly stored: JsonObject;
  readonly type: string;
  readonly head: string;
  readonly tail: string;
  readonly index: number;
}

function fieldValue(operation: JsonObject, head: string, tail: string): JsonValue | undefined {
  const field = operation[head];
  return tail === "" ? field : asObject(field)?.[tail];
}

function isCanonicalId(candidate: JsonValue | undefined): candidate is string {
  return typeof candidate === "string" && candidate.startsWith(CANONICAL_PREFIX);
}

function canonicalIdOf(type: string, head: string, tail: string): string | undefined {
  return CANONICAL_FIELDS[type]?.[tail ? `${head}.${tail}` : head];
}

/** The `__new__:` names the operation declares, in the order the table lists the fields. */
export function declaredNames(operation: JsonObject): string[] {
  const paths = DECLARES[stringAt(operation, "type") ?? ""] ?? [];
  return paths.flatMap((path) => {
    const [head = "", tail = ""] = path.split(".");
    const declared = fieldValue(operation, head, tail);
    return isCanonicalId(declared) ? [declared] : [];
  });
}

/** Whether a name is the canonical id for a declaration of this kind. */
export function isCanonicalName(name: string, kind: string): boolean {
  if (!name.startsWith(CANONICAL_PREFIX)) return false;
  return new RegExp(`^${kind}\\d+$`).test(name.slice(CANONICAL_PREFIX.length));
}

function bindSite(bindings: Record<string, string>, site: BindingSite): void {
  const { raw, stored, type, head, tail, index } = site;
  const from = fieldValue(raw, head, tail);
  const to = fieldValue(stored, head, tail);
  if (isCanonicalId(from) && isCanonicalId(to) && from !== to) {
    bindings[from] = to;
    return;
  }
  const canonical = canonicalIdOf(type, head, tail);
  if (canonical && isCanonicalId(to)) bindings[`${CANONICAL_PREFIX}${canonical}${index}`] = to;
}

type DeclaredPair = { raw: JsonValue; stored: JsonValue | ActionPlanV2Operation };

function bindOperation(bindings: Record<string, string>, pair: DeclaredPair, index: number): void {
  const raw = asObject(pair.raw);
  const stored = jsonFieldsOf(pair.stored);
  if (!raw) return;
  const type = stringAt(stored, "type") ?? stringAt(raw, "type") ?? "";
  for (const [declaresType, head, tail] of DECLARED_PATHS) {
    if (declaresType === type) bindSite(bindings, { raw, stored, type, head, tail, index });
  }
}

/** The names one composed batch introduced, in the caller's own vocabulary: a stored operation carries canonical ids. */
export function declaredBindings(pairs: ReadonlyArray<DeclaredPair>): Record<string, string> {
  const bindings: Record<string, string> = {};
  pairs.forEach((pair, index) => bindOperation(bindings, pair, index));
  return bindings;
}
