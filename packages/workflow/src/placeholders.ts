// The `__new__:` placeholder vocabulary: names a plan gives to layers or items it has not created yet, before the host assigns identities.

const PLACEHOLDER_PREFIX = "__new__:";
const PLACEHOLDER_NAME = /^__new__:[A-Za-z0-9._-]{1,128}$/;

/** Whether the text is a well-formed, bounded `__new__:` placeholder name. */
export function isPlaceholderName(value: string): boolean {
  return PLACEHOLDER_NAME.test(value);
}

/** Whether the text begins like a placeholder, well formed or not. */
export function isPlaceholderLike(value: string): boolean {
  return value.startsWith(PLACEHOLDER_PREFIX);
}

/** The payload fields in which each creator operation mints a placeholder. */
export const CREATOR_PLACEHOLDER_PATHS: Readonly<Record<string, readonly string[]>> = {
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
