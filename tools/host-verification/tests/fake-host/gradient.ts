/** The gradient value a fake gradient property reads back, and the union of values a fake property can hold. */
import type { JsonArray } from "@extynt/decode";
import type { Json } from "./narrow.js";

/** A value a fake property holds: JSON, a gradient, or nothing. */
export type HostValue = Json | FakeGradient | undefined;

/** Whether a held value is a plain JSON array rather than a gradient or a scalar. */
export function isHostArray(value: HostValue): value is JsonArray {
  return Array.isArray(value);
}

/** One colour stop of a gradient. */
export interface ColorStop { color: number[]; position: number }

/** The gradient After Effects hands back from a gradient property: a copy per read, edited through stop methods. */
export class FakeGradient {
  type: number;
  colorStops: ColorStop[];
  constructor(type = 2, stops?: ColorStop[]) {
    this.type = type;
    this.colorStops = stops ?? [{ color: [0, 0, 0, 1], position: 0 }, { color: [1, 1, 1, 1], position: 1 }];
  }
  copy(): FakeGradient { return new FakeGradient(this.type, this.colorStops.map((stop) => ({ color: stop.color.slice(0), position: stop.position }))); }
  addColorStop(position: number, color: number[]): void {
    this.colorStops.push({ color: color.slice(0), position });
    this.colorStops.sort((left, right) => left.position - right.position);
  }
  removeColorStop(index: number): void {
    this.colorStops.splice(index, 1);
  }
  setColorStop(index: number, position: number, color: number[]): void {
    if (this.colorStops[index]) this.colorStops[index] = { color: color.slice(0), position };
  }
}
