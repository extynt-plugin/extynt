/**
 * The fields of a plugin read's rows that the adapter reads. Each row kind is decoded once into its facts, which keep the row
 * itself, so everything the adapter does not read is carried through untouched. A field of the wrong type reads as absent; a
 * composition or layer without an id is not a row the adapter can place, and is left out.
 */
import { boolean, decode, type Decoder, fallback, type Infer, map, number, object, optional, string, union } from "@extynt/decode";
import { opaque, type Opaque } from "../snapshot-view.js";
import { isRow, type Row } from "../snapshot-view.js";

/** A property's value as the plugin sent it, and the `unsupported` tag it carried in place of a value (`{unsupported: "text-document"}`). */
export interface ValueFact { raw: Opaque; unsupported: string | undefined }
export interface PropertyFacts { path: string | undefined; value: ValueFact | undefined; keyframeCount: number | undefined; keyDigest: string | undefined; matchName: string | undefined; valueType: string | undefined; row: Row }
/** `propertyRows` is null when the read did not go down to the properties. */
export interface LayerFacts { id: string; type: string | undefined; hash: string | undefined; propertyRows: readonly Row[] | null; row: Row }
export interface CompositionFacts { id: string; hash: string | undefined; truncated: boolean; hasMarkers: boolean; layerRows: readonly Row[]; row: Row }

const text = optional(fallback(string(), undefined));
const hash = optional(fallback(string({ nonEmpty: true }), undefined));
const id = map(union(string(), number()), String);
const rowList: Decoder<Row[] | null> = { run: (input) => (Array.isArray(input) ? input.filter(isRow) : null) };
const tagged = object({ unsupported: text });
const valueFact: Decoder<ValueFact> = { run: (input) => { const decoded = decode(tagged, input), raw = decode(opaque, input); return { raw: raw.ok ? raw.value : undefined, unsupported: decoded.ok ? decoded.value.unsupported : undefined }; } };

const propertyShape = object({ path: text, value: optional(valueFact), keyframeCount: optional(fallback(number(), undefined)), keyDigest: text, matchName: text, valueType: text });
const layerShape = object({ id, type: text, hash, propertyPaths: optional(rowList) });
const compositionShape = object({ id, hash, truncated: optional(fallback(boolean(), undefined)), markers: optional(opaque), layers: optional(rowList) });

type PropertyShape = Infer<typeof propertyShape>;

/** The rows of a list the plugin sent; anything that is not a row is dropped, and a value that is not a list has no rows. */
export function rowsOf(value: Opaque): Row[] {
  return Array.isArray(value) ? value.filter(isRow) : [];
}

function propertyOf(row: Row, fact: PropertyShape): PropertyFacts {
  return { path: fact.path, value: fact.value, keyframeCount: fact.keyframeCount, keyDigest: fact.keyDigest, matchName: fact.matchName, valueType: fact.valueType, row };
}

function propertyFacts(row: Row): PropertyFacts {
  const decoded = decode(propertyShape, row);
  return propertyOf(row, decoded.ok ? decoded.value : {});
}

function layerFacts(row: Row): LayerFacts | null {
  const decoded = decode(layerShape, row);
  return decoded.ok ? { id: decoded.value.id, type: decoded.value.type, hash: decoded.value.hash, propertyRows: decoded.value.propertyPaths ?? null, row } : null;
}

/** The facts of one composition row, or null when it has no id. */
export function compositionFacts(row: Row): CompositionFacts | null {
  const decoded = decode(compositionShape, row);
  if (!decoded.ok) return null;
  const { id: compId, hash: compHash, truncated, markers, layers } = decoded.value;
  return { id: compId, hash: compHash, truncated: truncated === true, hasMarkers: markers !== undefined, layerRows: layers ?? [], row };
}

/** The compositions among `rows` the adapter can place. */
export function compositionsOf(rows: readonly Row[]): CompositionFacts[] {
  return rows.flatMap((row) => compositionFacts(row) ?? []);
}

/** The layers of a composition the adapter can place. */
export function layersOf(composition: CompositionFacts): LayerFacts[] {
  return composition.layerRows.flatMap((row) => layerFacts(row) ?? []);
}

/** The properties of a layer read down to its properties; none for a layer read without them. */
export function layerProperties(layer: LayerFacts): PropertyFacts[] {
  return (layer.propertyRows ?? []).map(propertyFacts);
}
