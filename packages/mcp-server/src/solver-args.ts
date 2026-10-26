// Turns the decoded arguments of the solver tools into the solvers' inputs; what the spec cannot say (a point has two numbers) is refused here by name.
import type { Infer, JsonValue } from "@extynt/decode";
import { stringAt } from "./json.js";
import { isJsonArray } from "@extynt/decode";
import type { CircleArgs } from "./solvers/arc-validation.js";
import type { SequenceInput, SmoothInput, WiggleInput } from "./solvers/assistants.js";
import type { ArcPathInput } from "./solvers/path.js";
import type { StaggerInput } from "./solvers/stagger.js";
import type { Vec2 } from "./solvers/types.js";
import { AE_SOLVE_ARC_PATH, AE_SOLVE_KEYFRAME_ASSISTANT, AE_SOLVE_STAGGER } from "./tool-specs-solver.js";

/** What ae_solve_arc_path is given. */
export type ArcPathArgs = Infer<typeof AE_SOLVE_ARC_PATH.input.decoder>;

/** What ae_solve_stagger is given. */
export type StaggerArgs = Infer<typeof AE_SOLVE_STAGGER.input.decoder>;

/** What ae_solve_keyframe_assistant is given. */
export type AssistantArgs = Infer<typeof AE_SOLVE_KEYFRAME_ASSISTANT.input.decoder>;

function present<V>(key: string, value: V | undefined): { readonly [field: string]: V } {
  return value === undefined ? {} : { [key]: value };
}

function pointOf(value: ReadonlyArray<number>, name: string): Vec2 | string {
  return value.length === 2 ? [value[0] ?? 0, value[1] ?? 0] : `${name} must be a 2-element array`;
}

function circleOf(args: ArcPathArgs): CircleArgs | string {
  const center = pointOf(args.center, "center");
  if (typeof center === "string") return center;
  const start = args.start === undefined ? undefined : pointOf(args.start, "start");
  if (typeof start === "string") return start;
  return { center, ...present("start", start), ...present("radius", args.radius), ...present("startAngle", args.startAngle) };
}

/** The arc-path solver's input from the tool arguments, or the message naming the argument that cannot be used. */
export function arcPathInput(args: ArcPathArgs): ArcPathInput | string {
  const circle = circleOf(args);
  if (typeof circle === "string") return circle;
  const orient = args.orient === undefined ? undefined : { ...present("forwardAngle", args.orient.forwardAngle) };
  return { ...circle, sweep: args.sweep, startTime: args.startTime, duration: args.duration, ...present("segments", args.segments), ...present("speed", args.speed), ...present("orient", orient) };
}

/** The stagger solver's input from the tool arguments and the item count. */
export function staggerInput(args: StaggerArgs, count: number): StaggerInput {
  return {
    count, startTime: args.startTime, ...present("step", args.step), ...present("total", args.total),
    ...present("order", args.order), ...present("curve", args.curve), ...present("seed", args.seed), ...present("itemDuration", args.itemDuration),
  };
}

function numberOrNaN(value: JsonValue | undefined): number {
  return typeof value === "number" ? value : Number.NaN;
}

function keyValueOf(value: JsonValue | undefined): WiggleInput["base"] {
  return isJsonArray(value) ? value.map(numberOrNaN) : numberOrNaN(value);
}

/** The sequence-layers input from the tool arguments; a field of a layer that is not a number becomes one the solver's own range checks refuse. */
export function sequenceInput(args: AssistantArgs): SequenceInput {
  const layers = (args.layers ?? []).map((layer): SequenceInput["layers"][number] => ({
    layerId: stringAt(layer, "layerId") ?? "", inPoint: numberOrNaN(layer.inPoint), outPoint: numberOrNaN(layer.outPoint), startTime: numberOrNaN(layer.startTime),
  }));
  return { layers, ...present("overlap", args.overlap), ...present("startTime", args.startTime), reverse: args.reverse ?? false };
}

/** The wiggle input from the tool arguments; a field that is absent or not a number becomes one the solver's own range checks refuse. */
export function wiggleInput(args: AssistantArgs): WiggleInput {
  return {
    base: keyValueOf(args.base), amplitude: keyValueOf(args.amplitude),
    frequency: args.frequency ?? Number.NaN, startTime: args.startTime ?? Number.NaN, duration: args.duration ?? Number.NaN,
    ...present("seed", args.seed), settle: args.settle ?? false,
  };
}

/** The smooth input from the tool arguments; a field that is absent or not a number becomes one the solver's own range checks refuse. */
export function smoothInput(args: AssistantArgs): SmoothInput {
  const keyframes = (args.keyframes ?? []).map((key): SmoothInput["keyframes"][number] => ({ time: numberOrNaN(key.time), value: keyValueOf(key.value) }));
  return { keyframes, tolerance: args.tolerance ?? Number.NaN };
}
