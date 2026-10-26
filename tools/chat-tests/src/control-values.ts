/** Whether the plan wrote each effect control the value the prompt asked for, read from the operations the store recalls whole. */
import { array, decodeJson } from "@extynt/decode";
import { isWireArray, isWireObject, wireValue } from "@extynt/fake-plugin";
import { memberOf, stringMember } from "./wire-reads.js";
import type { WireObject, WireValue } from "./wire-types.js";

const TOLERANCE = 1e-6;
const pageOf = array(wireValue);

function operationsOf(page: string): ReadonlyArray<WireValue> {
  const decoded = decodeJson(page, pageOf);
  return decoded.ok ? decoded.value : [];
}

function controlOf(operation: WireObject): string | undefined {
  const target = memberOf(operation, "target");
  const path = (isWireObject(target) ? stringMember(target, "propertyPath") : undefined) ?? stringMember(operation, "propertyPath");
  return path?.split("/").at(-1)?.replace(/#\d+$/, "");
}

/** The last value each control is set to across the plans, the one After Effects is left holding. */
export function writtenControlValues(pages: readonly string[]): Map<string, WireValue> {
  const written = new Map<string, WireValue>();
  for (const operation of pages.flatMap(operationsOf)) {
    if (!isWireObject(operation) || operation.type !== "set_effect_control" || !("value" in operation)) continue;
    const control = controlOf(operation);
    const value = operation.value;
    if (control && value !== undefined) written.set(control, value);
  }
  return written;
}

function sameValue(actual: WireValue | undefined, wanted: WireValue): boolean {
  if (typeof wanted === "number") return typeof actual === "number" && Math.abs(actual - wanted) <= TOLERANCE * Math.max(1, Math.abs(wanted));
  if (isWireArray(wanted)) return isWireArray(actual) && actual.length === wanted.length && wanted.every((item, index) => sameValue(actual[index], item));
  return actual === wanted;
}

/** One failure per control that was never written, or was written a different value. */
export function controlValueFailures(pages: readonly string[] | undefined, wanted: Readonly<Record<string, WireValue>> | undefined): string[] {
  if (!wanted) return [];
  const written = writtenControlValues(pages ?? []);
  return Object.entries(wanted).flatMap(([control, value]) => {
    if (!written.has(control)) return [`no operation set ${control}`];
    const actual = written.get(control);
    return sameValue(actual, value) ? [] : [`${control} was set to ${JSON.stringify(actual)}, expected ${JSON.stringify(value)}`];
  });
}
