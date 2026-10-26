// Parses SVG path data (the d attribute) into the converter's subpaths, expanding relative commands, arcs and quadratics into lines and cubics.
import { arcToCubics } from "./svg-arc.js";
import { closeSubpath, curveTo, lineTo, startSubpath, type Subpath } from "./svg-subpath.js";
import type { Point } from "./svg-convert-types.js";

type CurveKind = "C" | "Q";
type Handler = (state: PathState, args: readonly number[]) => void;

interface Reflection {
  kind: CurveKind;
  point: Point;
}

interface PathState {
  subpaths: Subpath[];
  current: Subpath | undefined;
  at: Point;
  start: Point;
  reflect: Reflection | undefined;
}

interface Cubic {
  c1: Point;
  c2: Point;
  to: Point;
}

const ARG_COUNT: ReadonlyMap<string, number> = new Map([["M", 2], ["L", 2], ["H", 1], ["V", 1], ["C", 6], ["S", 4], ["Q", 4], ["T", 2], ["A", 7], ["Z", 0]]);
const AXES: ReadonlyMap<string, string> = new Map([["M", "xy"], ["L", "xy"], ["H", "x"], ["V", "y"], ["C", "xyxyxy"], ["S", "xyxy"], ["Q", "xyxy"], ["T", "xy"], ["A", "----xy"]]);
const REPEATED_MOVETO = new Map([["M", "L"], ["m", "l"]]);
const COMMAND_LETTER = /[AaCcHhLlMmQqSsTtVvZz]/u;
const NUMBER = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/uy;
const SEPARATOR = /[\s,]*/uy;
const ARC_FLAG_INDEXES = [3, 4];

class Reader {
  public pos = 0;

  public constructor(public readonly text: string) {}

  public skip(): void {
    SEPARATOR.lastIndex = this.pos;
    SEPARATOR.exec(this.text);
    this.pos = SEPARATOR.lastIndex;
  }

  public atEnd(): boolean {
    this.skip();
    return this.pos >= this.text.length;
  }

  public peek(): string {
    return this.text.charAt(this.pos);
  }

  public number(): number | undefined {
    this.skip();
    NUMBER.lastIndex = this.pos;
    const match = NUMBER.exec(this.text);
    if (!match) return undefined;
    this.pos = NUMBER.lastIndex;
    return Number(match[0]);
  }

  public flag(): number | undefined {
    this.skip();
    const char = this.peek();
    if (char !== "0" && char !== "1") return undefined;
    this.pos += 1;
    return Number(char);
  }
}

function readArguments(reader: Reader, command: string): number[] | undefined {
  const args: number[] = [];
  for (let index = 0; index < (ARG_COUNT.get(command) ?? 0); index += 1) {
    const isFlag = command === "A" && ARC_FLAG_INDEXES.includes(index);
    const value = isFlag ? reader.flag() : reader.number();
    if (value === undefined) return undefined;
    args.push(value);
  }
  return args;
}

function toAbsolute(command: string, args: readonly number[], at: Point): number[] {
  const axes = AXES.get(command) ?? "";
  return args.map((value, index) => {
    const axis = axes.charAt(index);
    return axis === "x" ? value + at[0] : axis === "y" ? value + at[1] : value;
  });
}

function pointAt(args: readonly number[], index: number): Point {
  return [args[index] ?? 0, args[index + 1] ?? 0];
}

function ensureSubpath(state: PathState): Subpath {
  if (state.current && !state.current.closed) return state.current;
  const sub = startSubpath(state.at);
  state.subpaths.push(sub);
  state.current = sub;
  return sub;
}

function lineCommand(state: PathState, to: Point): void {
  lineTo(ensureSubpath(state), to);
  state.at = to;
  state.reflect = undefined;
}

function cubicCommand(state: PathState, cubic: Cubic, reflect: Reflection | undefined): void {
  curveTo(ensureSubpath(state), cubic.c1, cubic.c2, cubic.to);
  state.at = cubic.to;
  state.reflect = reflect;
}

function reflected(state: PathState, kind: CurveKind): Point {
  const previous = state.reflect;
  return previous?.kind === kind ? [2 * state.at[0] - previous.point[0], 2 * state.at[1] - previous.point[1]] : state.at;
}

