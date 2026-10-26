// Wire shapes of the mask, vector-shape and 3D-option host operations.
// Vector menus are After Effects' own 1-based values: fill rule 1 non-zero, 2 even-odd; line cap 1 butt, 2 round, 3 projecting; line join 1 miter, 2 round, 3 bevel.
import type { MaskValues, SetCameraOptionsOperation, SetLightOptionsOperation, SetMaterialOptionsOperation, ShapePath } from "@extynt/action-plan";
import type { LayerRef } from "./host-layer-operations.js";

type Rgb = readonly [number, number, number];

export type HostVectorShape = {
  name: string;
  paths: readonly ShapePath[];
  fill?: { color: Rgb; opacity?: number; rule?: 1 | 2 };
  stroke?: { color: Rgb; width: number; opacity?: number; cap?: 1 | 2 | 3; join?: 1 | 2 | 3; miterLimit?: number };
  opacity?: number;
};

export type MaskHostOperation =
  | (LayerRef & { operation: "add_mask"; newMaskId: string; name: string; values: MaskValues | undefined })
  | (LayerRef & { operation: "update_mask"; maskId: string; values: MaskValues })
  | (LayerRef & { operation: "remove_mask"; maskId: string; destructive: true });

export type ShapeHostOperation =
  | (LayerRef & { operation: "create_shape_group"; newGroupId: string; name: string })
  | (LayerRef & { operation: "set_shape_path"; groupId: string; path: ShapePath })
  | (LayerRef & { operation: "ensure_shape_fill"; groupId: string; color: Rgb; opacity: number | undefined })
  | (LayerRef & { operation: "ensure_shape_stroke"; groupId: string; color: Rgb; width: number; opacity: number | undefined })
  | (LayerRef & { operation: "draw_vector_shapes"; shapes: HostVectorShape[] });

export type ThreeDOptionsHostOperation =
  | (LayerRef & { operation: "set_camera_options"; options: SetCameraOptionsOperation["options"] })
  | (LayerRef & { operation: "set_light_options"; options: SetLightOptionsOperation["options"] })
  | (LayerRef & { operation: "set_material_options"; options: SetMaterialOptionsOperation["options"] });
