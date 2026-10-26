// What one operation's row is built from: the snapshot, the names the plan itself declares, and what earlier operations already wrote.
import { findProperty, type CompositionSnapshot, type LayerSnapshot, type PropertySnapshot, type ProjectSnapshot } from "@extynt/project-graph";
import type { PlanObjectNames } from "./plan-card-lines.js";
import { formatKeys, formatValue } from "./plan-row-format.js";
import { asObject } from "./json.js";
import type { JsonObject, JsonValue } from "@extynt/decode";
import type { SourceCatalogue, Translate, UiKey } from "@extynt/ui-text";

type Fields = JsonObject;

/** `before` and `after` are display text or null when the value is unknown or is not a single value. */
export interface RowParts {
  readonly label: string;
  readonly target?: string | null;
  readonly before?: string | null;
  readonly after?: string | null;
}

/** The snapshot, the names this plan declares and renames, and what earlier operations wrote, as one plan's rows are built. */
export interface RowState {
  readonly snapshot: ProjectSnapshot;
  readonly names: PlanObjectNames;
  readonly renamed: Map<string, string>;
  readonly written: Map<string, string | null>;
  readonly hostNames: ReadonlyMap<string, string>;
  readonly fontNames: ReadonlyMap<string, string>;
  readonly translate: Translate;
}

/** One operation seen by a row builder: its fields, the target it refers to and that target's layer when the snapshot has one. */
export interface RowInput {
  readonly state: RowState;
  readonly op: Fields;
  readonly ref: Fields;
  readonly layer: LayerSnapshot | undefined;
}

type PlainKey = { [Key in UiKey]: SourceCatalogue[Key] extends `${string}{${string}` ? never : SourceCatalogue[Key] extends string ? Key : never }[UiKey];

/** A catalogue key of the plan rows whose text has no placeholders, so it can be said by naming the key alone. */
export type PlainRowKey = Extract<PlainKey, `plan.row.${string}`>;

/** Builds the row for one operation type. */
export type RowBuilder = (input: RowInput) => RowParts;

/** A row that is only its label. */
export function fixed(label: PlainRowKey): RowBuilder {
  return ({ state }) => ({ label: state.translate(label) });
}

/** A row whose one value is the operation's `name`. */
export function nameOnly(label: PlainRowKey): RowBuilder {
  return ({ op, state }) => ({ label: state.translate(label), after: formatValue(op.name, false, state.translate) });
}

/** The value when it is a non-empty string. */
export function text(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** The value's fields when it is an object, otherwise none. */
export function fieldsOf(value: JsonValue | undefined): Fields {
  return asObject(value) ?? {};
}

function compositionOf(snapshot: ProjectSnapshot, ref: Fields): CompositionSnapshot | undefined {
  const id = text(ref.compositionId);
  const found = id ? snapshot.compositions.find((composition) => composition.id === id) : undefined;
  if (found) return found;
  const layerId = text(ref.layerId);
  return layerId ? snapshot.compositions.find((composition) => composition.layers.some((layer) => layer.id === layerId)) : undefined;
}

/** The layer as the snapshot holds it; a layer the plan creates has none. */
export function layerOf(snapshot: ProjectSnapshot, ref: Fields): LayerSnapshot | undefined {
  const layerId = text(ref.layerId);
  return layerId ? compositionOf(snapshot, ref)?.layers.find((layer) => layer.id === layerId) : undefined;
}

/** The layer's name now: a rename earlier in this plan, a name the plan declares, or the snapshot's. */
export function currentLayerName(state: RowState, layerId: string | undefined, layer: LayerSnapshot | undefined): string | undefined {
  if (!layerId) return undefined;
  return state.renamed.get(layerId) ?? state.names.layers.get(layerId) ?? layer?.name;
}

/** The property at `path` on the layer, if both exist. */
export function propertyOf(layer: LayerSnapshot | undefined, path: string | undefined): PropertySnapshot | undefined {
  return layer && path ? findProperty(layer, { path }) : undefined;
}

function writeKey(ref: Fields, path: string): string {
  return `${text(ref.layerId) ?? ""}\u0000${path}`;
}

/** The value a property holds now, as text: what an earlier operation in this plan wrote, else what the snapshot read. */
export function propertyBefore(input: RowInput, path: string | undefined): string | null {
  if (!path) return null;
  const earlier = input.state.written.get(writeKey(input.ref, path));
  if (earlier !== undefined) return earlier;
  const read = propertyOf(input.layer, path);
  if (!read) return null;
  const keys = read.keyframes?.length ?? read.keyframeCount ?? 0;
  if (keys > 0) return formatKeys(keys, input.state.translate);
  return formatValue(read.value, read.valueType === "color", input.state.translate);
}

/** Records the text an operation wrote to a property, so a later operation on it shows that as its "before". */
export function rememberWrite(input: RowInput, path: string | undefined, after: string | null): void {
  if (path) input.state.written.set(writeKey(input.ref, path), after);
}
