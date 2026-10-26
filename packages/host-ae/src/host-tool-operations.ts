// Wire shapes of the host operations that act on one layer, effect, keyframe set or project as a whole tool: derive, retime, dolly, keyframe edits, effect edits, analysis, puppet pins and project switching.
// The host derives each dolly Position key from the camera's own axis at apply time; a dolly distance is pixels to the Point of Interest.
import type { CubicBezierCurve, DeriveLayerKind, PathNullPointKind, RetimeMode } from "@extynt/action-plan";
import type { LayerRef } from "./host-layer-operations.js";
import type { OperationOf } from "./v2/compiler-table.js";

type EditKeyframesOperation = OperationOf<"edit_keyframes">;

export type DollyHostKeyframe = { time: number; distance: number; curve?: CubicBezierCurve | undefined };

export type LayerDeriveHostOperation =
  | (LayerRef & { operation: "derive_layer"; kind: DeriveLayerKind; newLayerId: string; time: number | undefined; propertyPath: string | undefined; pointIndex: number | undefined; pointKind: PathNullPointKind | undefined; name: string | undefined })
  | (LayerRef & { operation: "retime_layer"; mode: RetimeMode; time: number | undefined })
  | (LayerRef & { operation: "dolly_camera"; keyframes: DollyHostKeyframe[] });

export type KeyframeHostOperation =
  | (LayerRef & { operation: "read_keyframes"; propertyPath: string; maxKeys?: number })
  | (LayerRef & { operation: "edit_keyframes"; propertyPath: string; action: NonNullable<EditKeyframesOperation["action"]> } & KeyframeSelection & KeyframeAdjustment);

export type KeyframeSelection = Pick<EditKeyframesOperation, "times" | "indices" | "all" | "source">;

export type KeyframeAdjustment = Pick<EditKeyframesOperation, "offset" | "about" | "factor" | "timeOffset" | "keyframeMode">;

export type EffectEditHostOperation =
  | (LayerRef & { operation: "remove_effect"; effectPath: string; destructive: true })
  | (LayerRef & { operation: "reorder_effect"; effectPath: string; index: number })
  | (LayerRef & { operation: "copy_effects"; source: LayerRef; effectPaths?: readonly string[] });

export type LayerToolHostOperation =
  | (LayerRef & { operation: "tracker_to_nulls"; trackerName?: string; point: "attach-point" | "feature-center" })
  | (LayerRef & { operation: "save_layer_preset"; effectPaths?: readonly string[]; outputPath: string; overwrite: boolean; exportAuthorization: "EXPORT_NOW" })
  | (LayerRef & { operation: "resize_solid"; width?: number; height?: number; pixelAspect?: number; allUsers: boolean })
  | (LayerRef & { operation: "set_text_path"; maskIndex?: number; firstMargin?: number; lastMargin?: number })
  | (LayerRef & { operation: "start_analysis"; kind: "warp-stabilizer" | "camera-tracker-3d" })
  | (LayerRef & { operation: "replace_layer_source"; sourceItemId: string })
  | (LayerRef & { operation: "center_anchor"; time?: number })
  | (LayerRef & { operation: "set_puppet_pins"; pins: OperationOf<"set_puppet_pins">["pins"]; relative?: true });

export type ProjectToolHostOperation =
  | { operation: "switch_project"; mode: "new" | "open"; path?: string; discardUnsaved: boolean }
  | { operation: "collect_project"; destinationFolder: string; projectName: string; exportAuthorization: "EXPORT_NOW" }
  | { operation: "open_composition"; compositionId: string };
