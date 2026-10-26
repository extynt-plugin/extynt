// The relational schema for definition provenance, plugins, effects, parameters, facts and the links that bind them to observed nodes.

/** Provenance remains relational, including explicit unknown facts and typed numeric defaults. */
export const EFFECT_DEFINITION_SCHEMA = `
CREATE TABLE definition_sources (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('official-documentation','authored-documentation','native-observation')),
 source_url TEXT, title TEXT NOT NULL, host_key TEXT, observed_at INTEGER, instance_binding TEXT,
 observation_context TEXT CHECK(observation_context IN ('property-metadata','factory-default','effect-inventory')),
 CHECK((kind='native-observation' AND host_key IS NOT NULL AND observed_at IS NOT NULL AND observation_context IS NOT NULL)
 OR (kind<>'native-observation' AND source_url IS NOT NULL AND observation_context IS NULL AND instance_binding IS NULL)),
 CHECK(observation_context IS NULL OR observation_context='effect-inventory' OR instance_binding IS NOT NULL)
) STRICT;
CREATE TABLE plugin_definitions (
 id TEXT PRIMARY KEY, native_id TEXT NOT NULL, display_name TEXT NOT NULL, vendor TEXT, version TEXT,
 provenance_id TEXT NOT NULL REFERENCES definition_sources(id)
) STRICT;
CREATE INDEX plugin_definition_native_keyset ON plugin_definitions(native_id,id);
CREATE TABLE effect_definitions (
 id TEXT PRIMARY KEY, host_key TEXT NOT NULL, match_name TEXT NOT NULL, display_name TEXT NOT NULL,
 category TEXT, version TEXT, plugin_id TEXT REFERENCES plugin_definitions(id),
 provenance_id TEXT NOT NULL REFERENCES definition_sources(id)
) STRICT;
CREATE UNIQUE INDEX effect_definition_identity ON effect_definitions(host_key,match_name,COALESCE(version,''));
CREATE INDEX effect_definition_keyset ON effect_definitions(host_key,id);
CREATE INDEX effect_definition_match_keyset ON effect_definitions(host_key,match_name,id);
CREATE TABLE parameter_definitions (
 id TEXT PRIMARY KEY, effect_definition_id TEXT NOT NULL REFERENCES effect_definitions(id),
 match_name TEXT NOT NULL, path TEXT NOT NULL, display_name TEXT NOT NULL,
 parent_parameter_id TEXT REFERENCES parameter_definitions(id), ordinal INTEGER CHECK(ordinal>0),
 provenance_id TEXT NOT NULL REFERENCES definition_sources(id), UNIQUE(effect_definition_id,path)
) STRICT;
CREATE INDEX parameter_definition_keyset ON parameter_definitions(effect_definition_id,id);
CREATE TABLE parameter_definition_facts (
 parameter_definition_id TEXT NOT NULL REFERENCES parameter_definitions(id),
 provenance_id TEXT NOT NULL REFERENCES definition_sources(id),
 value_type TEXT NOT NULL CHECK(value_type IN ('unknown','NO_VALUE','ThreeD_SPATIAL','ThreeD','TwoD_SPATIAL','TwoD','OneD','COLOR','CUSTOM_VALUE','MARKER','LAYER_INDEX','MASK_INDEX','SHAPE','TEXT_DOCUMENT')),
 units TEXT, minimum REAL, maximum REAL,
 default_state TEXT NOT NULL CHECK(default_state IN ('unknown','known')),
 default_shape TEXT NOT NULL CHECK(default_shape IN ('unknown','scalar','vector')),
 documentation TEXT, meaning TEXT, can_vary INTEGER CHECK(can_vary IN (0,1)), can_expression INTEGER CHECK(can_expression IN (0,1)),
 PRIMARY KEY(parameter_definition_id,provenance_id), CHECK(minimum IS NULL OR maximum IS NULL OR minimum<=maximum),
 CHECK((default_state='unknown' AND default_shape='unknown') OR (default_state='known' AND default_shape<>'unknown'))
) STRICT;
CREATE TABLE parameter_default_components (
 parameter_definition_id TEXT NOT NULL, provenance_id TEXT NOT NULL,
 component INTEGER NOT NULL CHECK(component BETWEEN 0 AND 15), value REAL NOT NULL,
 PRIMARY KEY(parameter_definition_id,provenance_id,component),
 FOREIGN KEY(parameter_definition_id,provenance_id) REFERENCES parameter_definition_facts(parameter_definition_id,provenance_id) ON DELETE CASCADE
) STRICT;
CREATE TABLE effect_definition_links (
 node_id INTEGER PRIMARY KEY REFERENCES properties(node_id) ON DELETE CASCADE,
 effect_definition_id TEXT NOT NULL REFERENCES effect_definitions(id)
) STRICT;
CREATE TABLE parameter_definition_links (
 node_id INTEGER PRIMARY KEY REFERENCES properties(node_id) ON DELETE CASCADE,
 parameter_definition_id TEXT NOT NULL REFERENCES parameter_definitions(id)
) STRICT;
CREATE TABLE value_definition_links (
 node_id INTEGER PRIMARY KEY REFERENCES value_observations(node_id) ON DELETE CASCADE,
 property_node_id INTEGER NOT NULL REFERENCES properties(node_id) ON DELETE CASCADE
) STRICT;
`;
