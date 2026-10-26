// The additive tables of the runtime effect catalogue, created idempotently so an existing catalogue file gains them without a schema-version bump.

/** The catalogue tables' DDL. */
export const GRAPH_CATALOGUE_TABLES = `
CREATE TABLE IF NOT EXISTS parameter_definition_observed_ui (
 parameter_definition_id TEXT NOT NULL, provenance_id TEXT NOT NULL,
 is_group INTEGER NOT NULL CHECK(is_group IN (0,1)), hidden INTEGER CHECK(hidden IN (0,1)),
 PRIMARY KEY(parameter_definition_id,provenance_id),
 FOREIGN KEY(parameter_definition_id,provenance_id) REFERENCES parameter_definition_facts(parameter_definition_id,provenance_id) ON DELETE CASCADE
) STRICT;
CREATE TABLE IF NOT EXISTS parameter_definition_menu_items (
 parameter_definition_id TEXT NOT NULL, provenance_id TEXT NOT NULL,
 ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 1 AND 64), label TEXT NOT NULL,
 PRIMARY KEY(parameter_definition_id,provenance_id,ordinal),
 FOREIGN KEY(parameter_definition_id,provenance_id) REFERENCES parameter_definition_facts(parameter_definition_id,provenance_id) ON DELETE CASCADE
) STRICT;
CREATE TABLE IF NOT EXISTS catalogue_fingerprints (
 host_key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, observed_at INTEGER NOT NULL
) STRICT;
`;
/** How many tables the DDL creates. */
export const GRAPH_CATALOGUE_TABLE_COUNT = 3;
/** The query that counts the catalogue tables a file already holds. */
export const GRAPH_CATALOGUE_TABLE_CHECK = "SELECT count(*) AS total FROM sqlite_master WHERE type='table' AND name IN ('parameter_definition_observed_ui','parameter_definition_menu_items','catalogue_fingerprints')";
