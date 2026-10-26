// The fixed indexes that keep provenance maintenance inside its native instance scope.

/** The statements that create the retention indexes. */
export const GRAPH_RETENTION_INDEXES = `
CREATE INDEX IF NOT EXISTS definition_sources_native_age ON definition_sources(kind,observation_context,host_key,instance_binding,observed_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS parameter_fact_source ON parameter_definition_facts(provenance_id,parameter_definition_id);
CREATE INDEX IF NOT EXISTS plugin_definition_source ON plugin_definitions(provenance_id);
CREATE INDEX IF NOT EXISTS effect_definition_source ON effect_definitions(provenance_id);
CREATE INDEX IF NOT EXISTS parameter_definition_source ON parameter_definitions(provenance_id);
`;
/** How many retention indexes a current file holds. */
export const GRAPH_RETENTION_INDEX_COUNT = 5;
/** The query that counts the retention indexes a file holds. */
export const GRAPH_RETENTION_INDEX_CHECK = "SELECT count(*) AS total FROM sqlite_master WHERE type='index' AND name IN ('definition_sources_native_age','parameter_fact_source','plugin_definition_source','effect_definition_source','parameter_definition_source')";
