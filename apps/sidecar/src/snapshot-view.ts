/**
 * What the read pipeline knows of a stored snapshot: the host stamp, the scope of the read, the item list, the composition
 * rows (id and size) and the pages the host left unread. A snapshot's result is decoded once and cached by identity (and
 * rebuilt if one of the fields read was replaced), so the scheduler, the currency checks and the merge never rescan it;
 * rows keep their original objects, so a merge moves them without copying. A field that does not decode reads as absent.
 */
import { accepts, boolean, decode, fail, isJsonArray, isJsonObject, jsonValue, type Decoder, type Infer, type JsonObject, type JsonValue, map, nullable, number, object, optional, record, string, union } from "@extynt/decode";
import type { ProbeSnapshot } from "./server-types.js";

type Result = ProbeSnapshot["result"];
/** A value the pipeline moves without looking inside; a decoder or a narrowing turns it into a precise type before any field is read. */
export type Opaque = JsonValue | undefined;
/** A plugin row: its fields are read through the fact decoders only, and the rest is carried through untouched. */
export type Row = JsonObject;
/** True for a plain object, which is what a row is. */
export const isRow = (value: Opaque): value is Row => isJsonObject(value);
export interface CompositionRow { id: string; layerCount: number; row: Row }
export interface ItemRow { id: string; composition: boolean; row: Row }
export interface Pages { unread: readonly string[]; oversized: readonly string[]; capped: boolean }
export interface HostStamp { epoch: number; revision: number }

const carriesJson = accepts(jsonValue);

const ordinal = number({ int: true, min: 0 });
const idText = map(union(string(), number()), String);
/** Accepts any value unchanged, for fields the pipeline carries without reading. */
export const opaque: Decoder<Opaque> = { run: (input) => (input === undefined || input === null || typeof input === "boolean" || typeof input === "number" || typeof input === "string" ? input : carriesJson(input) ? input : fail("JSON value", input)) };
const layerCount: Decoder<number> = { run: (input) => (Array.isArray(input) ? input.length : 0) };
const texts: Decoder<readonly string[]> = { run: (input) => (Array.isArray(input) ? input.filter((entry): entry is string => typeof entry === "string") : []) };

function rowsOf<T, R>(shape: Decoder<T>, make: (fact: T, row: Row) => R): Decoder<{ rows: R[]; length: number } | null> {
  return { run: (input) => {
    if (!carriesJson(input) || !isJsonArray(input)) return null;
    const rows: R[] = [];
    for (const row of input) { const decoded = decode(shape, row); if (decoded.ok && isRow(row)) rows.push(make(decoded.value, row)); }
    return { rows, length: input.length };
  } };
}

const rawShape = object({ project: opaque, hostStamp: opaque, coverage: opaque, readScope: opaque, itemCount: opaque, items: opaque, sources: opaque, compositions: opaque, compositionPages: opaque, truncation: opaque });
const projectShape = object({ name: optional(string()), filePath: optional(nullable(string())) });
const stampShape = object({ epoch: ordinal, revision: ordinal });
const scopeShape = object({ compositions: optional(string()), items: optional(string()) });
const pagesShape = object({ unread: texts, oversized: texts, capped: optional(boolean()) });
const compositionRows = rowsOf(object({ id: idText, layers: layerCount }), (fact, row): CompositionRow => ({ id: fact.id, layerCount: fact.layers, row }));
const itemRows = rowsOf(object({ id: idText, type: optional(string()) }), (fact, row): ItemRow => ({ id: fact.id, composition: fact.type === "composition", row }));
type Raw = Infer<typeof rawShape>;

/**
 * The facts the pipeline reads of a snapshot's result. `scoped` means the host listed compositions (a read to place on a
 * base); `itemsRead` that such a read also read the item list; `items` is null when the result has no item list. Rows keep
 * their original objects in `row`.
 */
export interface SnapshotView {
  readonly project: { name?: string; filePath?: string | null };
  readonly stamp: HostStamp | null;
  readonly coverage: boolean;
  readonly scoped: boolean;
  readonly itemsRead: boolean;
  readonly itemCount: number | null;
  readonly items: readonly ItemRow[] | null;
  readonly itemsLength: number | null;
  readonly sources: Opaque;
  readonly readScope: Opaque;
  readonly compositions: readonly CompositionRow[];
  readonly pages: Pages;
  readonly truncation: Readonly<Record<string, Opaque>>;
  readonly raw: Raw;
}

function pick<T>(decoder: Decoder<T>, input: Opaque, fallback: T): T {
  const decoded = decode(decoder, input);
  return decoded.ok ? decoded.value : fallback;
}

function viewOf(raw: Raw): SnapshotView {
  const scope = pick(scopeShape, raw.readScope, {}), items = pick(itemRows, raw.items, null), pages = pick(pagesShape, raw.compositionPages, { unread: [], oversized: [] });
  return {
    project: pick(projectShape, raw.project, {}), stamp: pick(nullable(stampShape), raw.hostStamp, null), coverage: decode(object({}), raw.coverage).ok, scoped: scope.compositions === "listed", itemsRead: scope.items === "read",
    itemCount: pick(nullable(ordinal), raw.itemCount, null), items: items?.rows ?? null, itemsLength: items?.length ?? null, sources: raw.sources, readScope: raw.readScope,
    compositions: pick(compositionRows, raw.compositions, null)?.rows ?? [], pages: { unread: pages.unread, oversized: pages.oversized, capped: pages.capped === true },
    truncation: pick(record(string(), opaque), raw.truncation, {}), raw,
  };
}

const RAW_KEYS = ["project", "hostStamp", "coverage", "readScope", "itemCount", "items", "sources", "compositions", "compositionPages", "truncation"] as const;
const EMPTY = viewOf({ project: undefined, hostStamp: undefined, coverage: undefined, readScope: undefined, itemCount: undefined, items: undefined, sources: undefined, compositions: undefined, compositionPages: undefined, truncation: undefined });
const views = new WeakMap<Result, SnapshotView>();
const sameRaw = (a: Raw, b: Raw): boolean => RAW_KEYS.every((key) => a[key] === b[key]);

/** The view of a snapshot, built once per result object and again only if one of the fields it reads was replaced. */
export function snapshotView(snapshot: ProbeSnapshot): SnapshotView {
  const raw = decode(rawShape, snapshot.result), cached = views.get(snapshot.result);
  if (!raw.ok) return EMPTY;
  if (cached && sameRaw(cached.raw, raw.value)) return cached;
  const built = viewOf(raw.value);
  views.set(snapshot.result, built);
  return built;
}
