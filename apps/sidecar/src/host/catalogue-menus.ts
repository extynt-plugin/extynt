// Popup menu labels for the catalogue probe. A probe page run with `hold` leaves the effects that look like they have a menu
// applied in the scratch composition; the native plugin then reads each popup's item text, and a cleanup page removes the effects.
// Everything here is read from the user's own After Effects at run time; nothing is shipped.
import type { JsonObject, JsonValue } from "@extynt/decode";
import { decode, literal, object, string } from "@extynt/decode";
import { parseEffectMenusResult } from "@extynt/host-native";
import type { CallOutcome, EffectMenusResult, HostCallResult, PluginClient } from "@extynt/host-native";
import { listOf, objectOf } from "../verify/json-fields.js";

/** Where the page left its effects: the scratch composition and layer, as the host reported them. */
export interface HeldEffects { compId: string; layerId: string }
type Popups = ReadonlyMap<string, readonly string[]>;
type LabelledPage = { page: JsonObject; labelled: number };

const MAX_ITEMS = 64;
const MAX_LABEL = 80;
const heldPage = object({ ok: literal(true), held: object({ compId: string({ nonEmpty: true }), layerId: string({ nonEmpty: true }) }) });

/** The effects the page left in the scratch composition; null when the page is not a successful one that holds effects. */
export function heldOf(page: JsonObject): HeldEffects | null {
  const decoded = decode(heldPage, page);
  return decoded.ok ? decoded.value.held : null;
}

function takesLabels(row: JsonObject, count: number): boolean {
  if (row.kind !== "property" || (listOf(row.items)?.length ?? 0) > 0) return false;
  return row.hasMin === true && row.min === 1 && row.hasMax === true && row.max === count;
}

function labelRow(row: JsonValue, popups: Popups): JsonValue {
  const fields = objectOf(row);
  if (!fields) return row;
  const items = typeof fields.matchName === "string" ? popups.get(fields.matchName) : undefined;
  const labelled = items && takesLabels(fields, items.length) ? { ...fields, items: items.map((item) => item.slice(0, MAX_LABEL)), isDropdown: true } : fields;
  const children = labelRows(fields.children, popups);
  return children === undefined ? labelled : { ...labelled, children };
}

function labelRows(rows: JsonValue | undefined, popups: Popups): JsonValue | undefined {
  const list = listOf(rows);
  return list ? list.map((row) => labelRow(row, popups)) : rows;
}

function usablePopups(effect: EffectMenusResult["effects"][number]): Map<string, string[]> {
  const popups = new Map<string, string[]>();
  for (const popup of effect.popups) {
    if (popup.consistent && popup.items.length === popup.choices && popup.items.length >= 1 && popup.items.length <= MAX_ITEMS) popups.set(popup.matchName, popup.items);
  }
  return popups;
}

function labelResult(result: JsonValue, menus: EffectMenusResult): { result: JsonValue; labelled: number } {
  const row = objectOf(result), effect = row ? menus.effects.find((candidate) => candidate.matchName === row.matchName) : undefined;
  const popups = effect ? usablePopups(effect) : undefined;
  if (!row || !popups || popups.size === 0) return { result, labelled: 0 };
  const controls = labelRows(row.controls, popups);
  return { result: controls === undefined ? row : { ...row, controls }, labelled: popups.size };
}

/** The page with the native labels attached to the control rows of its results, and how many popups were labelled; only the rows on the way to a label are copied. */
export function mergeMenus(page: JsonObject, menus: EffectMenusResult): LabelledPage {
  const results = listOf(page.results);
  if (!results) return { page, labelled: 0 };
  const labelledResults = results.map((result) => labelResult(result, menus)), labelled = labelledResults.reduce((total, entry) => total + entry.labelled, 0);
  return labelled === 0 ? { page, labelled } : { page: { ...page, results: labelledResults.map((entry) => entry.result) }, labelled };
}

/** The popup menus of the effects the page holds, read natively; null when the plugin did not answer with a menu listing. */
export async function readMenus(client: PluginClient, held: HeldEffects): Promise<EffectMenusResult | null> {
  const outcome = await client.request({ op: "effect_menus", compId: held.compId, layerId: held.layerId });
  return outcome.kind === "ok" ? parseEffectMenusResult(outcome.result) : null;
}

/** The request that removes the scratch project, whatever the page left in it. */
export function cleanupRequest(ticket: string): JsonObject {
  return { schemaVersion: "0.1", requestId: ticket, matchNames: [], cleanup: true };
}

/** `outcome` with its page text replaced by `page`. */
export function withPage(outcome: Extract<CallOutcome<HostCallResult>, { kind: "ok" }>, page: JsonObject): CallOutcome<HostCallResult> {
  return { ...outcome, result: { ...outcome.result, result: JSON.stringify(page) } };
}
