// Narrowing guards for values that crossed a process boundary: each turns "could be anything" into an exact type or says no.

/** Any value JSON can carry, plus the absent value. */
export type WireValue = string | number | boolean | null | undefined | readonly WireValue[] | WireObject;

/** A JSON object whose members are not yet checked. */
export interface WireObject {
  readonly [key: string]: WireValue;
}

/** True for a non-null object that is not a list. */
export function isWireObject(value: WireValue): value is WireObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True for a list, whose members are not yet checked. */
export function isWireList(value: WireValue): value is readonly WireValue[] {
  return Array.isArray(value);
}

/** True for a list with between `min` and `max` members. */
export function isListOfSize(value: WireValue, bounds: { readonly min: number; readonly max: number }): value is readonly WireValue[] {
  return isWireList(value) && value.length >= bounds.min && value.length <= bounds.max;
}

/** True for a number that is neither NaN nor infinite. */
export function isFiniteNumber(value: WireValue): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** True for a whole number. */
export function isInteger(value: WireValue): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

/** True for a finite number from 0 to 1. */
export function isUnit(value: WireValue): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 1;
}

/** True for a whole number from 0 to 255. */
export function isChannel(value: WireValue): value is number {
  return isInteger(value) && value >= 0 && value <= 255;
}

/** True for a finite number from 0 to 255, such as a mean luminance. */
export function isLuma(value: WireValue): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 255;
}

/** True for `#rrggbb`; hex digits are case-insensitive, as in CSS. */
export function isHexColor(value: WireValue): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}
