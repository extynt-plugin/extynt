// Wires the census's static "has an options dialog" flag into an inventory: the census consumer reads `optionsDialogScan` from the host_call result and flags each scanned effect.
import type { HostCallResult } from "./wire-calls.js";

/** The flag for every scanned effect, by matchName; empty when the plugin sent no scan (still running, or an older plugin). */
export function optionsDialogFlags(result: Pick<HostCallResult, "optionsDialogScan">): ReadonlyMap<string, boolean> {
  return new Map((result.optionsDialogScan ?? []).map((entry): [string, boolean] => [entry.matchName, entry.hasOptionsDialog]));
}

/**
 * Sets hasOptionsDialog on the items the scan covered and leaves the rest untouched, so an effect that was not scanned
 * (a built-in whose PiPL is inside the application, or a scan that has not finished) stays "unknown", never false.
 */
export function withOptionsDialogFlags<T extends { matchName: string }>(
  items: readonly T[],
  flags: ReadonlyMap<string, boolean>,
): Array<T & { hasOptionsDialog?: boolean }> {
  return items.map((item) => {
    const flag = flags.get(item.matchName);
    return flag === undefined ? item : { ...item, hasOptionsDialog: flag };
  });
}
