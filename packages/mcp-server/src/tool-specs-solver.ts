// The motion solvers: arc paths, staggers and keyframe assistants.
import { arrayArg, booleanArg, enumArg, freeObjectArg, jsonArg, numberArg, objectArg, optionalArg, stringArg } from "./arg.js";
import { defineTool } from "./tool.js";
import type { ToolEntry } from "./tool.js";

export const AE_SOLVE_ARC_PATH = defineTool("ae_solve_arc_path", {
  description: "Exact circular or elliptical arc motion: Position keys with Bézier spatial tangents, timed by a speed profile, plus optional Rotation facing along the path. Pass target for ready animate_property operations. Pixels in the layer's parent space (comp if unparented), y down. Required: center, sweep, startTime and duration, plus start or radius with startAngle. radiusY/axisRotation make an ellipse (parametric angles). To read an existing path, use ae_measure_layer.",
  input: {
    center: arrayArg(numberArg(), { minItems: 2, maxItems: 2, description: "Arc center [x, y] px." }),
    start: optionalArg(arrayArg(numberArg(), { minItems: 2, maxItems: 2, description: "Arc start [x, y]." })),
    radius: optionalArg(numberArg({ description: "Arc radius; only without start." })),
    startAngle: optionalArg(numberArg({ description: "Start angle, degrees." })),
    radiusY: optionalArg(numberArg({ description: "Ellipse y radius." })),
    axisRotation: optionalArg(numberArg({ description: "Ellipse tilt, degrees." })),
    sweep: numberArg({ description: "Degrees to travel; positive clockwise; |sweep| <= 3600." }),
    startTime: numberArg({ description: "Start time, seconds." }),
    duration: numberArg({ description: "Motion length, seconds." }),
    speed: optionalArg(enumArg(["constant", "accelerate", "decelerate", "ease-in-out"], { description: "How position changes over time." })),
    segments: optionalArg(numberArg({ description: "Keyframes minus one (1..64); each segment turns at most 90 degrees; default auto." })),
    orient: optionalArg(objectArg({
      forwardAngle: optionalArg(numberArg({ description: "Where artwork points at rotation 0: 0 right, 90 down." })),
    }, { description: "When present, solve Rotation to face the direction of travel.", open: true })),
    target: optionalArg(objectArg({
      compositionId: stringArg(),
      layerId: stringArg(),
    }, { description: "When given, return ready animate_property operations.", open: true })),
  },
});

export const AE_SOLVE_STAGGER = defineTool("ae_solve_stagger", {
  description: "Compute staggered start times: forward, reverse, center-out, edges-in or seeded random order, spread by step or over a total span, optionally eased. Pass layerIds to get per-layer starts back.",
  input: {
    count: optionalArg(numberArg({ description: "Number of items (1..1000); or pass layerIds." })),
    layerIds: optionalArg(arrayArg(stringArg({ minLength: 1 }), { description: "Layer IDs to stagger; count is derived from them." })),
    startTime: numberArg({ description: "When the first item starts, in seconds." }),
    step: optionalArg(numberArg({ description: "Seconds between starts; exactly one of step or total." })),
    total: optionalArg(numberArg({ description: "Seconds from first to last start; exactly one of step or total." })),
    order: optionalArg(enumArg(["forward", "reverse", "center-out", "edges-in", "random"], { description: "How to order the items." })),
    seed: optionalArg(numberArg({ description: "Seed for order=random (default 1)." })),
    curve: optionalArg(enumArg(["linear", "ease-in", "ease-out", "ease-in-out"], { description: "How start times spread within the span." })),
    itemDuration: optionalArg(numberArg({ description: "When given, compute end times too (seconds per item)." })),
  },
});

export const AE_SOLVE_KEYFRAME_ASSISTANT = defineTool("ae_solve_keyframe_assistant", {
  description: "Keyframe assistants computed instead of run: \"sequence-layers\" lays layers end to end (optional overlap) and returns set_layer_timing values; \"wiggle\" returns seeded random keys around a base value; \"smooth\" thins keyframes to the fewest within a tolerance. Pass target { compositionId, layerId } (and propertyPath for wiggle and smooth) for ready operations. Read layer times with ae_inspect_layer.",
  input: {
    assistant: enumArg(["sequence-layers", "wiggle", "smooth"]),
    target: optionalArg(freeObjectArg({ description: "{ compositionId, layerId }: returns ready operations. sequence-layers needs only compositionId." })),
    propertyPath: optionalArg(stringArg({ description: "wiggle and smooth: property to write, e.g. ADBE Transform Group/ADBE Position." })),
    layers: optionalArg(arrayArg(freeObjectArg(), { description: "sequence-layers: [{ layerId, inPoint, outPoint, startTime }] in play order." })),
    overlap: optionalArg(numberArg({ description: "sequence-layers: seconds each layer starts before the previous ends; negative = gap." })),
    reverse: optionalArg(booleanArg({ description: "sequence-layers: play the list back to front." })),
    startTime: optionalArg(numberArg({ description: "sequence-layers: first layer's in point; wiggle: start time." })),
    base: optionalArg(jsonArg("wiggle: the value to wiggle around, a number or [x, y(, z)].")),
    amplitude: optionalArg(jsonArg("wiggle: largest offset per component; one number applies to all.")),
    frequency: optionalArg(numberArg({ description: "wiggle: keys/second, 0.01-60." })),
    duration: optionalArg(numberArg({ description: "wiggle: seconds covered." })),
    seed: optionalArg(numberArg({ description: "wiggle: integer seed." })),
    settle: optionalArg(booleanArg({ description: "wiggle: first and last key sit on base." })),
    keyframes: optionalArg(arrayArg(freeObjectArg(), { description: "smooth: [{ time, value }] to thin." })),
    tolerance: optionalArg(numberArg({ description: "smooth: largest allowed distance from the original curve." })),
  },
});

/** The motion solvers: arc paths, staggers and keyframe assistants. */
export const SOLVER_TOOLS = [
  AE_SOLVE_ARC_PATH,
  AE_SOLVE_STAGGER,
  AE_SOLVE_KEYFRAME_ASSISTANT,
] satisfies ReadonlyArray<ToolEntry>;
