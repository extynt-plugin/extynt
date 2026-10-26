// The engine behind every verdict that compares named property rows of a layer with requested values: the first row that is absent, unread or different.
import type { JsonObject } from "@extynt/decode";
import { COMPARISONS } from "./compare-values.js";
import type { ComparisonName, Reading } from "./compare-values.js";
import type { SnapshotLayer } from "./snapshot-reply.js";
import { propertyOf } from "./verify-context.js";

/** One property row of a layer and the value it should hold. */
export interface Slot {
  readonly key: string;
  readonly path: string;
  readonly expected: Reading;
  readonly compare: ComparisonName;
  readonly fallback?: Reading;
  readonly unreadWhenNull?: boolean;
}

type SlotFault = "missing" | "unread" | "mismatch";

/** The first slot that does not confirm, with the value found there. */
export interface SlotFinding {
  readonly slot: Slot;
  readonly observed: Reading;
  readonly fault: SlotFault;
}

function faultOf(slot: Slot, found: boolean, observed: Reading): SlotFault | null {
  if (!found && observed === undefined) return "missing";
  if (slot.unreadWhenNull === true && (observed === undefined || observed === null)) return "unread";
  return COMPARISONS[slot.compare](observed, slot.expected) ? null : "mismatch";
}

/** The first slot of the layer that is missing, unread or different from its expected value; null when every slot confirms. */
export function firstFault(layer: SnapshotLayer, slots: ReadonlyArray<Slot>): SlotFinding | null {
  for (const slot of slots) {
    const property = propertyOf(layer, slot.path);
    const observed = property ? property.value : slot.fallback;
    const fault = faultOf(slot, property !== null, observed);
    if (fault) return { slot, observed, fault };
  }
  return null;
}

/** One slot per requested option, found under `prefix` by the table that names each option's row. */
export function optionSlots(options: JsonObject | undefined, rows: { readonly prefix: string; readonly paths: Readonly<Record<string, string>> }, compare: ComparisonName): ReadonlyArray<Slot> {
  return Object.entries(options ?? {}).map(([key, expected]) => ({ key, path: rows.prefix + (rows.paths[key] ?? ""), expected, compare }));
}
