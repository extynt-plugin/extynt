// The approval card's value rows: one `{label, target, before, after}` per operation, in plain language, so the card says what changes rather than which operation runs.
import type { JsonObject } from "@extynt/decode";
import type { ActionPlanV2Operation } from "@extynt/action-plan";
import type { HostCapabilityProfile } from "@extynt/capability-catalogue";
import type { ProjectSnapshot } from "@extynt/project-graph";
import type { Translate } from "@extynt/ui-text";
import { ENGLISH_TEXT } from "./plan-text.js";
import { PATH_FIELD_USES } from "./core-constants.js";
import { newObjectNames } from "./plan-card-lines.js";
import { operationJson } from "./operations.js";
import { currentLayerName, fieldsOf, layerOf, text, type RowBuilder, type RowInput, type RowParts, type RowState } from "./plan-row-context.js";
import { humanizeName } from "./plan-row-format.js";
import { profileFontNames, profileNames } from "./plan-row-names.js";
import { LAYER_ROWS } from "./plan-rows-layer.js";
import { MISC_ROWS } from "./plan-rows-misc.js";
import { PROPERTY_ROWS } from "./plan-rows-property.js";

/** `before` is null when the authoring path has no current value for it; `after` is null when the operation has no single value to show. */
export interface PlanValueRow { label: string; target?: string; before: string | null; after: string | null }

const BUILDERS: Readonly<Record<string, RowBuilder>> = { ...LAYER_ROWS, ...PROPERTY_ROWS, ...MISC_ROWS };
const RENAMING_TYPES: ReadonlySet<string> = new Set(["set_layer_name"]);

function layerTarget(input: RowInput, layerId: string): string | undefined {
  const name = currentLayerName(input.state, layerId, input.layer);
  if (name) return name;
  return layerId.startsWith("__new__:") ? input.state.translate("plan.row.newLayer") : undefined;
}

function itemTarget({ state }: RowInput, itemId: string): string | undefined {
  if (itemId.startsWith("__new__:")) return state.names.compositions.get(itemId) ?? state.translate("plan.row.newProjectItem");
  return state.snapshot.items?.find((item) => item.id === itemId)?.name;
}

function compositionTarget({ state }: RowInput, compositionId: string): string | undefined {
  return state.names.compositions.get(compositionId) ?? state.snapshot.compositions.find((composition) => composition.id === compositionId)?.name;
}

function targetOf(input: RowInput): string | undefined {
  const { op, ref } = input;
  const layerId = text(ref.layerId);
  if (layerId) return layerTarget(input, layerId);
  const itemId = text(ref.itemId);
  if (itemId) return itemTarget(input, itemId);
  const compositionId = text(ref.compositionId) ?? text(op.compositionId);
  if (compositionId) return compositionTarget(input, compositionId);
  return text(op.name);
}

function pathDisclosure(type: string, op: JsonObject, translate: Translate): string | undefined {
  const spec = PATH_FIELD_USES[type];
  const value = spec ? op[spec.field] : undefined;
  if (!spec || typeof value !== "string") return undefined;
  return translate(spec.use === "source" ? "plan.row.pathSource" : "plan.row.pathDestination", { value });
}

function rowOf(input: RowInput, type: string): PlanValueRow {
  const builder = BUILDERS[type];
  const parts: RowParts = builder ? builder(input) : { label: humanizeName(type) };
  const target = parts.target ?? targetOf(input);
  const after = pathDisclosure(type, input.op, input.state.translate) ?? parts.after ?? null;
  return { label: parts.label, ...(target ? { target } : {}), before: parts.before ?? null, after };
}

function noteRename(state: RowState, type: string, input: RowInput): void {
  const layerId = text(input.ref.layerId);
  const name = text(input.op.name);
  if (RENAMING_TYPES.has(type) && layerId && name) state.renamed.set(layerId, name);
}

/** One row per operation, all of them; the card decides how many to show. `before` is the snapshot's value, or what an earlier operation in this plan writes to the same place. */
export function presentPlanRows(snapshot: ProjectSnapshot, operations: readonly ActionPlanV2Operation[], hostProfile?: HostCapabilityProfile, translate: Translate = ENGLISH_TEXT): PlanValueRow[] {
  const state: RowState = { snapshot, names: newObjectNames(operations), renamed: new Map(), written: new Map(), hostNames: profileNames(hostProfile), fontNames: profileFontNames(hostProfile), translate };
  return operations.map((operation) => {
    const op = operationJson(operation);
    const ref = fieldsOf(op.target);
    const input: RowInput = { state, op, ref, layer: layerOf(snapshot, ref) };
    const row = rowOf(input, operation.type);
    noteRename(state, operation.type, input);
    return row;
  });
}
