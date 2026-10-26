// draw_vector_shapes: bounded vector shapes (at most 256 shapes, 64 paths each, 12000 points in all) drawn into one shape layer in a single step.
import type { JsonObject, JsonValue } from "@extynt/decode";
import type { ShapePath, V2TargetReference } from "./index.js";
import { isShapePath, validColor } from "./geometry-rules.js";
import { currentLayerTarget, observedLayer, plannedOrObservedLayer, type OperationContext } from "./layer-targets.js";
import { isJsonArray, isJsonObject } from "./json-shape.js";
import { invalid, isBoundedName, isFiniteInRange, isOneOf, isPositiveFiniteUpTo, isRefusal, rejectUnknown, type OperationResult, type Refusal } from "./validation-primitives.js";

const VECTOR_SHAPE_LIMITS = { maxShapes: 256, maxPathsPerShape: 64, maxVertices: 12_000 } as const;

type Field = JsonValue | undefined;
type Rule = readonly [(value: JsonObject) => boolean, string];
const optional = (key: string, check: (value: Field) => boolean) => (value: JsonObject): boolean => value[key] === undefined || check(value[key]);
const percent = (value: Field): boolean => isFiniteInRange(value, 0, 100);

const FILL_RULES: readonly Rule[] = [
  [(fill) => validColor(fill.color), "fill.color must be three channels from 0 to 1."],
  [optional("opacity", percent), "fill.opacity must be 0-100."],
  [optional("rule", (value) => isOneOf(value, ["nonzero", "evenodd"])), "fill.rule must be nonzero or evenodd."],
];

const STROKE_RULES: readonly Rule[] = [
  [(stroke) => validColor(stroke.color), "stroke.color must be three channels from 0 to 1."],
  [(stroke) => isPositiveFiniteUpTo(stroke.width, 10_000), "stroke.width must be greater than 0 and at most 10000."],
  [optional("opacity", percent), "stroke.opacity must be 0-100."],
  [optional("cap", (value) => isOneOf(value, ["butt", "round", "square"])), "stroke.cap must be butt, round or square."],
  [optional("join", (value) => isOneOf(value, ["miter", "round", "bevel"])), "stroke.join must be miter, round or bevel."],
  [optional("miterLimit", (value) => isFiniteInRange(value, 1, 100)), "stroke.miterLimit must be 1-100."],
];

const validPaths = (value: Field): boolean => isJsonArray(value) && value.length >= 1 && value.length <= VECTOR_SHAPE_LIMITS.maxPathsPerShape && value.every(isShapePath);

const SHAPE_RULES: readonly Rule[] = [
  [(shape) => isBoundedName(shape.name, 256), "name must be a non-empty name of at most 256 characters."],
  [(shape) => validPaths(shape.paths), `paths must be 1-${VECTOR_SHAPE_LIMITS.maxPathsPerShape} Shape DTOs ({vertices, inTangents?, outTangents?, closed}).`],
  [(shape) => shape.fill !== undefined || shape.stroke !== undefined, "needs a fill or a stroke; an unpainted shape draws nothing."],
  [optional("opacity", percent), "opacity must be 0-100."],
];

function ruleProblem(value: JsonObject, rules: readonly Rule[], at: string): Refusal | undefined {
  const failed = rules.find(([check]) => !check(value));
  return failed ? invalid("INVALID_VALUE", `${at}${failed[1]}`) : undefined;
}

function paintProblem(paint: Field, at: string, spec: { readonly keys: string[]; readonly rules: readonly Rule[]; readonly label: string }): Refusal | undefined {
  if (paint === undefined) return undefined;
  if (!isJsonObject(paint) || rejectUnknown(paint, spec.keys)) return invalid("INVALID_VALUE", `${at}${spec.label} must be an object with only ${spec.keys.join(", ")}.`);
  return ruleProblem(paint, spec.rules, at);
}

const FILL_SPEC = { keys: ["color", "opacity", "rule"], rules: FILL_RULES, label: "fill" };
const STROKE_SPEC = { keys: ["color", "width", "opacity", "cap", "join", "miterLimit"], rules: STROKE_RULES, label: "stroke" };

function shapeProblem(value: JsonValue, index: number): Refusal | undefined {
  const at = `shapes[${index}].`;
  if (!isJsonObject(value) || rejectUnknown(value, ["name", "paths", "fill", "stroke", "opacity"])) return invalid("INVALID_VALUE", `shapes[${index}] must be an object with only name, paths, fill, stroke and opacity.`);
  return ruleProblem(value, SHAPE_RULES, at) ?? paintProblem(value.fill, at, FILL_SPEC) ?? paintProblem(value.stroke, at, STROKE_SPEC);
}

function shapesOf(operation: OperationContext["operation"]): JsonValue[] | undefined {
  const shapes = operation.shapes;
  return isJsonArray(shapes) ? shapes : undefined;
}

function shapePaths(shape: JsonObject): ShapePath[] {
  const paths = shape.paths;
  return isJsonArray(paths) ? paths.flatMap((path) => (isShapePath(path) ? [path] : [])) : [];
}

function vertexTotal(shapes: readonly JsonValue[]): number {
  return shapes.filter(isJsonObject).flatMap(shapePaths).reduce((total, path) => total + path.vertices.length, 0);
}

function shapesProblem(shapes: readonly JsonValue[] | undefined): Refusal | undefined {
  if (!shapes || shapes.length < 1 || shapes.length > VECTOR_SHAPE_LIMITS.maxShapes) return invalid("INVALID_VALUE", `draw_vector_shapes requires 1-${VECTOR_SHAPE_LIMITS.maxShapes} shapes.`);
  for (const [index, shape] of shapes.entries()) {
    const problem = shapeProblem(shape, index);
    if (problem) return problem;
  }
  return vertexTotal(shapes) > VECTOR_SHAPE_LIMITS.maxVertices ? invalid("INVALID_VALUE", `draw_vector_shapes may draw at most ${VECTOR_SHAPE_LIMITS.maxVertices} path points in one step.`) : undefined;
}

function plannedLayerType(earlier: readonly JsonObject[], layerId: string): Field {
  const created = earlier.find((operation) => {
    const target = operation.target;
    return operation.type === "create_layer" && isJsonObject(target) && target.layerId === layerId;
  });
  return created?.layerType;
}

function shapeLayerProblem(context: OperationContext, target: V2TargetReference): Refusal | undefined {
  const observed = observedLayer(context.snapshot, target);
  const type = observed ? observed.type : plannedLayerType(context.earlier.filter(isJsonObject), target.layerId);
  return type === undefined || type === "shape" ? undefined : invalid("INVALID_TARGET", "draw_vector_shapes draws into a shape layer; create one with create_layer layerType shape.");
}

function targetProblem(context: OperationContext): Refusal | undefined {
  const target = currentLayerTarget(context.operation, context.plan, true, "draw_vector_shapes requires an exact layer target without property paths.");
  if (isRefusal(target)) return target;
  return plannedOrObservedLayer(context, target, "The shape layer must exist or be created earlier in this plan.") ?? shapeLayerProblem(context, target);
}

/** Validates a draw_vector_shapes operation: an exact shape-layer target and 1-256 shapes, each with a fill or stroke and 1-64 paths, within 12000 points in total. */
export function validateVectorShapes(context: OperationContext): OperationResult {
  const problem = rejectUnknown(context.operation, ["type", "target", "shapes"]) ?? targetProblem(context) ?? shapesProblem(shapesOf(context.operation));
  return problem ?? { ok: true, keyframes: 0 };
}
