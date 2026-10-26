// Layer Styles that this After Effects session cannot add: when the host's Layer Style menu commands are inert it rejects a whole batch holding an
// `ensure_layer_style`, so a drop shadow or a glow is written as the plain effect with the same look and reported, and any other style is refused with the operation to send instead.
import { arrayAt, asObject, numberAt, objectAt, stringAt } from "./json.js";
import type { JsonArray, JsonObject, JsonValue } from "@extynt/decode";
import { toolError } from "./tool-result.js";
import type { ToolFailure, ToolResult } from "./tool-result.js";
import type { ToolContext } from "./contracts.js";

type StandInEffect = { capabilityId: string; effectMatchName: string; label: string };
type ListName = "operations" | "edits";
type StyleFallback = { replacements: ReadonlyMap<number, JsonObject>; notes: string[] };

type SettledLayerStyles = { args: JsonObject; notes: string[]; corrected: number };

const EFFECT_FOR_STYLE: ReadonlyMap<string, StandInEffect> = new Map([
  ["drop-shadow", { capabilityId: "adobe.drop-shadow", effectMatchName: "ADBE Drop Shadow", label: "Drop Shadow" }],
  ["outer-glow", { capabilityId: "adobe.glow", effectMatchName: "ADBE Glo2", label: "Glow" }],
]);

const OPERATION_LISTS: ReadonlyMap<string, ListName> = new Map([
  ["ae_queue_add", "operations"], ["ae_plan_add", "operations"], ["ae_propose_plan", "operations"], ["ae_queue_fix", "edits"], ["ae_amend_plan", "edits"],
]);

/** The registry entry for Layer Styles, which a search leaves out and a description marks while the commands are inert. */
export const LAYER_STYLES_OPERATION_ID = "layer-styles.ensure";

const UNAVAILABLE_NOTE = "UNAVAILABLE in this After Effects session: the Layer Style menu commands are not running, so the host rejects a batch holding ensure_layer_style. Use ensure_effect ADBE Drop Shadow (adobe.drop-shadow) for a drop shadow and ADBE Glo2 (adobe.glow) for a glow; ADBE Stroke or ADBE Fill for an outline or overlay.";

function asksMoreThanEffect(operation: JsonObject): boolean {
  return operation.enabled === false || Object.keys(objectAt(operation, "values") ?? {}).length > 0;
}

function effectForLayerStyle(operation: JsonObject): JsonObject | undefined {
  const stand = EFFECT_FOR_STYLE.get(stringAt(operation, "style") ?? "");
  const target = objectAt(operation, "target");
  if (!stand || !target || asksMoreThanEffect(operation)) return undefined;
  const effectPath = `ADBE Effect Parade/${stand.effectMatchName}`;
  return { type: "ensure_effect", target: { ...target, effectPath }, capabilityId: stand.capabilityId, effectMatchName: stand.effectMatchName, effectPath };
}

function replacementClause(operation: JsonObject): string {
  const stand = EFFECT_FOR_STYLE.get(stringAt(operation, "style") ?? "this style");
  if (!stand) return "No equivalent effect exists for this style in this session: use ensure_effect with ADBE Stroke or ADBE Fill for an outline or a colour overlay, or tell the user that this style needs the Layer menu to be opened once in After Effects.";
  const replacement = effectForLayerStyle(operation);
  if (replacement) return `Send this instead (the plain ${stand.label} effect, same look): ${JSON.stringify(replacement)}. Set its look afterwards with set_effect_control on the paths ae_inspect_layer lists under that effect.`;
  return `The plain ${stand.label} effect (ensure_effect ${stand.effectMatchName}, capabilityId ${stand.capabilityId}) is the way to get this look here; layer-style values and turning a style off have no effect equivalent, so set the look with set_effect_control.`;
}

function refuseStyle(operation: JsonObject, position: number): ToolFailure {
  return toolError("LAYER_STYLES_UNSUPPORTED", `Position ${position} (ensure_layer_style ${stringAt(operation, "style") ?? ""}) cannot run: the Layer Style menu commands are not available in this After Effects session, so the host would reject the whole batch. ${replacementClause(operation)} Nothing from this call was queued.`);
}

/** The entry's description as this session should read it. */
export function layerStylesDescription(entry: { id: string; description: string }, context: ToolContext): string {
  return entry.id === LAYER_STYLES_OPERATION_ID && context.layerStyles === "unavailable" ? `${UNAVAILABLE_NOTE} ${entry.description}` : entry.description;
}

function standInFor(operation: JsonObject, position: number, context: ToolContext): { replacement: JsonObject; note: string } | ToolFailure {
  const replacement = context.requestAsksLayerStyle === false ? effectForLayerStyle(operation) : undefined;
  if (!replacement) return refuseStyle(operation, position);
  const note = `Corrected position ${position}: the Layer Style menu commands are not available in this After Effects session, so ensure_layer_style ${stringAt(operation, "style") ?? ""} was queued as ensure_effect ${String(replacement.effectMatchName)} (the same look as the plain effect).`;
  return { replacement, note };
}

function layerStyleFallback(operations: ReadonlyArray<JsonValue | undefined>, context: ToolContext): StyleFallback | ToolFailure {
  const replacements = new Map<number, JsonObject>();
  const notes: string[] = [];
  for (const [position, candidate] of operations.entries()) {
    const operation = asObject(candidate);
    if (operation?.type !== "ensure_layer_style") continue;
    const standIn = standInFor(operation, position, context);
    if ("error" in standIn) return standIn;
    replacements.set(position, standIn.replacement);
    notes.push(standIn.note);
  }
  return { replacements, notes };
}

function operationOf(item: JsonValue, where: ListName): JsonValue | undefined {
  return where === "edits" ? asObject(item)?.operation : item;
}

function withReplacement(item: JsonValue, where: ListName, replacement: JsonObject | undefined): JsonValue {
  if (!replacement) return item;
  return where === "edits" ? { ...asObject(item), operation: replacement } : replacement;
}

function unsettled(args: JsonObject): SettledLayerStyles {
  return { args, notes: [], corrected: 0 };
}

function rewrittenList(list: JsonArray, where: ListName, replacements: ReadonlyMap<number, JsonObject>): JsonArray {
  return list.map((item, index) => withReplacement(item, where, replacements.get(index)));
}

/** Settles the operations of every write path (queue, plan, propose, amend) before any is composed, so no tool can send a session without the Layer Style commands what it cannot run. */
export function settleLayerStyles(name: string, args: JsonObject, context: ToolContext): SettledLayerStyles | ToolFailure {
  const where = OPERATION_LISTS.get(name);
  const list = where ? arrayAt(args, where) : undefined;
  if (!where || !list || context.layerStyles !== "unavailable") return unsettled(args);
  const settled = layerStyleFallback(list.map((item) => operationOf(item, where)), context);
  if ("error" in settled) return settled;
  if (settled.notes.length === 0) return unsettled(args);
  return { args: { ...args, [where]: rewrittenList(list, where, settled.replacements) }, notes: settled.notes, corrected: settled.notes.length };
}

/** The settled call's result, reporting what was corrected: on `data.corrected` and ahead of the other `data.notes`. */
export function reportLayerStyleCorrections(result: ToolResult, settled: SettledLayerStyles): ToolResult {
  if (!result.ok) return result;
  const data = asObject(result.data);
  if (!data || settled.corrected === 0) return result;
  const corrected = (numberAt(data, "corrected") ?? 0) + settled.corrected;
  return { ...result, data: { ...data, corrected, notes: [...settled.notes, ...(arrayAt(data, "notes") ?? [])] } };
}
