-- Immutable schema v1 fixture for non-destructive migration tests.
PRAGMA foreign_keys=ON;

CREATE TABLE projects (
 id TEXT PRIMARY KEY, file_path TEXT, name TEXT NOT NULL,
 host_version TEXT NOT NULL, platform TEXT NOT NULL
) STRICT;
CREATE TABLE scopes (
 id INTEGER PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
 kind TEXT NOT NULL CHECK(kind IN ('index','layers','properties','values')),
 composition_id TEXT NOT NULL, layer_id TEXT NOT NULL, property_path TEXT NOT NULL,
 UNIQUE(project_id,kind,composition_id,layer_id,property_path)
) STRICT;
CREATE TABLE nodes (
 id INTEGER PRIMARY KEY, scope_id INTEGER NOT NULL REFERENCES scopes(id) ON DELETE CASCADE,
 native_id TEXT NOT NULL, name TEXT NOT NULL, ordinal INTEGER,
 owner TEXT NOT NULL, epoch INTEGER NOT NULL, revision INTEGER, observed_at INTEGER NOT NULL,
 UNIQUE(scope_id,native_id)
) STRICT;
CREATE INDEX nodes_age ON nodes(observed_at,id);
CREATE INDEX nodes_scope_order ON nodes(scope_id,ordinal,id);
CREATE TABLE items (
 node_id INTEGER PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
 type TEXT NOT NULL CHECK(type IN ('composition','folder','footage')),
 parent_folder_id TEXT, layer_count INTEGER
) STRICT;
CREATE TABLE layers (
 node_id INTEGER PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
 locked INTEGER NOT NULL CHECK(locked IN (0,1)), selected INTEGER NOT NULL CHECK(selected IN (0,1))
) STRICT;
CREATE TABLE properties (
 node_id INTEGER PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
 path TEXT NOT NULL, match_name TEXT NOT NULL, children INTEGER NOT NULL CHECK(children>=0),
 value_type TEXT NOT NULL CHECK(value_type IN ('unknown','NO_VALUE','ThreeD_SPATIAL','ThreeD','TwoD_SPATIAL','TwoD','OneD','COLOR','CUSTOM_VALUE','MARKER','LAYER_INDEX','MASK_INDEX','SHAPE','TEXT_DOCUMENT')),
 minimum REAL, maximum REAL, property_type TEXT NOT NULL CHECK(property_type IN ('unknown','PROPERTY','INDEXED_GROUP','NAMED_GROUP')),
 can_vary INTEGER CHECK(can_vary IN (0,1)), can_expression INTEGER CHECK(can_expression IN (0,1))
) STRICT;
CREATE TABLE property_indices (
 node_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
 depth INTEGER NOT NULL CHECK(depth BETWEEN 0 AND 15), ordinal INTEGER NOT NULL CHECK(ordinal>0),
 PRIMARY KEY(node_id,depth)
) STRICT;
CREATE TABLE value_observations (
 node_id INTEGER PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
 state TEXT NOT NULL CHECK(state IN ('unknown','observed-static','observed-key-value')),
 shape TEXT NOT NULL CHECK(shape IN ('unknown','scalar','vector')), key_index INTEGER CHECK(key_index>0), time REAL,
 CHECK((state='unknown' AND shape='unknown') OR (state<>'unknown' AND shape<>'unknown')),
 CHECK(state<>'observed-key-value' OR (key_index IS NOT NULL AND time IS NOT NULL))
) STRICT;
CREATE TABLE number_components (
 node_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
 component INTEGER NOT NULL CHECK(component BETWEEN 0 AND 15), value REAL NOT NULL,
 PRIMARY KEY(node_id,component)
) STRICT;
CREATE TABLE installed_effects (
 host_key TEXT NOT NULL, match_name TEXT NOT NULL, display_name TEXT NOT NULL,
 category TEXT NOT NULL, version TEXT NOT NULL, installed INTEGER CHECK(installed IN (0,1)),
 observed_at INTEGER NOT NULL, completeness TEXT NOT NULL,
 PRIMARY KEY(host_key,match_name)
) STRICT;
CREATE TABLE presets (
 host_key TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, category TEXT NOT NULL,
 root TEXT NOT NULL CHECK(root IN ('ae-presets','user-presets','unknown')),
 stat_fingerprint TEXT NOT NULL, scanned_at TEXT NOT NULL, truncated INTEGER NOT NULL CHECK(truncated IN (0,1)),
 PRIMARY KEY(host_key,id)
) STRICT;

PRAGMA application_id=1163416665;
PRAGMA user_version=1;
