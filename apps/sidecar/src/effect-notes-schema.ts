// Additive tables for effect value notes in the host catalogue file, created idempotently so an existing file gains them without a schema-version bump; nothing is seeded.
/** The DDL for every effect-notes table and index. */
export const EFFECT_NOTES_TABLES = `
CREATE TABLE IF NOT EXISTS effect_value_notes (
 id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 64),
 match_name TEXT NOT NULL CHECK(length(match_name) BETWEEN 1 AND 512),
 control_path TEXT CHECK(control_path IS NULL OR length(control_path) BETWEEN 1 AND 1024),
 plugin_key TEXT NOT NULL CHECK(length(plugin_key) BETWEEN 1 AND 512),
 kind TEXT NOT NULL CHECK(kind IN ('measured','agent-inferred')),
 text TEXT NOT NULL CHECK(length(text) BETWEEN 1 AND 280 AND instr(text,char(10))=0),
 value_text TEXT CHECK(value_text IS NULL OR length(value_text) <= 256),
 effect_version TEXT CHECK(effect_version IS NULL OR length(effect_version) <= 256),
 ae_build TEXT NOT NULL CHECK(length(ae_build) BETWEEN 1 AND 256),
 state TEXT NOT NULL CHECK(state IN ('current','replaced')),
 created_at INTEGER NOT NULL CHECK(created_at >= 0),
 replaced_by TEXT CHECK(replaced_by IS NULL OR length(replaced_by) <= 64),
 replace_reason TEXT CHECK(replace_reason IS NULL OR (length(replace_reason) BETWEEN 1 AND 160 AND instr(replace_reason,char(10))=0)),
 replaced_at INTEGER CHECK(replaced_at IS NULL OR replaced_at >= 0),
 CHECK((state='current' AND replaced_by IS NULL AND replace_reason IS NULL AND replaced_at IS NULL) OR (state='replaced' AND replace_reason IS NOT NULL AND replaced_at IS NOT NULL))
) STRICT;
CREATE INDEX IF NOT EXISTS effect_value_notes_effect ON effect_value_notes(match_name,state,created_at);
CREATE INDEX IF NOT EXISTS effect_value_notes_plugin ON effect_value_notes(plugin_key);
CREATE TABLE IF NOT EXISTS effect_value_usage (
 id INTEGER PRIMARY KEY,
 match_name TEXT NOT NULL CHECK(length(match_name) BETWEEN 1 AND 512),
 control_path TEXT NOT NULL CHECK(length(control_path) BETWEEN 1 AND 1024),
 source TEXT NOT NULL CHECK(source IN ('kept','seen')),
 value_text TEXT NOT NULL CHECK(length(value_text) <= 256),
 scalar REAL,
 plan_id TEXT CHECK(plan_id IS NULL OR length(plan_id) BETWEEN 1 AND 256),
 slot TEXT NOT NULL DEFAULT '' CHECK(length(slot) <= 512),
 recorded_at INTEGER NOT NULL CHECK(recorded_at >= 0),
 CHECK((source='kept' AND plan_id IS NOT NULL) OR (source='seen' AND plan_id IS NULL AND slot<>''))
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS effect_value_usage_kept ON effect_value_usage(plan_id,match_name,control_path,slot) WHERE source='kept';
CREATE UNIQUE INDEX IF NOT EXISTS effect_value_usage_seen ON effect_value_usage(match_name,control_path,slot) WHERE source='seen';
CREATE INDEX IF NOT EXISTS effect_value_usage_control ON effect_value_usage(match_name,control_path,source,recorded_at);
CREATE INDEX IF NOT EXISTS effect_value_usage_plan ON effect_value_usage(plan_id) WHERE plan_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS effect_value_usage_plans (
 plan_id TEXT PRIMARY KEY CHECK(length(plan_id) BETWEEN 1 AND 256),
 state TEXT NOT NULL CHECK(state IN ('kept','undone')),
 updated_at INTEGER NOT NULL CHECK(updated_at >= 0)
) STRICT;
CREATE TABLE IF NOT EXISTS effect_usage_events (
 id INTEGER PRIMARY KEY,
 kind TEXT NOT NULL CHECK(kind IN ('effect','font','preset')),
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 512),
 source TEXT NOT NULL CHECK(source IN ('kept','seen')),
 plan_id TEXT CHECK(plan_id IS NULL OR length(plan_id) BETWEEN 1 AND 256),
 slot TEXT NOT NULL CHECK(length(slot) <= 512),
 recorded_at INTEGER NOT NULL CHECK(recorded_at >= 0),
 CHECK((source='kept' AND plan_id IS NOT NULL) OR (source='seen' AND plan_id IS NULL AND slot<>''))
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS effect_usage_events_kept ON effect_usage_events(plan_id,kind,name,slot) WHERE source='kept';
CREATE UNIQUE INDEX IF NOT EXISTS effect_usage_events_seen ON effect_usage_events(kind,name,slot) WHERE source='seen';
CREATE INDEX IF NOT EXISTS effect_usage_events_rank ON effect_usage_events(kind,name,source);
CREATE INDEX IF NOT EXISTS effect_usage_events_plan ON effect_usage_events(plan_id) WHERE plan_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS effect_usage_events_age ON effect_usage_events(recorded_at,id);
CREATE TABLE IF NOT EXISTS animation_habit_samples (
 id INTEGER PRIMARY KEY,
 plan_id TEXT NOT NULL CHECK(length(plan_id) BETWEEN 1 AND 256),
 slot TEXT NOT NULL CHECK(length(slot) BETWEEN 1 AND 512),
 property_kind TEXT NOT NULL CHECK(length(property_kind) BETWEEN 1 AND 64),
 duration REAL NOT NULL CHECK(duration > 0 AND duration <= 86400),
 keyframes INTEGER NOT NULL CHECK(keyframes BETWEEN 2 AND 1024),
 easing TEXT NOT NULL CHECK(length(easing) BETWEEN 1 AND 64),
 influence REAL CHECK(influence IS NULL OR (influence >= 0.1 AND influence <= 100)),
 recorded_at INTEGER NOT NULL CHECK(recorded_at >= 0)
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS animation_habit_samples_slot ON animation_habit_samples(plan_id,slot);
CREATE INDEX IF NOT EXISTS animation_habit_samples_kind ON animation_habit_samples(property_kind,recorded_at,id);
CREATE INDEX IF NOT EXISTS animation_habit_samples_age ON animation_habit_samples(recorded_at,id);
CREATE TABLE IF NOT EXISTS effect_note_plugin_optin (
 plugin_key TEXT PRIMARY KEY CHECK(length(plugin_key) BETWEEN 1 AND 512),
 enabled_at INTEGER NOT NULL CHECK(enabled_at >= 0)
) STRICT;
`;
/** How many tables the DDL creates. */
export const EFFECT_NOTES_TABLE_COUNT = 6;
/** The query that counts those tables in a file, to prove they exist. */
export const EFFECT_NOTES_TABLE_CHECK = "SELECT count(*) AS total FROM sqlite_master WHERE type='table' AND name IN ('effect_value_notes','effect_value_usage','effect_value_usage_plans','effect_usage_events','animation_habit_samples','effect_note_plugin_optin')";
