// Wire shapes of the layer-scoped host operations: effects, text, properties, animation, state, structure and markers.
// An optional field typed `| undefined` is serialised away, so it reads on the wire exactly like an absent one.
import type {
  AnimatePropertyOperation, CreateLayerOperation, EnsureEffectOperation, EnsureLayerStyleOperation, ExpressionSpec, FootageInterpretationValues,
  KeyframeMode, KeyframeSpec, SetEffectControlOperation, SetLayerAttributeOperation, SetLayerPropertyOperation, SetTextDocumentOperation,
} from "@extynt/action-plan";

export type LayerRef = { compositionId: string; layerId: string };

type TextDocumentFields = Omit<SetTextDocumentOperation, "type" | "target">;

export type EffectHostOperation =
  | (LayerRef & { operation: "ensure_effect"; capabilityId: string; effectMatchName: string; effectPath: string; enabled?: boolean | undefined; initialization?: EnsureEffectOperation["initialization"] })
  | (LayerRef & { operation: "apply_preset"; presetId?: string; presetFile?: string; presetPath?: string })
  | (LayerRef & { operation: "ensure_layer_style"; style: string; styleMatchName: string; menu: string; commandId: number; enabled: boolean; values?: EnsureLayerStyleOperation["values"] })
  | (LayerRef & { operation: "set_effect_control"; effectMatchName: string; effectPath?: string | undefined; propertyPath: string; value: SetEffectControlOperation["value"] });

export type TextHostOperation =
  | (LayerRef & { operation: "set_text_document" } & TextDocumentFields)
  | (LayerRef & { operation: "ensure_text_animator"; role: string; value: number });

export type LayerPropertyHostOperation =
  | (LayerRef & { operation: "set_layer_property"; propertyPath: string; role: string; value: SetLayerPropertyOperation["value"] })
  | (LayerRef & { operation: "set_layer_name"; name: string })
  | (LayerRef & { operation: "set_layer_parent"; parentLayerId: string | null })
  | (LayerRef & { operation: "set_layer_attribute"; role: string; value: SetLayerAttributeOperation["value"]; hostProperty?: string });

export type LayerAnimationHostOperation =
  | (LayerRef & { operation: "animate_control"; effectMatchName: string; effectPath?: string | undefined; propertyPath: string; role: string; keyframes?: KeyframeSpec[] | undefined; keyframeMode?: KeyframeMode; expression?: ExpressionSpec | undefined })
  | (LayerRef & { operation: "animate_property"; propertyPath: string; role?: AnimatePropertyOperation["role"]; keyframes?: KeyframeSpec[] | undefined; keyframeMode?: KeyframeMode; expression?: ExpressionSpec | undefined })
  | (LayerRef & { operation: "set_expression"; propertyPath: string; source: string; enabled: boolean });

export type LayerStateHostOperation =
  | (LayerRef & { operation: "create_layer"; layerType: string; name: string; text?: string | undefined; color?: CreateLayerOperation["color"]; box?: CreateLayerOperation["box"]; vertical?: boolean | undefined; justification?: CreateLayerOperation["justification"]; size?: CreateLayerOperation["size"]; sourceItemId?: string | undefined })
  | (LayerRef & { operation: "set_layer_timing"; inPoint?: number | undefined; outPoint?: number | undefined; startTime?: number | undefined; stretch?: number | undefined })
  | (LayerRef & { operation: "set_audio"; enabled?: boolean | undefined; levelDb?: number | undefined })
  | (LayerRef & { operation: "set_time_remap"; enabled: boolean })
  | { operation: "set_footage_interpretation"; itemId: string; interpretation: FootageInterpretationValues }
  | (LayerRef & { operation: "detect_scene_edits"; mode: "markers" | "split" | "split-precomp" });

export type LayerStructureHostOperation =
  | (LayerRef & { operation: "duplicate_layer"; newLayerId: string })
  | (LayerRef & { operation: "remove_layer"; destructive: true })
  | (LayerRef & { operation: "reorder_layer"; placement: "beginning" | "end" | "before" | "after"; referenceLayerId?: string | undefined })
  | (LayerRef & { operation: "set_track_matte"; matteLayerId: string | null; mode: "alpha" | "alpha-inverted" | "luma" | "luma-inverted"; showMatteLayer?: true });

export type MarkerHostOperation =
  | { operation: "add_marker" | "update_marker"; compositionId: string; layerId: string | undefined; time: number; comment: string | undefined; duration: number | undefined; chapter: string | undefined; url: string | undefined; cuePointName: string | undefined; label: number | undefined }
  | { operation: "remove_marker"; compositionId: string; layerId: string | undefined; time: number; destructive: true };
