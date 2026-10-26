// The decoders and types of the mask, shape and 3D option operations.
import { array, boolean, jsonObject, literal, number, optional, refine, string, strictObject, tuple, type Infer } from "@extynt/decode";
import { SHAPE_ITEMS, type ShapeItemKind } from "./extended.js";
import { keyframeLists, keyframeModeDecoder, rgbColor } from "./operation-parts.js";
import { v2Target } from "./plan-decoders.js";
import { shapePath } from "./shape-decoder.js";

function isShapeItemKind(name: string): name is ShapeItemKind {
  return Object.hasOwn(SHAPE_ITEMS, name);
}

const shapeItemKind = refine(string(), isShapeItemKind, "a shape item kind");
const maskValues = strictObject({
  path: optional(shapePath), opacity: optional(number()), feather: optional(tuple(number(), number())), expansion: optional(number()),
  mode: optional(literal("NONE", "ADD", "SUBTRACT", "INTERSECT", "LIGHTEN", "DARKEN", "DIFFERENCE")), inverted: optional(boolean()), rotoBezier: optional(boolean()),
});
const vectorShapeFill = strictObject({ color: rgbColor, opacity: optional(number()), rule: optional(literal("nonzero", "evenodd")) });
const vectorShapeStroke = strictObject({
  color: rgbColor, width: number(), opacity: optional(number()), cap: optional(literal("butt", "round", "square")), join: optional(literal("miter", "round", "bevel")), miterLimit: optional(number()),
});
const vectorShape = strictObject({ name: string(), paths: array(shapePath), fill: optional(vectorShapeFill), stroke: optional(vectorShapeStroke), opacity: optional(number()) });
const cameraOptions = strictObject({ zoom: optional(number()), depthOfField: optional(boolean()), focusDistance: optional(number()), aperture: optional(number()), blurLevel: optional(number()) });
const lightOptions = strictObject({
  intensity: optional(number()), color: optional(rgbColor), coneAngle: optional(number()), coneFeather: optional(number()), falloffType: optional(literal(1, 2, 3)), falloffStart: optional(number()),
  falloffDistance: optional(number()), castsShadows: optional(boolean()), shadowDarkness: optional(number()), shadowDiffusion: optional(number()),
});
const materialOptions = strictObject({
  acceptsShadows: optional(boolean()), castsShadows: optional(boolean()), lightTransmission: optional(number()), diffuse: optional(number()), specularIntensity: optional(number()),
  specularShininess: optional(number()), metal: optional(number()),
});

export const addMaskOperation = strictObject({ type: literal("add_mask"), target: v2Target, newMaskId: string(), name: string(), values: optional(maskValues) });
export const updateMaskOperation = strictObject({ type: literal("update_mask"), target: v2Target, maskId: string(), values: maskValues });
export const removeMaskOperation = strictObject({ type: literal("remove_mask"), target: v2Target, maskId: string(), destructive: literal(true) });
export const createShapeGroupOperation = strictObject({ type: literal("create_shape_group"), target: v2Target, newGroupId: string(), name: string() });
export const setShapePathOperation = strictObject({ type: literal("set_shape_path"), target: v2Target, groupId: string(), path: shapePath });
export const ensureShapeFillOperation = strictObject({ type: literal("ensure_shape_fill"), target: v2Target, groupId: string(), color: rgbColor, opacity: optional(number()) });
export const ensureShapeStrokeOperation = strictObject({ type: literal("ensure_shape_stroke"), target: v2Target, groupId: string(), color: rgbColor, width: number(), opacity: optional(number()) });
export const drawVectorShapesOperation = strictObject({ type: literal("draw_vector_shapes"), target: v2Target, shapes: array(vectorShape) });
export const setCameraOptionsOperation = strictObject({ type: literal("set_camera_options"), target: v2Target, options: cameraOptions });
export const setLightOptionsOperation = strictObject({ type: literal("set_light_options"), target: v2Target, options: lightOptions });
export const setMaterialOptionsOperation = strictObject({ type: literal("set_material_options"), target: v2Target, options: materialOptions });
export const addShapeItemOperation = strictObject({
  type: literal("add_shape_item"), target: v2Target, groupId: string(), item: shapeItemKind, newItemId: string(), name: optional(string()), values: optional(jsonObject),
  keyframes: optional(keyframeLists), keyframeMode: optional(keyframeModeDecoder),
});
export const updateShapeItemOperation = strictObject({
  type: literal("update_shape_item"), target: v2Target, groupId: string(), item: shapeItemKind, itemId: string(), values: optional(jsonObject), keyframes: optional(keyframeLists),
  keyframeMode: optional(keyframeModeDecoder),
});

export type MaskValues = Infer<typeof maskValues>;
export type MaskMode = NonNullable<MaskValues["mode"]>;
export type VectorShapeFill = Infer<typeof vectorShapeFill>;
export type VectorShapeStroke = Infer<typeof vectorShapeStroke>;
export type VectorShape = Infer<typeof vectorShape>;
export type AddMaskOperation = Infer<typeof addMaskOperation>;
export type UpdateMaskOperation = Infer<typeof updateMaskOperation>;
export type RemoveMaskOperation = Infer<typeof removeMaskOperation>;
export type CreateShapeGroupOperation = Infer<typeof createShapeGroupOperation>;
export type SetShapePathOperation = Infer<typeof setShapePathOperation>;
export type EnsureShapeFillOperation = Infer<typeof ensureShapeFillOperation>;
export type EnsureShapeStrokeOperation = Infer<typeof ensureShapeStrokeOperation>;
export type DrawVectorShapesOperation = Infer<typeof drawVectorShapesOperation>;
export type SetCameraOptionsOperation = Infer<typeof setCameraOptionsOperation>;
export type SetLightOptionsOperation = Infer<typeof setLightOptionsOperation>;
export type SetMaterialOptionsOperation = Infer<typeof setMaterialOptionsOperation>;
export type AddShapeItemOperation = Infer<typeof addShapeItemOperation>;
export type UpdateShapeItemOperation = Infer<typeof updateShapeItemOperation>;
