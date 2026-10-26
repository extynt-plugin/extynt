/** A bounded walk over every string in an untrusted value, so a hostile plan or tool argument costs a constant scan however large it is. */
import { isJsonArray } from "@extynt/decode";
import type { Opaque } from "./snapshot-view.js";

interface StringScanLimits { strings: number; depth: number; length: number }

/** Calls `visit` for each string in `root` (arrays and objects, breadth of the limits) that is short enough, until the string budget is spent. */
export function visitStrings(root: Opaque, limits: StringScanLimits, visit: (text: string) => void): void {
  let budget = limits.strings;
  const take = (text: string): void => {
    if (budget > 0 && text.length <= limits.length) { budget -= 1; visit(text); }
  };
  const walk = (value: Opaque, depth: number): void => {
    if (typeof value === "string") return take(value);
    if (depth >= limits.depth || !value || typeof value !== "object") return;
    for (const child of isJsonArray(value) ? value : Object.values(value)) walk(child, depth + 1);
  };
  walk(root, 0);
}
