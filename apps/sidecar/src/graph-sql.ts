// Prepared-statement cache and typed row access for the graph SQLite files: every row is decoded at this boundary.
import { DecodeFailure, decode, decodeOrThrow, literal, map, number, object } from "@extynt/decode";
import type { Decoder } from "@extynt/decode";
import type { DatabaseSync, SQLInputValue, StatementSync } from "node:sqlite";

const statements = new WeakMap<DatabaseSync, Map<string, StatementSync>>();
const skippedRows = new WeakMap<DatabaseSync, number>();

type SqlParameter = SQLInputValue;

/** SQLite stores booleans as the integers 0 and 1; this decodes that column into a `boolean`. */
export const sqlFlag: Decoder<boolean> = map(literal(0, 1), (stored) => stored === 1);

/** Only implementation-owned SQL reaches this cache; transport fields are bound values. */
export function graphSql(database: DatabaseSync, source: string): StatementSync {
  let cached = statements.get(database);
  if (!cached) { cached = new Map(); statements.set(database, cached); }
  let statement = cached.get(source);
  if (!statement) { statement = database.prepare(source); cached.set(source, statement); }
  return statement;
}

/** Runs a query and returns every row decoded into `Row`; a row that does not fit throws a `DecodeFailure`. */
export function selectAll<Row>(database: DatabaseSync, source: string, row: Decoder<Row>, ...parameters: readonly SqlParameter[]): ReadonlyArray<Row> {
  return graphSql(database, source).all(...parameters).map((stored) => decodeOrThrow(row, stored));
}

/** Runs a list query and returns the rows that decode; a row that does not fit is skipped and tallied for `takeInvalidRows`, so one bad row never hides the rest. */
export function selectValid<Row>(database: DatabaseSync, source: string, row: Decoder<Row>, ...parameters: readonly SqlParameter[]): ReadonlyArray<Row> {
  const rows: Row[] = [];
  for (const stored of graphSql(database, source).all(...parameters)) {
    const decoded = decode(row, stored);
    if (decoded.ok) rows.push(decoded.value);
    else skippedRows.set(database, (skippedRows.get(database) ?? 0) + 1);
  }
  return rows;
}

/** Reads each row with `read`, skipping and tallying a row whose own stored detail does not decode; any other failure propagates. */
export function readValid<Row, T>(database: DatabaseSync, rows: ReadonlyArray<Row>, read: (row: Row) => T): T[] {
  const valid: T[] = [];
  for (const row of rows) {
    try { valid.push(read(row)); }
    catch (error) {
      if (!(error instanceof DecodeFailure)) throw error;
      skippedRows.set(database, (skippedRows.get(database) ?? 0) + 1);
    }
  }
  return valid;
}

/** Returns how many rows `selectValid` skipped on this database since the last call, and resets the tally. */
export function takeInvalidRows(database: DatabaseSync): number {
  const skipped = skippedRows.get(database) ?? 0;
  skippedRows.delete(database);
  return skipped;
}

/** Runs a query and returns its first row decoded into `Row`, or `undefined` when nothing matched. */
export function selectOne<Row>(database: DatabaseSync, source: string, row: Decoder<Row>, ...parameters: readonly SqlParameter[]): Row | undefined {
  const stored = graphSql(database, source).get(...parameters);
  return stored === undefined ? undefined : decodeOrThrow(row, stored);
}

/** Runs a statement for its effect and returns how many rows it changed. */
export function execute(database: DatabaseSync, source: string, ...parameters: readonly SqlParameter[]): number {
  return Number(graphSql(database, source).run(...parameters).changes);
}

const writtenId = object({ id: number() });

/** Runs a statement that ends in `RETURNING id` and returns the id of the row it wrote. */
export function returnedId(database: DatabaseSync, source: string, ...parameters: readonly SqlParameter[]): number {
  const written = selectOne(database, source, writtenId, ...parameters);
  if (written === undefined) throw Error("GRAPH_ROW_INVALID");
  return written.id;
}
