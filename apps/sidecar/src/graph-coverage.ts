// What the last bounded page of a scope covered: the states it recorded for descriptors, values and dependencies, written with the page and read back with their freshness.
import type { JsonObject } from "@extynt/decode";
import { decodeOrThrow, fallback, literal, number, object, string } from "@extynt/decode";
import type { DatabaseSync } from "node:sqlite";
import { graphSql, selectOne } from "./graph-sql.js";
import { graphFreshness } from "./graph-control-read.js";
import { countOrNull, textOr } from "./native-page.js";
import type { ControlEvidence, GraphContext } from "./graph-control-types.js";

const reported = object({
  descriptorCoverage: fallback(literal("partial", "observed-end"), "not-read" as const),
  valueCoverage: fallback(literal("partial", "observed-end", "unknown-expression", "unknown-type"), "not-read" as const),
  dependencyClosure: fallback(literal("local-value-only", "local-literal-assignment-only"), "unknown" as const),
});
const storedCoverage = object({
  owner: string(), epoch: number(), revision: countOrNull, observed_at: number(), session_id: textOr(""),
  property_state: string(), value_state: string(), key_metadata_state: string(), dependency_closure: string(),
});
const WRITE_COVERAGE = `INSERT INTO scope_coverage(scope_id,owner,epoch,revision,observed_at,session_id,property_state,value_state,key_metadata_state,dependency_closure) VALUES(?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(scope_id) DO UPDATE SET owner=excluded.owner,epoch=excluded.epoch,revision=excluded.revision,observed_at=excluded.observed_at,session_id=excluded.session_id,
  property_state=excluded.property_state,value_state=excluded.value_state,key_metadata_state=excluded.key_metadata_state,dependency_closure=excluded.dependency_closure`;

/** Records what the page just accepted says it covered for the scope; a field the page does not report is stored as not read or unknown. */
export function writeScopeCoverage(input: { database: DatabaseSync; scope: number; page: JsonObject; evidence: ControlEvidence }): void {
  const { database, scope, evidence } = input, context = evidence.context;
  const { descriptorCoverage, valueCoverage, dependencyClosure } = decodeOrThrow(reported, input.page);
  graphSql(database, WRITE_COVERAGE).run(scope, context.owner, context.epoch, context.revision, evidence.at, evidence.session, descriptorCoverage, valueCoverage, "not-read", dependencyClosure);
}

interface CoverageFacts {
  observed_at: number | null; session_id: string; property_state: string; value_state: string; key_metadata_state: string; dependency_closure: string;
}

const NOT_OBSERVED: CoverageFacts = { observed_at: null, session_id: "", property_state: "unknown", value_state: "unknown", key_metadata_state: "unknown", dependency_closure: "unknown" };

/** The coverage recorded for a scope, with the freshness of the page it came from. */
export function readScopeCoverage(input: { database: DatabaseSync; scope: number; context: GraphContext; now: number }): JsonObject {
  const row = selectOne(input.database, "SELECT * FROM scope_coverage WHERE scope_id=?", storedCoverage, input.scope);
  const freshness = row ? graphFreshness({ observedAt: row.observed_at, owner: row.owner, epoch: row.epoch, revision: row.revision }, input.context, input.now) : "unknown";
  const stored: CoverageFacts = row ?? NOT_OBSERVED;
  return {
    scope: "last-bounded-page", freshness, sessionId: stored.session_id || null, observedAt: stored.observed_at, descriptorState: stored.property_state,
    valueState: stored.value_state, keyMetadata: stored.key_metadata_state, dependencyClosure: stored.dependency_closure,
    completeMirror: "not-established", absentOutsidePage: "unknown", deletionReconciliation: "not-established", writeAuthorizing: false,
  };
}
