// data-repeat on a top-level group (or shape) becomes a real After Effects shape Repeater on its layer,
// so rings, spokes and dots are drawn once and copied by the host instead of drawn N times.
import { numbersIn, strokeScale, type Matrix, type Point } from "./transform.js";
import type { SvgElement } from "./xml.js";

/** One Repeater, in the layer's own units: Position in composition pixels, Scale and opacities in percent, Rotation in degrees. */
export interface SceneLayerRepeat {
  readonly copies: number;
  readonly position: Point;
  readonly scale?: Point;
  readonly rotation?: number;
  readonly startOpacity?: number;
  readonly endOpacity?: number;
}

/** The copy counts a Repeater accepts. */
export const REPEAT_LIMITS = { minCopies: 2, maxCopies: 500 } as const;

const round = (value: number): number => Math.round(value * 1000) / 1000 || 0;

interface Offset { translate: Point; rotate: number; scale: Point }

const OFFSET_TERMS: ReadonlyMap<string, (offset: Offset, values: readonly number[]) => void> = new Map([
  ["translate", (offset: Offset, values: readonly number[]) => { offset.translate = [offset.translate[0] + (values[0] ?? 0), offset.translate[1] + (values[1] ?? 0)]; }],
  ["rotate", (offset: Offset, values: readonly number[]) => { offset.rotate += values[0] ?? 0; }],
  ["scale", (offset: Offset, values: readonly number[]) => { offset.scale = [offset.scale[0] * (values[0] ?? 1), offset.scale[1] * (values[1] ?? values[0] ?? 1)]; }],
]);

function parseOffset(text: string): Offset | undefined {
  const offset: Offset = { translate: [0, 0], rotate: 0, scale: [1, 1] };
  const rest = text.replace(/([a-zA-Z]+)\s*\(([^)]*)\)/gu, (_whole, kind: string, args: string) => {
    const term = OFFSET_TERMS.get(kind.toLowerCase());
    if (term) term(offset, numbersIn(args));
    else offset.rotate = Number.NaN;
    return "";
  });
  const valid = rest.trim() === "" && Number.isFinite(offset.rotate) && [...offset.translate, ...offset.scale].every(Number.isFinite);
  return valid ? offset : undefined;
}

/** An opacity pair or single value: fractions when every value is at most 1 (the SVG opacity convention), otherwise percent; returned in percent. */
export function parseOpacityValues(text: string): number[] | undefined {
  const values = text.trim().split(/[\s,]+/u).map(Number);
  if (!values.length || values.length > 2 || !values.every((value) => Number.isFinite(value) && value >= 0 && value <= 100)) return undefined;
  return values.every((value) => value <= 1) ? values.map((value) => round(value * 100)) : values;
}

interface RepeatOpacity { start?: number; end?: number }

function parseOpacity(text: string): RepeatOpacity | undefined {
  const values = parseOpacityValues(text);
  if (!values) return undefined;
  const [first = 0, second] = values;
  return second === undefined ? { end: first } : { start: first, end: second };
}

/** Receives a warning message for the design's author. */
export type Warn = (message: string) => void;

function repeatCopies(element: SvgElement, name: string, warn: Warn): number | undefined {
  const countText = element.attributes["data-repeat"];
  if (countText === undefined) return undefined;
  const copies = Number(countText.trim());
  if (Number.isInteger(copies) && copies >= REPEAT_LIMITS.minCopies && copies <= REPEAT_LIMITS.maxCopies) return copies;
  warn(`"${name}": data-repeat "${countText}" is not a whole number of copies from ${REPEAT_LIMITS.minCopies} to ${REPEAT_LIMITS.maxCopies}; no Repeater was added.`);
  return undefined;
}