function quadraticCommand(state: PathState, control: Point, to: Point): void {
  const from = state.at;
  const c1: Point = [from[0] + (2 / 3) * (control[0] - from[0]), from[1] + (2 / 3) * (control[1] - from[1])];
  const c2: Point = [to[0] + (2 / 3) * (control[0] - to[0]), to[1] + (2 / 3) * (control[1] - to[1])];
  cubicCommand(state, { c1, c2, to }, { kind: "Q", point: control });
}

function arcCommand(state: PathState, args: readonly number[]): void {
  const segments = arcToCubics({ from: state.at, to: pointAt(args, 5), rx: args[0] ?? 0, ry: args[1] ?? 0, rotation: args[2] ?? 0, large: args[3] === 1, sweep: args[4] === 1 });
  for (const [c1, c2, to] of segments) cubicCommand(state, { c1, c2, to }, { kind: "C", point: c2 });
  if (segments.length > 0) state.reflect = undefined;
}

function moveCommand(state: PathState, to: Point): void {
  const sub = startSubpath(to);
  state.subpaths.push(sub);
  state.current = sub;
  state.at = to;
  state.start = to;
  state.reflect = undefined;
}

function closeCommand(state: PathState): void {
  if (state.current && !state.current.closed) closeSubpath(state.current);
  state.at = state.start;
  state.reflect = undefined;
}

function smoothCubicCommand(state: PathState, args: readonly number[]): void {
  const c2 = pointAt(args, 0);
  cubicCommand(state, { c1: reflected(state, "C"), c2, to: pointAt(args, 2) }, { kind: "C", point: c2 });
}

function cubicArgsCommand(state: PathState, args: readonly number[]): void {
  const c2 = pointAt(args, 2);
  cubicCommand(state, { c1: pointAt(args, 0), c2, to: pointAt(args, 4) }, { kind: "C", point: c2 });
}

const HANDLERS: ReadonlyMap<string, Handler> = new Map<string, Handler>([
  ["M", (state, args) => moveCommand(state, pointAt(args, 0))],
  ["L", (state, args) => lineCommand(state, pointAt(args, 0))],
  ["H", (state, args) => lineCommand(state, [args[0] ?? 0, state.at[1]])],
  ["V", (state, args) => lineCommand(state, [state.at[0], args[0] ?? 0])],
  ["C", cubicArgsCommand],
  ["S", smoothCubicCommand],
  ["Q", (state, args) => quadraticCommand(state, pointAt(args, 0), pointAt(args, 2))],
  ["T", (state, args) => quadraticCommand(state, reflected(state, "Q"), pointAt(args, 0))],
  ["A", arcCommand],
  ["Z", closeCommand],
]);

function runCommand(state: PathState, command: string, args: readonly number[]): void {
  const upper = command.toUpperCase();
  HANDLERS.get(upper)?.(state, command === upper ? args : toAbsolute(upper, args, state.at));
}

function nextCommand(reader: Reader, previous: string | undefined): string | undefined {
  const letter = reader.peek();
  if (COMMAND_LETTER.test(letter)) {
    reader.pos += 1;
    return letter;
  }
  if (!previous || previous === "z" || previous === "Z") return undefined;
  return REPEATED_MOVETO.get(previous) ?? previous;
}

function readSegment(reader: Reader, state: PathState, previous: string | undefined): string | undefined {
  const command = nextCommand(reader, previous);
  if (!command) return undefined;
  const args = readArguments(reader, command.toUpperCase());
  const opens = command === "M" || command === "m" || previous !== undefined;
  if (!args || !opens) return undefined;
  runCommand(state, command, args);
  return command;
}

/** Path data as subpaths. A syntax error keeps everything before it, as an SVG renderer does, and is reported as malformed. */
export function parsePathData(data: string): { subpaths: Subpath[]; malformed: boolean } {
  const state: PathState = { subpaths: [], current: undefined, at: [0, 0], start: [0, 0], reflect: undefined };
  const reader = new Reader(data);
  let previous: string | undefined;
  let malformed = false;
  while (!reader.atEnd()) {
    const command = readSegment(reader, state, previous);
    if (!command) {
      malformed = true;
      break;
    }
    previous = command;
  }
  return { subpaths: state.subpaths.filter((sub) => sub.nodes.length > 1), malformed };
}
