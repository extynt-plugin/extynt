// Compilers for the shape, vector-shape, shape-item and mask kinds.
import { SHAPE_ITEMS, resolveSpecWrites, type AddShapeItemOperation, type UpdateShapeItemOperation, type VectorShape, type VectorShapeFill, type VectorShapeStroke } from "@extynt/action-plan";
import type { HostVectorShape } from "../host-shape-operations.js";
import { compilerTable, refuse, type HostOutcome } from "./compiler-table.js";
import { hostAnimations, hostWrites, layerRef } from "./host-values.js";

const FILL_RULES = { nonzero: 1, evenodd: 2 } as const;
const LINE_CAPS = { butt: 1, round: 2, square: 3 } as const;
const LINE_JOINS = { miter: 1, round: 2, bevel: 3 } as const;

function hostFill(fill: VectorShapeFill): NonNullable<HostVectorShape["fill"]> {
  return { color: fill.color, ...(fill.opacity === undefined ? {} : { opacity: fill.opacity }), ...(fill.rule === undefined ? {} : { rule: FILL_RULES[fill.rule] }) };
}

function hostStroke(stroke: VectorShapeStroke): NonNullable<HostVectorShape["stroke"]> {
  return {
    color: stroke.color, width: stroke.width,
    ...(stroke.opacity === undefined ? {} : { opacity: stroke.opacity }),
    ...(stroke.cap === undefined ? {} : { cap: LINE_CAPS[stroke.cap] }),
    ...(stroke.join === undefined ? {} : { join: LINE_JOINS[stroke.join] }),
    ...(stroke.miterLimit === undefined ? {} : { miterLimit: stroke.miterLimit }),
  };
}

function hostVectorShape(shape: VectorShape): HostVectorShape {
  return { name: shape.name, paths: shape.paths, ...(shape.fill ? { fill: hostFill(shape.fill) } : {}), ...(shape.stroke ? { stroke: hostStroke(shape.stroke) } : {}), ...(shape.opacity === undefined ? {} : { opacity: shape.opacity }) };
}

type ItemIdentity = { newItemId?: string; itemId?: string; name?: string };

function shapeItemOperation(operation: AddShapeItemOperation | UpdateShapeItemOperation, identity: ItemIdentity): HostOutcome {
  const spec = SHAPE_ITEMS[operation.item];
  const resolved = resolveSpecWrites(spec.settings, operation.values, operation.keyframes, operation.item);
  if (typeof resolved === "string") return refuse("INVALID_VALUE", resolved);
  return { operation: operation.type, ...layerRef(operation.target), groupId: operation.groupId, itemMatchName: spec.matchName, ...identity, writes: hostWrites(resolved.writes), animations: hostAnimations(resolved.animations, operation.keyframeMode) };
}

export const SHAPE_COMPILERS = compilerTable({
  create_shape_group: (operation) => ({ operation: "create_shape_group", ...layerRef(operation.target), newGroupId: operation.newGroupId, name: operation.name }),
  set_shape_path: (operation) => ({ operation: "set_shape_path", ...layerRef(operation.target), groupId: operation.groupId, path: operation.path }),
  ensure_shape_fill: (operation) => ({ operation: "ensure_shape_fill", ...layerRef(operation.target), groupId: operation.groupId, color: operation.color, opacity: operation.opacity }),
  ensure_shape_stroke: (operation) => ({ operation: "ensure_shape_stroke", ...layerRef(operation.target), groupId: operation.groupId, color: operation.color, width: operation.width, opacity: operation.opacity }),
  draw_vector_shapes: (operation) => ({ operation: "draw_vector_shapes", ...layerRef(operation.target), shapes: operation.shapes.map(hostVectorShape) }),
  add_shape_item: (operation) => shapeItemOperation(operation, { newItemId: operation.newItemId, ...(operation.name ? { name: operation.name } : {}) }),
  update_shape_item: (operation) => shapeItemOperation(operation, { itemId: operation.itemId }),
});

export const MASK_COMPILERS = compilerTable({
  add_mask: (operation) => ({ operation: "add_mask", ...layerRef(operation.target), newMaskId: operation.newMaskId, name: operation.name, values: operation.values }),
  update_mask: (operation) => ({ operation: "update_mask", ...layerRef(operation.target), maskId: operation.maskId, values: operation.values }),
  remove_mask: (operation) => ({ operation: "remove_mask", ...layerRef(operation.target), maskId: operation.maskId, destructive: true }),
});
