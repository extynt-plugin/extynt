// Binds observed property nodes to the effect, parameter and value definitions they instantiate, refusing any binding that does not match.
import type { DatabaseSync } from "node:sqlite";
import { number, object, string } from "@extynt/decode";
import { execute, selectOne } from "./graph-sql.js";

const BINDING_INVALID = "GRAPH_DEFINITION_BINDING_INVALID";

const LINK_EFFECT_SQL = `INSERT INTO effect_definition_links SELECT p.node_id,d.id FROM properties p JOIN effect_definitions d ON d.match_name=p.match_name
 JOIN nodes n ON n.id=p.node_id JOIN scopes s ON s.id=n.scope_id JOIN projects pr ON pr.id=s.project_id
 WHERE p.node_id=? AND d.id=? AND p.property_type<>'PROPERTY' AND d.host_key='After Effects:'||pr.host_version||':'||pr.platform
 ON CONFLICT(node_id) DO UPDATE SET effect_definition_id=excluded.effect_definition_id`;

const LINK_PARAMETER_SQL = `INSERT INTO parameter_definition_links SELECT p.node_id,d.id FROM properties p JOIN nodes n ON n.id=p.node_id
 JOIN parameter_definitions d ON d.match_name=p.match_name JOIN effect_definition_links e ON e.effect_definition_id=d.effect_definition_id
 JOIN properties root ON root.node_id=e.node_id JOIN nodes rn ON rn.id=root.node_id
 WHERE p.node_id=? AND d.id=? AND root.node_id=? AND n.scope_id=rn.scope_id
 AND (SELECT count(*) FROM property_indices WHERE node_id=root.node_id)>0
 AND (SELECT count(*) FROM property_indices WHERE node_id=p.node_id)=(SELECT count(*) FROM property_indices WHERE node_id=root.node_id)+1+length(d.path)-length(replace(d.path,'/',''))
 AND NOT EXISTS(SELECT 1 FROM property_indices ri LEFT JOIN property_indices pi ON pi.node_id=p.node_id AND pi.depth=ri.depth
 WHERE ri.node_id=root.node_id AND (pi.ordinal IS NULL OR pi.ordinal<>ri.ordinal))
 ON CONFLICT(node_id) DO UPDATE SET parameter_definition_id=excluded.parameter_definition_id`;

const LINK_VALUE_SQL = `INSERT INTO value_definition_links SELECT v.node_id,p.node_id FROM value_observations v JOIN nodes vn ON vn.id=v.node_id
 JOIN scopes vs ON vs.id=vn.scope_id JOIN properties p ON p.node_id=? JOIN nodes pn ON pn.id=p.node_id JOIN scopes ps ON ps.id=pn.scope_id
 WHERE v.node_id=? AND vs.project_id=ps.project_id AND vs.composition_id=ps.composition_id AND vs.layer_id=ps.layer_id
 AND vs.property_path=(SELECT group_concat(ordinal,'/') FROM (SELECT ordinal FROM property_indices WHERE node_id=p.node_id ORDER BY depth))
 ON CONFLICT(node_id) DO UPDATE SET property_node_id=excluded.property_node_id`;

const PARAMETER_PLACEMENT_SQL = "SELECT p.path,d.path AS definition_path,d.effect_definition_id,n.scope_id FROM properties p JOIN nodes n ON n.id=p.node_id JOIN parameter_definitions d ON d.match_name=p.match_name WHERE p.node_id=? AND d.id=?";
const EFFECT_ROOT_SQL = "SELECT n.id FROM nodes n JOIN effect_definition_links e ON e.node_id=n.id WHERE n.scope_id=? AND n.native_id=? AND e.effect_definition_id=?";

const parameterPlacement = object({ path: string(), definition_path: string(), effect_definition_id: string(), scope_id: number() });
const effectRoot = object({ id: number() });

/** Binds a property node to an effect definition of the project's own host; throws GRAPH_DEFINITION_BINDING_INVALID when they do not match. */
export function linkEffectDefinition(database: DatabaseSync, input: { nodeId: number; effectDefinitionId: string }): void {
  if (execute(database, LINK_EFFECT_SQL, input.nodeId, input.effectDefinitionId) !== 1) throw Error(BINDING_INVALID);
}

function descriptorRoot(propertyPath: string, definitionPath: string): string {
  const property = propertyPath.split("/"), definition = definitionPath.split("/");
  const relative = property.slice(-definition.length).join("/");
  if (relative !== definitionPath || property.length <= definition.length) throw Error(BINDING_INVALID);
  return property.slice(0, -definition.length).join("/");
}

function parameterRoot(database: DatabaseSync, input: { nodeId: number; parameterDefinitionId: string }): number {
  const placement = selectOne(database, PARAMETER_PLACEMENT_SQL, parameterPlacement, input.nodeId, input.parameterDefinitionId);
  if (!placement) throw Error(BINDING_INVALID);
  const path = descriptorRoot(placement.path, placement.definition_path);
  const root = selectOne(database, EFFECT_ROOT_SQL, effectRoot, placement.scope_id, path, placement.effect_definition_id);
  if (!root) throw Error(BINDING_INVALID);
  return root.id;
}

/** Binds a property node to a parameter definition under an already-linked effect root with matching indices; throws GRAPH_DEFINITION_BINDING_INVALID otherwise. */
export function linkParameterDefinition(database: DatabaseSync, input: { nodeId: number; parameterDefinitionId: string }): void {
  const root = parameterRoot(database, input);
  if (execute(database, LINK_PARAMETER_SQL, input.nodeId, input.parameterDefinitionId, root) !== 1) throw Error(BINDING_INVALID);
}

/** Binds a value observation to the property node in the same scope whose index path it observes; throws GRAPH_DEFINITION_BINDING_INVALID otherwise. */
export function linkValueDefinition(database: DatabaseSync, input: { nodeId: number; propertyNodeId: number }): void {
  if (execute(database, LINK_VALUE_SQL, input.propertyNodeId, input.nodeId) !== 1) throw Error(BINDING_INVALID);
}
