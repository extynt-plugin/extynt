// Answers the relational queries of the graph: definitions, current controls, requested changes and per-scope coverage.
import { decodeOrThrow, fallback, map, number, object, string, type JsonValue } from "@extynt/decode";
import type { Infer, JsonObject } from "@extynt/decode";
import type { DatabaseSync } from "node:sqlite";
import { queryEffectDefinitions, queryParameterDefinitionFacts, queryParameterDefinitions } from "./effect-definition-store.js";
import { queryCurrentControls } from "./graph-control-read.js";
import type { ControlQuery } from "./graph-control-read.js";
import { queryDesiredParameters } from "./graph-desired-read.js";
import { readScopeCoverage } from "./graph-coverage.js";
import { selectAll } from "./graph-sql.js";
import { countOrNull, textOr } from "./native-page.js";
import type { GraphContext } from "./graph-control-types.js";
import { wireObject } from "./wire-object.js";

const COVERAGE_LIMIT = 25;
const CURSOR_LIMIT = 4096;
const optionalText = fallback(string(), undefined);
function boundedCursor(cursor: string | undefined): string {
  return cursor !== undefined && cursor.length <= CURSOR_LIMIT ? cursor : "";
}
const countOrUndefined = map(countOrNull, (count) => count ?? undefined);
const relationalFields = object({
  kind: textOr(""), cursor: optionalText, limit: countOrUndefined, hostKey: textOr(""), matchName: optionalText,
  effectDefinitionId: textOr(""), parameterDefinitionId: textOr(""), compositionId: textOr(""), layerId: textOr(""),
  effectMatchName: optionalText, effectIndex: countOrUndefined, controlMatchName: optionalText, controlInstanceId: countOrUndefined,
});
const scopeRow = object({ id: number(), kind: string(), property_path: string() });
const EMPTY_QUERY = decodeOrThrow(relationalFields, {});
const queryOf = fallback(relationalFields, EMPTY_QUERY);

type RelationalFields = Infer<typeof relationalFields>;

interface RelationalRead { database: DatabaseSync; input: JsonValue; context?: GraphContext; now: number }

function paging(query: RelationalFields): { cursor?: string; limit?: number } {
  return { ...(query.cursor === undefined ? {} : { cursor: query.cursor }), ...(query.limit === undefined ? {} : { limit: query.limit }) };
}

function controlsQuery(query: RelationalFields): ControlQuery {
  return {
    compositionId: query.compositionId, layerId: query.layerId, effectMatchName: query.effectMatchName, effectIndex: query.effectIndex,
    controlMatchName: query.controlMatchName, controlInstanceId: query.controlInstanceId, cursor: query.cursor, limit: query.limit,
  };
}

function queryCoverage(database: DatabaseSync, query: RelationalFields, context: GraphContext, now: number): JsonObject {
  const scopes = selectAll(database, "SELECT id,kind,property_path FROM scopes WHERE project_id=? AND composition_id=? AND layer_id=? ORDER BY id LIMIT 26", scopeRow, context.project, query.compositionId, query.layerId);
  const rows = scopes.slice(0, COVERAGE_LIMIT).map((scope) => ({
    kind: scope.kind, propertyIndices: scope.property_path.split("/").filter(Boolean).map(Number), ...readScopeCoverage({ database, scope: scope.id, context, now }),
  }));
  return {
    rows, truncated: scopes.length > COVERAGE_LIMIT, writeAuthorizing: false,
    coverage: { scope: "retained-bounded-pages", completeMirror: "not-established", absentOutsidePage: "unknown", deletionReconciliation: "not-established" },
  };
}

function definitionQuery(database: DatabaseSync, query: RelationalFields): JsonObject | undefined {
  if (query.kind === "effect-definitions") return decodeOrThrow(wireObject, queryEffectDefinitions(database, { hostKey: query.hostKey, ...(query.matchName === undefined ? {} : { matchName: query.matchName }), ...paging(query) }));
  if (query.kind === "parameter-definitions") return decodeOrThrow(wireObject, queryParameterDefinitions(database, { effectDefinitionId: query.effectDefinitionId, ...paging(query) }));
  if (query.kind === "parameter-facts") return decodeOrThrow(wireObject, queryParameterDefinitionFacts(database, { parameterDefinitionId: query.parameterDefinitionId, ...paging(query) }));
  return undefined;
}

/** The answer to a relational query; a query of an unknown kind throws GRAPH_RELATIONAL_QUERY_INVALID, and one that needs a context answers unknown without it. */
export function readRelationalQuery(input: RelationalRead): JsonObject {
  const { database, context, now } = input, query = decodeOrThrow(queryOf, input.input);
  const definitions = definitionQuery(database, query);
  if (definitions) return definitions;
  if (!context) return { state: "unknown", rows: [], writeAuthorizing: false };
  if (query.kind === "desired-requests") return queryDesiredParameters(database, { cursor: boundedCursor(query.cursor), limit: query.limit, controlInstanceId: query.controlInstanceId ?? 0 }, context);
  if (query.kind === "coverage") return queryCoverage(database, query, context, now);
  if (query.kind !== "controls") throw Error("GRAPH_RELATIONAL_QUERY_INVALID");
  return queryCurrentControls(database, controlsQuery(query), context, now);
}
