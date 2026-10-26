// The relations for effect and control instances, their current observations and the values requested of them, each kept distinct.

/** The tables of instances, current observations, scope coverage and requested values. */
export const GRAPH_INSTANCE_SCHEMA = `
CREATE TABLE effect_instances (
 id INTEGER PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 composition_id TEXT NOT NULL, layer_id TEXT NOT NULL, effect_index INTEGER NOT NULL CHECK(effect_index>0),
 match_name TEXT NOT NULL, display_name TEXT NOT NULL, definition_id TEXT REFERENCES effect_definitions(id),
 enabled INTEGER CHECK(enabled IN (0,1)), item_index INTEGER CHECK(item_index>0), layer_index INTEGER CHECK(layer_index>0),
 owner TEXT NOT NULL, epoch INTEGER NOT NULL CHECK(epoch>=0), revision INTEGER CHECK(revision>=0), observed_at INTEGER NOT NULL CHECK(observed_at>=0),
 UNIQUE(project_id,composition_id,layer_id,effect_index,match_name)
) STRICT;
CREATE INDEX effect_instance_scope ON effect_instances(project_id,composition_id,layer_id,id);
CREATE TABLE control_instances (
 id INTEGER PRIMARY KEY, effect_instance_id INTEGER NOT NULL REFERENCES effect_instances(id) ON DELETE CASCADE,
 match_name TEXT NOT NULL, relative_path TEXT NOT NULL, index_path TEXT NOT NULL, display_name TEXT NOT NULL,
 definition_id TEXT REFERENCES parameter_definitions(id), UNIQUE(effect_instance_id,relative_path,index_path)
) STRICT;
CREATE INDEX control_instance_keyset ON control_instances(effect_instance_id,id);
CREATE TABLE control_observations (
 control_id INTEGER PRIMARY KEY REFERENCES control_instances(id) ON DELETE CASCADE,
 observation_id TEXT NOT NULL UNIQUE,
 source_kind TEXT NOT NULL CHECK(source_kind IN ('descriptor-page','value-page','blur-page','verified-readback')),
 owner TEXT NOT NULL, panel_instance_id TEXT NOT NULL, collection_session_id TEXT NOT NULL,
 epoch INTEGER NOT NULL CHECK(epoch>=0), revision INTEGER CHECK(revision>=0), observed_at INTEGER NOT NULL CHECK(observed_at>=0),
 native_type TEXT NOT NULL CHECK(native_type IN ('unknown','NO_VALUE','ThreeD_SPATIAL','ThreeD','TwoD_SPATIAL','TwoD','OneD','COLOR','CUSTOM_VALUE','MARKER','LAYER_INDEX','MASK_INDEX','SHAPE','TEXT_DOCUMENT')),
 minimum REAL, maximum REAL, units TEXT, units_source TEXT NOT NULL CHECK(units_source IN ('native-observation','unknown')),
 value_state TEXT NOT NULL CHECK(value_state IN ('unknown','observed-static')),
 shape TEXT NOT NULL CHECK(shape IN ('unknown','scalar','vector')), keyframe_count INTEGER CHECK(keyframe_count>=0),
 is_time_varying INTEGER CHECK(is_time_varying IN (0,1)), expression_enabled INTEGER CHECK(expression_enabled IN (0,1)),
 expression_present INTEGER CHECK(expression_present IN (0,1)), can_set_value INTEGER CHECK(can_set_value IN (0,1)),
 coverage TEXT NOT NULL CHECK(coverage IN ('descriptor-only','static-value','key-values-only','unknown')),
 CHECK(minimum IS NULL OR maximum IS NULL OR minimum<=maximum),
 CHECK((value_state='unknown' AND shape='unknown') OR (value_state='observed-static' AND shape<>'unknown')),
 CHECK((units_source='unknown' AND units IS NULL) OR (units_source='native-observation' AND units IS NOT NULL))
) STRICT;
CREATE TABLE control_observation_components (
 control_id INTEGER NOT NULL REFERENCES control_observations(control_id) ON DELETE CASCADE,
 component INTEGER NOT NULL CHECK(component BETWEEN 0 AND 15), value REAL NOT NULL, PRIMARY KEY(control_id,component)
) STRICT;
CREATE TABLE scope_coverage (
 scope_id INTEGER PRIMARY KEY REFERENCES scopes(id) ON DELETE CASCADE,
 owner TEXT NOT NULL, epoch INTEGER NOT NULL CHECK(epoch>=0), revision INTEGER CHECK(revision>=0), observed_at INTEGER NOT NULL CHECK(observed_at>=0), session_id TEXT NOT NULL,
 property_state TEXT NOT NULL CHECK(property_state IN ('unknown','not-read','partial','observed-end')),
 value_state TEXT NOT NULL CHECK(value_state IN ('unknown','not-read','partial','observed-end','unknown-expression','unknown-type')),
 key_metadata_state TEXT NOT NULL CHECK(key_metadata_state IN ('unknown','not-read')),
 dependency_closure TEXT NOT NULL CHECK(dependency_closure IN ('unknown','local-value-only','local-literal-assignment-only'))
) STRICT;
CREATE TABLE desired_control_requests (
 plan_id TEXT PRIMARY KEY, control_id INTEGER NOT NULL REFERENCES control_instances(id), source_observation_id TEXT NOT NULL,
 source_owner TEXT NOT NULL, source_panel_instance_id TEXT NOT NULL, source_session_id TEXT NOT NULL,
 source_epoch INTEGER NOT NULL CHECK(source_epoch>=0), source_revision INTEGER NOT NULL CHECK(source_revision>=0),
 requested_at INTEGER NOT NULL CHECK(requested_at>=0), status TEXT NOT NULL CHECK(status IN ('prepared','bound','verified','invalidated')),
 shape TEXT NOT NULL CHECK(shape IN ('scalar','vector')), ticket TEXT, read_set_digest TEXT, verified_observation_id TEXT, receipt_reference TEXT,
 verified_epoch INTEGER CHECK(verified_epoch>=0), verified_revision INTEGER CHECK(verified_revision>=0),
 settled_at INTEGER CHECK(settled_at>=0), CHECK(status NOT IN ('bound','verified') OR (ticket IS NOT NULL AND read_set_digest IS NOT NULL)),
 CHECK(status<>'verified' OR (verified_observation_id IS NOT NULL AND settled_at IS NOT NULL AND receipt_reference IS NOT NULL AND verified_epoch IS NOT NULL AND verified_revision IS NOT NULL))
) STRICT;
CREATE INDEX desired_control_keyset ON desired_control_requests(control_id,plan_id);
CREATE TABLE desired_control_components (
 plan_id TEXT NOT NULL REFERENCES desired_control_requests(plan_id) ON DELETE CASCADE,
 component INTEGER NOT NULL CHECK(component BETWEEN 0 AND 15), value REAL NOT NULL, PRIMARY KEY(plan_id,component)
) STRICT;
`;
