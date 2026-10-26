// Wire shapes of the project-scoped host operations: items, footage, compositions, output and project settings.
// An optional field typed `| undefined` is serialised away, so it reads on the wire exactly like an absent one.
import type {
  CleanupProjectOperation, CompositionSettingsFields, CreateVectorArtworkOperation, ImportFileOperation, RenderCompositionOperation, SaveProjectOperation,
  SetCompositionGuidesOperation, SetProjectSettingsOperation, SvgImporterRoute, VectorArtworkFallback,
} from "@extynt/action-plan";
import type { LayerRef } from "./host-layer-operations.js";

export type VectorArtworkHostOperation = {
  operation: "create_vector_artwork";
  newItemId: string;
  name: string;
  svg: string;
  sourceHash: string;
  metadata: CreateVectorArtworkOperation["metadata"];
  importMode: "editable";
  managedSourcePolicy: "retain";
  destinationFolderId?: string | null | undefined;
  durationSeconds?: number;
  frameRate?: number;
} & VectorArtworkFallback & SvgImporterRoute;

export type ProjectItemHostOperation =
  | { operation: "create_folder"; newFolderId: string; name: string; parentFolderId: string | null | undefined }
  | { operation: "set_item_name"; itemId: string; name: string }
  | { operation: "move_item_to_folder"; itemId: string; folderId: string | null }
  | { operation: "delete_project_item"; itemId: string; destructive: true };

export type FootageHostOperation =
  | { operation: "import_file"; newItemId: string; path: string; importAs: ImportFileOperation["importAs"]; destinationFolderId: ImportFileOperation["destinationFolderId"]; sequence: boolean | undefined; forceAlphabetical: boolean | undefined }
  | VectorArtworkHostOperation
  | { operation: "replace_footage" | "set_footage_proxy"; itemId: string; path: string }
  | { operation: "clear_footage_proxy"; itemId: string };

export type CompositionHostOperation =
  | { operation: "create_composition"; newCompositionId: string; name: string; width: number; height: number; durationSeconds: number; frameRate: number }
  | { operation: "duplicate_composition"; compositionId: string; newCompositionId: string; name?: string }
  | { operation: "set_composition_settings"; compositionId: string; settings: CompositionSettingsFields }
  | { operation: "render_composition"; compositionId: string; renderSettingsTemplate: string | undefined; outputModuleTemplate: string | undefined; outputPath: string; destinationPolicy: "explicit-local-path"; executeAuthorization: RenderCompositionOperation["executeAuthorization"]; outputSettings: RenderCompositionOperation["outputSettings"]; renderSettings: RenderCompositionOperation["renderSettings"]; mediaEncoder: RenderCompositionOperation["mediaEncoder"] };

export type OutputHostOperation =
  | { operation: "export_mogrt"; compositionId: string; templateName: string; outputPath: string; overwrite: boolean; exportAuthorization: "EXPORT_NOW" }
  | { operation: "export_frame"; compositionId: string; time: number; outputPath: string; overwrite: boolean; resolution: number; exportAuthorization: "EXPORT_NOW" }
  | { operation: "set_composition_guides"; compositionId: string; guides: SetCompositionGuidesOperation["guides"]; replace: boolean };

export type ProjectSettingsHostOperation =
  | { operation: "cleanup_project"; mode: CleanupProjectOperation["mode"]; compositionIds: readonly string[] | undefined; destructive: true }
  | { operation: "save_project"; mode: SaveProjectOperation["mode"]; path?: string; overwrite: boolean }
  | { operation: "set_project_settings"; settings: SetProjectSettingsOperation["settings"] }
  | (LayerRef & { operation: "add_essential_property"; propertyPath: string; name?: string });
