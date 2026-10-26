// Writes the rows of one accepted native page into the graph tables, one detail table per page kind, keyed by stable native ids.
import { absentAs, boolean, decodeOrCode, fallback, jsonValue, literal, nullable, object } from "@extynt/decode";
import type { Infer, JsonObject } from "@extynt/decode";
import type { DatabaseSync } from "node:sqlite";
import { graphSql, returnedId } from "./graph-sql.js";
import { graphFlag } from "./graph-record.js";
import type { GraphDetailKind } from "./graph-record.js";
import { collectionDescriptor, collectionValue } from "./collection-types.js";
import { countOrNull, textOr } from "./native-page.js";

const ITEM_TYPES = literal("composition", "folder", "footage");
const nodeFacts = object({ id: textOr(""), name: textOr(""), itemIndex: absentAs(nullable(jsonValue), null), layerIndex: absentAs(nullable(jsonValue), null), keyIndex: absentAs(nullable(jsonValue), null) });
const itemFacts = object({ type: fallback(ITEM_TYPES, undefined), parentFolderId: textOr(""), layers: countOrNull });
const layerFlags = object({ locked: fallback(boolean(), null), selected: fallback(boolean(), null) });

const UPSERT_NODE = `INSERT INTO nodes(scope_id,native_id,name,ordinal,owner,epoch,revision,observed_at) VALUES(?,?,?,?,?,?,?,?)
  ON CONFLICT(scope_id,native_id) DO UPDATE SET name=excluded.name,ordinal=excluded.ordinal,owner=excluded.owner,epoch=excluded.epoch,revision=excluded.revision,observed_at=excluded.observed_at RETURNING id`;
const UPSERT_VALUE = "INSERT INTO value_observations VALUES(?,?,?,?,?) ON CONFLICT(node_id) DO UPDATE SET state=excluded.state,shape=excluded.shape,key_index=excluded.key_index,time=excluded.time";
const UPSERT_ITEM = "INSERT INTO items VALUES(?,?,?,?) ON CONFLICT(node_id) DO UPDATE SET type=excluded.type,parent_folder_id=excluded.parent_folder_id,layer_count=excluded.layer_count";
const UPSERT_LAYER = "INSERT INTO layers VALUES(?,?,?) ON CONFLICT(node_id) DO UPDATE SET locked=excluded.locked,selected=excluded.selected";
const UPSERT_PROPERTY = `INSERT INTO properties VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(node_id) DO UPDATE SET path=excluded.path,match_name=excluded.match_name,children=excluded.children,
  value_type=excluded.value_type,minimum=excluded.minimum,maximum=excluded.maximum,property_type=excluded.property_type,can_vary=excluded.can_vary,can_expression=excluded.can_expression`;

interface GraphWrite { database: DatabaseSync; scope: number; kind: GraphDetailKind; rows: readonly JsonObject[]; owner: string; epoch: number; revision: number | null; at: number }

function saveIndices(database: DatabaseSync, node: number, indices: readonly number[]): void {
  graphSql(database, "DELETE FROM property_indices WHERE node_id=?").run(node);
  const insert = graphSql(database, "INSERT INTO property_indices VALUES(?,?,?)");
  indices.forEach((ordinal, depth) => insert.run(node, depth, ordinal));
}

function saveValue(database: DatabaseSync, node: number, row: JsonObject): void {
  const value = collectionValue(row);
  graphSql(database, UPSERT_VALUE).run(node, value.state, value.shape, value.keyIndex, value.time);
  graphSql(database, "DELETE FROM number_components WHERE node_id=?").run(node);
  const insert = graphSql(database, "INSERT INTO number_components VALUES(?,?,?)");
  value.components.forEach((component, index) => insert.run(node, index, component));
}

function saveItem(database: DatabaseSync, node: number, row: JsonObject): void {
  const facts = decodeOrCode(itemFacts, row, "GRAPH_ITEM_UNSUPPORTED");
  if (facts.type === undefined) throw Error("GRAPH_ITEM_UNSUPPORTED");
  graphSql(database, UPSERT_ITEM).run(node, facts.type, facts.parentFolderId || null, facts.layers);
}

function saveLayer(database: DatabaseSync, node: number, row: JsonObject): void {
  const flags = decodeOrCode(layerFlags, row, "GRAPH_LAYER_UNSUPPORTED");
  if (flags.locked === null || flags.selected === null) throw Error("GRAPH_LAYER_UNSUPPORTED");
  graphSql(database, UPSERT_LAYER).run(node, graphFlag(flags.locked), graphFlag(flags.selected));
}

function saveProperty(database: DatabaseSync, node: number, row: JsonObject): void {
  const property = collectionDescriptor(row);
  graphSql(database, UPSERT_PROPERTY).run(node, property.path, property.matchName, property.children, property.valueType, property.minimum, property.maximum, property.propertyType, property.canVary, property.canExpression);
  saveIndices(database, node, property.indices);
}

const SAVE_DETAILS: { readonly [Kind in GraphDetailKind]: (database: DatabaseSync, node: number, row: JsonObject) => void } = {
  index: saveItem, layers: saveLayer, properties: saveProperty, values: saveValue,
};

function ordinalOf(facts: Infer<typeof nodeFacts>): number | null {
  const first = facts.itemIndex ?? facts.layerIndex ?? facts.keyIndex;
  return decodeOrCode(countOrNull, first, "GRAPH_ROW_INVALID");
}

/** Stable keys preserve page cursors; only observed identities are updated atomically. */
export function writeGraphRows(input: GraphWrite): void {
  for (const row of input.rows) {
    const facts = decodeOrCode(nodeFacts, row, "GRAPH_ROW_INVALID");
    const node = returnedId(input.database, UPSERT_NODE, input.scope, facts.id, facts.name, ordinalOf(facts), input.owner, input.epoch, input.revision, input.at);
    SAVE_DETAILS[input.kind](input.database, node, row);
  }
}