function repeatOffset(element: SvgElement, name: string, warn: Warn): Offset | undefined {
  const offsetText = element.attributes["data-repeat-offset"];
  const offset = offsetText === undefined ? undefined : parseOffset(offsetText);
  if (offset) return offset;
  warn(offsetText === undefined
    ? `"${name}": data-repeat needs data-repeat-offset="translate(x y) rotate(a) scale(s)", otherwise every copy lands on the original; no Repeater was added.`
    : `"${name}": data-repeat-offset "${offsetText}" is not a list of translate(x y), rotate(a) and scale(s); no Repeater was added.`);
  return undefined;
}

function repeatOpacity(element: SvgElement, name: string, warn: Warn): RepeatOpacity | undefined {
  const opacityText = element.attributes["data-repeat-opacity"];
  const opacity = opacityText === undefined ? undefined : parseOpacity(opacityText);
  if (opacityText !== undefined && !opacity) warn(`"${name}": data-repeat-opacity "${opacityText}" is not "start end" percentages from 0 to 100 (or fractions from 0 to 1); the copies keep full opacity.`);
  return opacity;
}

interface RepeatStep { position: Point; scale: Point; rotation: number }

function repeatStep(offset: Offset, rootMatrix: Matrix, name: string, warn: Warn): RepeatStep | undefined {
  const unit = strokeScale(rootMatrix);
  const position: Point = [round(offset.translate[0] * unit), round(offset.translate[1] * unit)];
  const scale: Point = [round(offset.scale[0] * 100), round(offset.scale[1] * 100)];
  const rotation = round(offset.rotate);
  if (position[0] === 0 && position[1] === 0 && rotation === 0 && scale[0] === 100 && scale[1] === 100) {
    warn(`"${name}": data-repeat-offset changes nothing, so every copy would sit on the original; no Repeater was added.`);
    return undefined;
  }
  return { position, scale, rotation };
}

function repeaterOf(copies: number, step: RepeatStep, opacity: RepeatOpacity | undefined): SceneLayerRepeat {
  const { position, scale, rotation } = step;
  return {
    copies, position,
    ...(scale[0] !== 100 || scale[1] !== 100 ? { scale } : {}),
    ...(rotation !== 0 ? { rotation } : {}),
    ...(opacity?.start !== undefined ? { startOpacity: opacity.start } : {}),
    ...(opacity?.end !== undefined ? { endOpacity: opacity.end } : {}),
  };
}

/** The layer's Repeater, or undefined (with a warning when the attributes were present but unusable). */
export function layerRepeat(element: SvgElement, rootMatrix: Matrix, name: string, warn: Warn): SceneLayerRepeat | undefined {
  const copies = repeatCopies(element, name, warn);
  const offset = copies === undefined ? undefined : repeatOffset(element, name, warn);
  const step = copies === undefined || !offset ? undefined : repeatStep(offset, rootMatrix, name, warn);
  if (copies === undefined || !step) return undefined;
  return repeaterOf(copies, step, repeatOpacity(element, name, warn));
}

const DOT_ROW_MIN_COPIES = 20;

function translateOnly(text: string | undefined): Offset | undefined {
  const offset = text === undefined ? undefined : parseOffset(text);
  return offset && offset.rotate === 0 && offset.scale[0] === 1 && offset.scale[1] === 1 ? offset : undefined;
}

/** A translate-only data-repeat of at least 20 copies: the shape of a scattered field drawn as a row. */
export function dotRow(element: SvgElement): { copies: number; opacity?: number[] } | undefined {
  const copies = Number(element.attributes["data-repeat"]?.trim());
  const manyCopies = Number.isInteger(copies) && copies >= DOT_ROW_MIN_COPIES && copies <= REPEAT_LIMITS.maxCopies;
  if (!manyCopies || !translateOnly(element.attributes["data-repeat-offset"])) return undefined;
  const opacityText = element.attributes["data-repeat-opacity"];
  const opacity = opacityText === undefined ? undefined : parseOpacityValues(opacityText);
  return { copies, ...(opacity ? { opacity } : {}) };
}
