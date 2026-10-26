// Compilers for the project and composition kinds: project items, footage, composition settings, output and project settings.
import type { CreateVectorArtworkOperation } from "@extynt/action-plan";
import type { VectorArtworkHostOperation } from "../host-project-operations.js";
import { compilerTable } from "./compiler-table.js";
import { layerRef, validatedPropertyPath } from "./host-values.js";

function vectorArtworkOperation(operation: CreateVectorArtworkOperation): VectorArtworkHostOperation {
  const { type: _type, snapshotFingerprint: _snapshot, selectionFingerprint: _selection, ...fields } = operation;
  return { ...fields, operation: "create_vector_artwork", destinationFolderId: operation.destinationFolderId };
}

export const PROJECT_ITEM_COMPILERS = compilerTable({
  create_folder: (operation) => ({ operation: "create_folder", newFolderId: operation.newFolderId, name: operation.name, parentFolderId: operation.parentFolderId }),
  set_item_name: (operation) => ({ operation: "set_item_name", itemId: operation.target.itemId, name: operation.name }),
  move_item_to_folder: (operation) => ({ operation: "move_item_to_folder", itemId: operation.target.itemId, folderId: operation.folderId }),
  delete_project_item: (operation) => ({ operation: "delete_project_item", itemId: operation.target.itemId, destructive: true }),
});

export const FOOTAGE_COMPILERS = compilerTable({
  import_file: (operation) => ({ operation: "import_file", newItemId: operation.newItemId, path: operation.path, importAs: operation.importAs, destinationFolderId: operation.destinationFolderId, sequence: operation.sequence, forceAlphabetical: operation.forceAlphabetical }),
  create_vector_artwork: vectorArtworkOperation,
  replace_footage: (operation) => ({ operation: "replace_footage", itemId: operation.target.itemId, path: operation.path }),
  set_footage_proxy: (operation) => ({ operation: "set_footage_proxy", itemId: operation.target.itemId, path: operation.path }),
  clear_footage_proxy: (operation) => ({ operation: "clear_footage_proxy", itemId: operation.target.itemId }),
});

export const COMPOSITION_COMPILERS = compilerTable({
  create_composition: (operation) => ({ operation: "create_composition", newCompositionId: operation.newCompositionId, name: operation.name, width: operation.width, height: operation.height, durationSeconds: operation.durationSeconds, frameRate: operation.frameRate }),
  duplicate_composition: (operation) => ({ operation: "duplicate_composition", compositionId: operation.target.compositionId, newCompositionId: operation.newCompositionId, ...(operation.name === undefined ? {} : { name: operation.name }) }),
  set_composition_settings: (operation) => ({ operation: "set_composition_settings", compositionId: operation.target.compositionId, settings: operation.settings }),
  render_composition: (operation) => ({ operation: "render_composition", compositionId: operation.compositionId, renderSettingsTemplate: operation.renderSettingsTemplate, outputModuleTemplate: operation.outputModuleTemplate, outputPath: operation.outputPath, destinationPolicy: operation.destinationPolicy, executeAuthorization: operation.executeAuthorization, outputSettings: operation.outputSettings, renderSettings: operation.renderSettings, mediaEncoder: operation.mediaEncoder }),
});

export const OUTPUT_COMPILERS = compilerTable({
  export_mogrt: (operation) => ({ operation: "export_mogrt", compositionId: operation.target.compositionId, templateName: operation.templateName, outputPath: operation.outputPath, overwrite: operation.overwrite ?? false, exportAuthorization: operation.exportAuthorization }),
  export_frame: (operation) => ({ operation: "export_frame", compositionId: operation.target.compositionId, time: operation.time, outputPath: operation.outputPath, overwrite: operation.overwrite ?? false, resolution: operation.resolution ?? 1, exportAuthorization: operation.exportAuthorization }),
  set_composition_guides: (operation) => ({ operation: "set_composition_guides", compositionId: operation.target.compositionId, guides: operation.guides, replace: operation.replace ?? false }),
});

export const PROJECT_SETTINGS_COMPILERS = compilerTable({
  cleanup_project: (operation) => ({ operation: "cleanup_project", mode: operation.mode, compositionIds: operation.compositionIds, destructive: true }),
  save_project: (operation) => ({ operation: "save_project", mode: operation.mode, ...(operation.path === undefined ? {} : { path: operation.path }), overwrite: operation.overwrite ?? false }),
  set_project_settings: (operation) => ({ operation: "set_project_settings", settings: operation.settings }),
  add_essential_property: (operation) => ({ operation: "add_essential_property", ...layerRef(operation.target), propertyPath: validatedPropertyPath(operation.target), ...(operation.name ? { name: operation.name } : {}) }),
});
