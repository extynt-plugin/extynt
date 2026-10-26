// Reads retained page rows back from the graph, one bounded page at a time, each row marked with how fresh its observation still is.
import { absentAs, nullable, number, object, string } from "@extynt/decode";
import type { Infer, JsonObject } from "@extynt/decode";
import type { DatabaseSync } from "node:sqlite";
import { readValid, selectAll, selectValid } from "./graph-sql.js";
import { liveCurrent, OBSERVED_TTL_MS } from "./graph-freshness.js";
import { textOr } from "./native-page.js";
import type { GraphDetailKind } from "./graph-record.js";
import type { GraphContext } from "./graph-control-types.js";

const nodeRow = object({
  id: number(), native_id: textOr(""), name: textOr(""), ordinal: absentAs(nullable(number()), null), owner: string(), epoch: number(), revision: absentAs(nullable(number()), null), observed_at: number(),
  type: absentAs(nullable(string()), null), parent_folder_id: absentAs(nullable(string()), null), layer_count: absentAs(nullable(number()), null), locked: absentAs(nullable(number()), null), selected: absentAs(nullable(number()), null),
  path: absentAs(nullable(string()), null), match_name: absentAs(nullable(string()), null), children: absentAs(nullable(number()), null), value_type: absentAs(nullable(string()), null), minimum: absentAs(nullable(number()), null), maximum: absentAs(nullable(number()), null),
  property_type: absentAs(nullable(string()), null), can_vary: absentAs(nullable(number()), null), can_expression: absentAs(nullable(number()), null),
  value_state: absentAs(nullable(string()), null), shape: absentAs(nullable(string()), null), key_index: absentAs(nullable(number()), null), time: absentAs(nullable(number()), null),
});
const indexRow = object({ ordinal: number() });
const componentRow = object({ value: number() });
const NODE_QUERY = `SELECT n.*,i.type,i.parent_folder_id,i.layer_count,l.locked,l.selected,
 p.path,p.match_name,p.children,p.value_type,p.minimum,p.maximum,p.property_type,p.can_vary,p.can_expression,
 v.state AS value_state,v.shape,v.key_index,v.time
 FROM nodes n LEFT JOIN items i ON i.node_id=n.id LEFT JOIN layers l ON l.node_id=n.id
 LEFT JOIN properties p ON p.node_id=n.id LEFT JOIN value_observations v ON v.node_id=n.id
 WHERE n.scope_id=? AND n.id>? ORDER BY n.id LIMIT ?`;

type NodeRow = Infer<typeof nodeRow>;

interface GraphRead { database: DatabaseSync; scope: number; kind: GraphDetailKind; after: number; limit: number; context: GraphContext; now: number }

function flagOrNull(value: number | null): boolean | null { return value === null ? null : value === 1; }

function readItem(row: NodeRow): JsonObject {
  return { itemIndex: row.ordinal, type: row.type, parentFolderId: row.parent_folder_id, layers: row.layer_count, detail: "index", properties: "unknown" };
}

function readLayer(row: NodeRow, selectionCurrent: boolean): JsonObject {
  return { index: row.ordinal, layerIndex: row.ordinal, locked: row.locked === 1, selected: selectionCurrent ? row.selected === 1 : null, detail: "layer-index", properties: "unknown", values: "not-read" };
}

function readProperty(database: DatabaseSync, row: NodeRow): JsonObject {
  const indices = selectAll(database, "SELECT ordinal FROM property_indices WHERE node_id=? ORDER BY depth", indexRow, row.id).map((index) => index.ordinal);
  return {
    path: row.path, matchName: row.match_name, children: row.children, valueType: row.value_type, minimum: row.minimum, maximum: row.maximum, propertyType: row.property_type,
    canVaryOverTime: flagOrNull(row.can_vary), canSetExpression: flagOrNull(row.can_expression), propertyIndices: indices, detail: "property-descriptor", valueState: "not-read",
  };
}

function readValue(database: DatabaseSync, row: NodeRow): JsonObject {
  const numbers = selectAll(database, "SELECT value FROM number_components WHERE node_id=? ORDER BY component", componentRow, row.id).map((component) => component.value);
  const value = row.shape === "scalar" ? numbers[0] ?? null : row.shape === "vector" ? numbers : null;
  return { valueState: row.value_state, keyIndex: row.key_index, time: row.time, value };
}

function readDetails(database: DatabaseSync, kind: GraphDetailKind, row: NodeRow, selectionCurrent: boolean): JsonObject {
  if (kind === "index") return readItem(row);
  if (kind === "layers") return readLayer(row, selectionCurrent);
  return kind === "properties" ? readProperty(database, row) : readValue(database, row);
}

function readRow(input: GraphRead, row: NodeRow): JsonObject {
  const { context, now } = input, age = now - row.observed_at;
  const fresh = context.revision !== null && row.owner === context.owner && row.epoch === context.epoch && row.revision === context.revision && liveCurrent(age, context.liveAt, now);
  const details = readDetails(input.database, input.kind, row, age >= 0 && age < OBSERVED_TTL_MS);
  const freshness = row.revision === null ? "unknown" : fresh ? "observed" : "stale";
  return { state: freshness, freshness, observedAt: row.observed_at, row: { id: row.native_id, name: row.name, ...details, stamp: { epoch: row.epoch, revision: row.revision } }, writeAuthorizing: false };
}

/** The retained rows of a scope after a node, at most `limit`, with the node to continue from when more remain. */
export function readGraphRows(input: GraphRead): JsonObject {
  const selected = selectValid(input.database, NODE_QUERY, nodeRow, input.scope, input.after, input.limit + 1);
  const rows = readValid(input.database, selected.slice(0, input.limit), (row) => readRow(input, row));
  return {
    state: rows.length ? "retained" : "unknown", rows, nextCursor: selected.length > input.limit ? selected[input.limit - 1]?.id ?? null : null, writeAuthorizing: false,
    coverage: { properties: "only-typed-fields-returned", dependencyClosure: "unknown", absentOutsidePage: "unknown", deletionReconciliation: "not-established" },
  };
}
