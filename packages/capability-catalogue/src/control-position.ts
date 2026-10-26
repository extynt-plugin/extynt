// Where a numeric control's value sits in the range After Effects reports for it: pure arithmetic on observed numbers, with no names, lists or meaning.
import type { JsonValue } from "@extynt/decode";

/** Why a value has no position in its range. */
export type PositionReason =
  | "not-numeric-scalar" | "menu" | "value-not-finite" | "range-unobserved" | "range-unbounded" | "range-degenerate" | "range-invalid" | "value-outside-range";

/** `position` is (value - min) / (max - min) and `ofDefault` is value / default, both to 3 decimals; each is null where the range or default cannot carry it, with the `reason` the position is missing. */
export interface ControlPosition {
  position: number | null;
  ofDefault: number | null;
  reason: PositionReason | null;
}

/** The value bounds After Effects reports (Property.minValue/maxValue when hasMin/hasMax); the UI slider range is not exposed to scripts. */
export interface ReportedRange {
  minimum: number | null | undefined;
  maximum: number | null | undefined;
}

/** A control's value with its reported range; `valueType` is the native (`OneD`) or schema (`number`) name, and `menu` is true for a dropdown, whose index has no proportion. */
export interface PositionInput extends ReportedRange {
  valueType: string | null | undefined;
  value: JsonValue | undefined;
  defaultValue?: JsonValue | undefined;
  menu?: boolean;
}

const SCALAR_TYPES: ReadonlySet<string> = new Set(["OneD", "number"]);

function isFiniteNumber(value: JsonValue | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000 + 0;
}

function ratio(value: number, defaultValue: JsonValue | undefined): number | null {
  if (!isFiniteNumber(defaultValue) || defaultValue === 0) return null;
  const result = value / defaultValue;
  return Number.isFinite(result) ? round3(result) : null;
}

function missingBound(minimum: number | null | undefined, maximum: number | null | undefined): PositionReason {
  return isFiniteNumber(minimum) || isFiniteNumber(maximum) ? "range-unbounded" : "range-unobserved";
}

function rangeReason({ minimum, maximum }: ReportedRange, value: number): PositionReason | null {
  if (!isFiniteNumber(minimum) || !isFiniteNumber(maximum)) return missingBound(minimum, maximum);
  if (minimum > maximum) return "range-invalid";
  if (minimum === maximum) return "range-degenerate";
  return value < minimum || value > maximum ? "value-outside-range" : null;
}

function noPosition(reason: PositionReason): ControlPosition {
  return { position: null, ofDefault: null, reason };
}

/** The value's place in its range and against its default, or the reason it has none. */
export function controlPosition(input: PositionInput): ControlPosition {
  if (input.menu === true) return noPosition("menu");
  if (!input.valueType || !SCALAR_TYPES.has(input.valueType)) return noPosition("not-numeric-scalar");
  if (!isFiniteNumber(input.value)) return noPosition("value-not-finite");
  const ofDefault = ratio(input.value, input.defaultValue);
  const reason = rangeReason(input, input.value);
  const { minimum, maximum } = input;
  if (reason !== null || !isFiniteNumber(minimum) || !isFiniteNumber(maximum)) return { position: null, ofDefault, reason };
  return { position: round3((input.value - minimum) / (maximum - minimum)), ofDefault, reason: null };
}

/** "25 (12.5% of 0–200 px)": the value with its place in the reported range and the unit label After Effects gave; just the value when no position is known. */
export function describePositionedValue(valueText: string, result: ControlPosition, range: ReportedRange & { units?: string | null }): string {
  const { minimum, maximum } = range;
  if (result.position === null || !isFiniteNumber(minimum) || !isFiniteNumber(maximum)) return valueText;
  const percent = Math.round(result.position * 1000) / 10;
  const unit = range.units ? ` ${range.units}` : "";
  return `${valueText} (${percent}% of ${round3(minimum)}–${round3(maximum)}${unit})`;
}
