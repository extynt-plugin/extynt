// Opens a graph database file safely: creates it owner-only, checks its identity, schema and integrity, and migrates older schemas in place.
import { constants, closeSync, lstatSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { decodeOrThrow, fallback, map, number, object, string, type Decoder } from "@extynt/decode";
import { GRAPH_ADDITIVE_SCHEMA, GRAPH_APPLICATION_ID, GRAPH_KEYSET_INDEX, GRAPH_SCHEMA, GRAPH_SCHEMA_VERSION } from "./graph-schema.js";
import { GRAPH_CATALOGUE_TABLES, GRAPH_CATALOGUE_TABLE_CHECK, GRAPH_CATALOGUE_TABLE_COUNT } from "./catalogue-schema.js";
import { EFFECT_NOTES_TABLES, EFFECT_NOTES_TABLE_CHECK, EFFECT_NOTES_TABLE_COUNT } from "./effect-notes-schema.js";
import { opensToOthers } from "./owner-only-mode.js";
import { GRAPH_RETENTION_INDEX_CHECK, GRAPH_RETENTION_INDEX_COUNT, GRAPH_RETENTION_INDEXES } from "./graph-retention-indexes.js";
import { selectOne } from "./graph-sql.js";

const MAX_FILE_BYTES = 268435456;
const FIRST_VERSION = 1;
const SECOND_VERSION = 2;
const BUSY_TIMEOUT_MS = 250;
const applicationRow = object({ application_id: number() });
const versionRow = object({ user_version: number() });
const checkRow = object({ quick_check: string() });
const pageSizeRow = object({ page_size: number() });
const totalRow = object({ total: number() });
const errorCode: Decoder<string | undefined> = fallback(map(object({ code: string() }), (facts) => facts.code), undefined);

function applicationId(database: DatabaseSync): number | undefined {
  return selectOne(database, "PRAGMA application_id", applicationRow)?.application_id;
}

function checkFile(path: string): void {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.nlink !== 1 || opensToOthers(stat.mode)) throw Error("GRAPH_FILE_UNSAFE");
}

function checkJournals(path: string, databaseExists: boolean): void {
  for (const suffix of ["-journal", "-wal", "-shm"]) {
    try {
      checkFile(path + suffix);
      if (suffix === "-journal" && databaseExists) continue;
      throw Error("GRAPH_FILE_COLLISION");
    } catch (error) { if (decodeOrThrow(errorCode, error) !== "ENOENT") throw error; }
  }
}

function checkSchema(database: DatabaseSync): number {
  const version = selectOne(database, "PRAGMA user_version", versionRow)?.user_version;
  if (applicationId(database) !== GRAPH_APPLICATION_ID || (version !== FIRST_VERSION && version !== SECOND_VERSION && version !== GRAPH_SCHEMA_VERSION)) throw Error("GRAPH_SCHEMA_UNSUPPORTED");
  if (selectOne(database, "PRAGMA quick_check", checkRow)?.quick_check !== "ok") throw Error("GRAPH_FILE_INVALID");
  return version;
}

function migrateSchema(database: DatabaseSync): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    const version = checkSchema(database);
    if (version === FIRST_VERSION) database.exec(`DROP INDEX nodes_scope_order; ${GRAPH_KEYSET_INDEX}`);
    if (version < GRAPH_SCHEMA_VERSION) database.exec(`${GRAPH_ADDITIVE_SCHEMA}; PRAGMA user_version=${GRAPH_SCHEMA_VERSION}`);
    database.exec(GRAPH_RETENTION_INDEXES);
    database.exec(GRAPH_CATALOGUE_TABLES);
    database.exec(EFFECT_NOTES_TABLES);
    database.exec("COMMIT");
  } catch (error) { database.exec("ROLLBACK"); throw error; }
}

function createSchema(database: DatabaseSync): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    if (applicationId(database) === GRAPH_APPLICATION_ID) { database.exec("COMMIT"); return; }
    database.exec(GRAPH_SCHEMA);
    database.exec(GRAPH_CATALOGUE_TABLES);
    database.exec(EFFECT_NOTES_TABLES);
    database.exec(`PRAGMA application_id=${GRAPH_APPLICATION_ID}; PRAGMA user_version=${GRAPH_SCHEMA_VERSION}`);
    database.exec("COMMIT");
  } catch (error) { database.exec("ROLLBACK"); throw error; }
}

function tableCount(database: DatabaseSync, check: string): number | undefined {
  return selectOne(database, check, totalRow)?.total;
}

function needsMigration(database: DatabaseSync, version: number | undefined): boolean {
  return version !== GRAPH_SCHEMA_VERSION || tableCount(database, GRAPH_RETENTION_INDEX_CHECK) !== GRAPH_RETENTION_INDEX_COUNT
    || tableCount(database, GRAPH_CATALOGUE_TABLE_CHECK) !== GRAPH_CATALOGUE_TABLE_COUNT
    || tableCount(database, EFFECT_NOTES_TABLE_CHECK) !== EFFECT_NOTES_TABLE_COUNT;
}

function pathExists(path: string): boolean {
  try { lstatSync(path); return true; } catch (error) { if (decodeOrThrow(errorCode, error) === "ENOENT") return false; throw error; }
}

function createExclusive(path: string): boolean {
  try { closeSync(openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)); return true; }
  catch (error) { if (decodeOrThrow(errorCode, error) === "EEXIST") return false; throw error; }
}

function configure(database: DatabaseSync): void {
  const pageSize = selectOne(database, "PRAGMA page_size", pageSizeRow)?.page_size ?? 4096;
  database.exec(`PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA cache_size=-8192; PRAGMA max_page_count=${Math.floor(MAX_FILE_BYTES / pageSize)}`);
}

/** Opens the graph database at `path`, creating it when missing. An unknown or damaged database is preserved and refused with its GRAPH_* code, so observation can continue without it. */
export function openGraphFile(path: string): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  checkJournals(path, pathExists(path));
  const created = createExclusive(path);
  checkFile(path); checkJournals(path, !created);
  const empty = created || lstatSync(path).size === 0;
  const database = new DatabaseSync(path, { timeout: BUSY_TIMEOUT_MS });
  try {
    const existingVersion = empty ? undefined : checkSchema(database);
    configure(database);
    if (empty) createSchema(database);
    else if (needsMigration(database, existingVersion)) migrateSchema(database);
    return database;
  } catch (error) { database.close(); throw error; }
}
