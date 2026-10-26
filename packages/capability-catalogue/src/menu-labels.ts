// Menu items as the agent reads them: `1 Normal, 2 Add`, bounded, 1-based, separator slots ("-") skipped but still numbered.
import type { JsonValue } from "@extynt/decode";

const MENU_BUDGET = 240;
const SEPARATOR = "-";

/** The label of a 1-based menu value, or undefined when the value is not a real item. */
export function menuLabel(menu: readonly string[] | undefined, value: JsonValue | undefined): string | undefined {
  if (!menu || typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > menu.length) return undefined;
  const label = menu[value - 1];
  return label === SEPARATOR ? undefined : label;
}

function itemIndexes(menu: readonly string[]): number[] {
  return menu.flatMap((label, index) => (label === SEPARATOR ? [] : [index]));
}

function defaultItemIndex(menu: readonly string[], defaultValue: JsonValue | undefined): number | undefined {
  return typeof defaultValue === "number" && menuLabel(menu, defaultValue) !== undefined ? defaultValue - 1 : undefined;
}

function shownIndexes(menu: readonly string[], items: readonly number[], defaultIndex: number | undefined): number[] {
  const shown: number[] = [];
  let used = 0;
  for (const index of items) {
    used += `${index + 1} ${menu[index]}, `.length;
    if (used > MENU_BUDGET) break;
    shown.push(index);
  }
  if (defaultIndex !== undefined && !shown.includes(defaultIndex)) shown.push(defaultIndex);
  return shown.sort((a, b) => a - b);
}

function joinShown(menu: readonly string[], shown: readonly number[], items: readonly number[]): string {
  const parts: string[] = [];
  shown.forEach((index, position) => {
    const previous = shown[position - 1];
    if (previous !== undefined && items.indexOf(index) - items.indexOf(previous) > 1) parts.push("...");
    parts.push(`${index + 1} ${menu[index]}`);
  });
  const last = shown[shown.length - 1];
  if (last !== undefined && last !== items[items.length - 1]) parts.push("...");
  return parts.join(", ");
}

/** Every real item as `3 Turbulent Smooth`, the value written first: a separator keeps its number but never appears, so the list cannot be counted wrong. */
export function numberedMenu(menu: readonly string[]): string[] {
  return itemIndexes(menu).map((index) => `${index + 1} ${menu[index]}`);
}

/** `1 Normal, 2 Add, ..., 25 Lighter Color (25 items)`: every item when it fits, else the leading run and the default item, with the count. */
export function menuChoices(menu: readonly string[], defaultValue?: JsonValue): string {
  const items = itemIndexes(menu);
  const shown = shownIndexes(menu, items, defaultItemIndex(menu, defaultValue));
  const text = joinShown(menu, shown, items);
  return shown.length < items.length ? `${text} (${items.length} items)` : text;
}

/** `default 3 (Add)` for a default that is a real item, else the raw JSON default, else nothing. */
export function menuDefaultText(menu: readonly string[], defaultValue: JsonValue | undefined): string {
  const label = menuLabel(menu, defaultValue);
  if (label !== undefined) return `, default ${String(defaultValue)} (${label})`;
  return defaultValue === undefined || defaultValue === null ? "" : `, default ${JSON.stringify(defaultValue)}`;
}
